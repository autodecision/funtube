import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initializeChannelTables, createChannelStatements, parseYouTubeRSS, filterYouTubeShorts, fetchYouTubeVideos, fetchYouTubeHistory, fetchRumbleHistory, parseRumbleMarkdown, resolveChannelFromUrl } from './channels.js';
import { fetchRemote } from './network.js';
import { channelIds, imageUrl, label, safeUrl } from './security.js';
import { createGroups } from './groups.js';
import { cleanDescription, fetchVideoDescription } from './video-details.js';
import { VALID_THEME_IDS } from '../shared/themes.js';

const TTL = 12 * 60 * 60 * 1000;

export function createStore(directory, snapshotPath) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const dbPath = join(directory, 'funtube.sqlite');
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON');
  initializeChannelTables(db);
  const statements = createChannelStatements(db);
  const configPath = join(directory, 'feed-settings.json');
  let config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  if (existsSync(configPath)) chmodSync(configPath, 0o600);
  const themePath = join(directory, 'theme.json');
  let currentTheme = 'blue';
  if (existsSync(themePath)) {
    try {
      const data = JSON.parse(readFileSync(themePath, 'utf8'));
      const t = typeof data?.theme === 'string' ? data.theme.toLowerCase().trim() : '';
      if (t === 'orage') currentTheme = 'orange';
      else if (VALID_THEME_IDS.has(t)) currentTheme = t;
    } catch { /* use default theme */ }
    chmodSync(themePath, 0o600);
  }
  if (!db.prepare('SELECT COUNT(*) AS n FROM tv_channels').get().n && !existsSync(join(directory, 'initialized'))) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    const insert = db.prepare('INSERT INTO tv_channels (id,platform,channel_key,name,url,avatar,position,enabled,created_at,category,section) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    try {
      for (const c of snapshot.channels) insert.run(c.id,c.platform,c.channel_key,c.name,c.url,c.avatar,c.position,c.enabled,c.created_at,c.category,c.section);
      for (const c of snapshot.cache) statements.setFeedCache.run(c.cache_key,c.payload,c.fetched_at);
      db.exec('COMMIT');
      writeFileSync(join(directory, 'initialized'), '', { mode: 0o600 });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const demo = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  for (const entry of demo.cache) {
    if (!statements.getByKey.get(...entry.cache_key.split(':'))) continue;
    const cached = statements.getFeedCache.get(entry.cache_key);
    let existing = { videos: [] };
    try { if (cached) existing = JSON.parse(cached.payload); } catch { /* replace corrupt cache */ }
    const incoming = JSON.parse(entry.payload);
    const videos = [...(existing.videos || []), ...(incoming.videos || [])];
    const merged = [...new Map(videos.map((v) => [v.id, v])).values()];
    merged.sort((a, b) => new Date(b.publishedAt || b.time).getTime() - new Date(a.publishedAt || a.time).getTime());
    if (merged.length > (existing.videos || []).length) statements.setFeedCache.run(entry.cache_key, JSON.stringify({ ...existing, videos: merged }), cached?.fetchedAt || entry.fetched_at);
  }
  const groups = createGroups(db);
  const keys = () => ({ youtube: config.youtube || process.env.YOUTUBE_API_KEY || '', firecrawl: config.firecrawl || process.env.FIRECRAWL_API_KEY || '' });
  const status = () => ({ youtube: !!keys().youtube, firecrawl: !!keys().firecrawl });
  const toChannel = (c) => ({ ...c, platform: c.platform === 'youtube' ? 'YouTube' : 'Rumble', avatar: imageUrl(c.avatar) });
  const inflight = new Map();
  const detailRequests = new Map();
  let activeFetches = 0;
  const queue = [];
  async function limited(work) {
    if (activeFetches >= 4) await new Promise((ready) => queue.push(ready));
    activeFetches++;
    try { return await work(); } finally { activeFetches--; queue.shift()?.(); }
  }
  function cleanCreator(value, channel) {
    return {
      id: channel.channelKey, channelId: channel.id, name: channel.name, platform: toChannel(channel).platform, avatar: imageUrl(channel.avatar),
      videos: (Array.isArray(value.videos) ? value.videos : []).slice(0, 1000).flatMap((v) => {
        try {
          const id = label(v.id, 200);
          const thumbnail = imageUrl(v.thumbnail) || (channel.platform === 'youtube' && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
          return [{ id, title: label(v.title, 1000), thumbnail, time: label(v.time || '', 80), publishedAt: label(v.publishedAt || '', 80), url: safeUrl(v.url).href,
            ...(typeof v.description === 'string' ? { description: cleanDescription(v.description) } : {}) }];
        } catch { return []; }
      }),
    };
  }
  async function loadChannel(c) {
    const cacheKey = `${c.platform}:${c.channelKey}`;
    const cached = statements.getFeedCache.get(cacheKey);
    let previous;
    try { if (cached) previous = cleanCreator(JSON.parse(cached.payload), c); } catch { /* discard invalid cache */ }
    if (previous && Date.now() - cached.fetchedAt < TTL) return { creator: previous };
    try {
      let videos;
      if (c.platform === 'youtube') {
        if (!/^UC[\w-]{22}$/.test(c.channelKey)) throw new Error('Invalid channel');
        if (keys().youtube) videos = await fetchYouTubeVideos(c.channelKey, keys().youtube);
        else {
          try { videos = await fetchYouTubeHistory(c.channelKey); } catch {
          const res = await fetchRemote(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelKey}`, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error('Feed unavailable');
          videos = await filterYouTubeShorts(parseYouTubeRSS(await res.text()).videos, 15);
          }
        }
      } else {
        try { videos = await fetchRumbleHistory(c.url); } catch {
        if (!keys().firecrawl) throw new Error('Rumble history unavailable');
        const url = safeUrl(c.url);
        if (url.hostname !== 'rumble.com' || !/^\/(c|user)\/[^/]+\/?$/.test(url.pathname)) throw new Error('Invalid Rumble channel');
        const res = await fetchRemote('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST', headers: { Authorization: `Bearer ${keys().firecrawl}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.href, formats: ['markdown'], waitFor: 3000 }), signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error('Feed unavailable');
        const result = await res.json();
        if (!result.success) throw new Error('Feed unavailable');
        videos = parseRumbleMarkdown(result.data?.markdown || '');
        }
      }
      if (!videos.length) throw new Error('No recent videos');
      const merged = [...new Map([...videos, ...(previous?.videos || [])].map((v) => [v.id, v])).values()];
      merged.sort((a, b) => new Date(b.publishedAt || b.time).getTime() - new Date(a.publishedAt || a.time).getTime());
      const creator = cleanCreator({ videos: merged }, c);
      statements.setFeedCache.run(cacheKey, JSON.stringify(creator), Date.now());
      return { creator };
    } catch {
      if (previous) statements.setFeedCache.run(cacheKey, JSON.stringify(previous), Date.now());
      const firecrawlNotice = c.platform === 'rumble' && !keys().firecrawl ? ' Add a Firecrawl key in Settings to refresh Rumble.' : '';
      return { creator: previous || cleanCreator({ videos: [] }, c), warning: `Could not refresh ${c.name}. ${previous ? 'Showing its saved feed.' : 'Try again later.'}${firecrawlNotice}` };
    }
  }
  return {
    status,
    groups: groups.all,
    saveGroup: groups.save,
    removeGroup: groups.remove,
    addGroupPreset: groups.addPreset,
    channels: () => ({ channels: statements.listEnabled.all().map(toChannel) }),
    allChannels: () => statements.listAll.all().map(toChannel),
    async videoDetails(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid video selection');
      const [channelId] = channelIds([input.channelId]);
      const videoId = label(input.videoId, 200);
      const channel = statements.getById.get(channelId);
      if (!channel?.enabled) throw new Error('Unknown or disabled channel');
      const cacheKey = `${channel.platform}:${channel.channelKey}`;
      const cached = statements.getFeedCache.get(cacheKey);
      const creator = cached && cleanCreator(JSON.parse(cached.payload), channel);
      const video = creator?.videos.find((item) => item.id === videoId);
      if (!video) throw new Error('Unknown video');
      if (typeof video.description === 'string') return { description: video.description };
      const requestKey = `${channelId}:${videoId}`;
      if (!detailRequests.has(requestKey)) {
        const request = limited(async () => {
          const description = await fetchVideoDescription(video, channel.platform, keys().youtube);
          const latest = statements.getFeedCache.get(cacheKey);
          if (latest && statements.getById.get(channelId)) {
            const payload = JSON.parse(latest.payload);
            payload.videos = payload.videos.map((item) => item.id === videoId ? { ...item, description } : item);
            statements.setFeedCache.run(cacheKey, JSON.stringify(payload), latest.fetchedAt);
          }
          return { description };
        }).finally(() => detailRequests.delete(requestKey));
        detailRequests.set(requestKey, request);
      }
      return detailRequests.get(requestKey);
    },
    async feed(ids) {
      const wanted = channelIds(ids);
      const channels = statements.listEnabled.all().filter((c) => wanted.includes(c.id));
      if (channels.length !== wanted.length) throw new Error('Unknown or disabled channel');
      const results = await Promise.all(channels.map((c) => {
        if (!inflight.has(c.id)) {
          const job = limited(() => loadChannel(c)).finally(() => inflight.delete(c.id));
          inflight.set(c.id, job);
        }
        return inflight.get(c.id);
      }));
      return { creators: results.map((r) => r.creator), warnings: [...new Set(results.map((r) => r.warning).filter(Boolean))] };
    },
    saveKeys(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !['youtube', 'firecrawl'].includes(k))) throw new Error('Invalid settings');
      const validated = Object.fromEntries(Object.entries(value).map(([key, val]) => [key, label(val, 256)]));
      config = { ...config, ...validated };
      writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
      return status();
    },
    async addChannel(input) {
      if (!input || typeof input !== 'object') throw new Error('Invalid channel');
      if (statements.listAll.all().length >= 500) throw new Error('Channel limit reached');
      let url = label(input.url, 2048);
      if (/^@[\w.-]{1,100}$/.test(url)) url = `https://www.youtube.com/${url}`;
      safeUrl(url);
      const category = label(input.category || 'Uncategorized');
      const section = label(input.section || '');
      const channel = await resolveChannelFromUrl(url, { firecrawlKey: keys().firecrawl });
      if (statements.getByKey.get(channel.platform, channel.channelKey)) throw new Error('Channel already exists');
      const assignment = groups.ensure(category, section);
      statements.insert.run(channel.platform,channel.channelKey,channel.name,safeUrl(channel.url).href,imageUrl(channel.avatar),statements.maxPosition.get().maxPosition+1,new Date().toISOString(),assignment.category,assignment.section);
      return { channels: statements.listEnabled.all().map(toChannel) };
    },
    updateChannel(input) {
      if (!input || typeof input !== 'object') throw new Error('Invalid channel');
      const [id] = channelIds([input.id]);
      if (!statements.getById.get(id)) throw new Error('Unknown channel');
      if (typeof input.enabled !== 'boolean') throw new Error('Invalid enabled value');
      const category = label(input.category || 'Uncategorized');
      const section = label(input.section || '');
      const assignment = groups.ensure(category, section);
      db.prepare('UPDATE tv_channels SET enabled=?,category=?,section=? WHERE id=?').run(input.enabled ? 1 : 0,assignment.category,assignment.section,id);
      return this.allChannels();
    },
    removeChannel(id) {
      channelIds([id]);
      const channel = statements.getById.get(id);
      if (!channel) throw new Error('Unknown channel');
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM tv_feed_cache WHERE cache_key=?').run(`${channel.platform}:${channel.channelKey}`);
        statements.deleteById.run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return this.allChannels();
    },
    getTheme: () => currentTheme,
    saveTheme(themeInput) {
      if (typeof themeInput !== 'string') throw new Error('Invalid theme');
      const clean = themeInput.toLowerCase().trim();
      const normalized = clean === 'orage' ? 'orange' : clean;
      if (!VALID_THEME_IDS.has(normalized)) throw new Error('Invalid theme');
      currentTheme = normalized;
      writeFileSync(themePath, JSON.stringify({ theme: currentTheme }), { mode: 0o600 });
      chmodSync(themePath, 0o600);
      return currentTheme;
    },
    close: () => db.close(),
  };
}
