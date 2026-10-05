import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initializeChannelTables, createChannelStatements, parseYouTubeRSS, filterYouTubeShorts, fetchYouTubeVideos, parseRumbleMarkdown, resolveChannelFromUrl } from './channels.js';
import { fetchRemote } from './network.js';
import { channelIds, imageUrl, label, safeUrl } from './security.js';

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
  const keys = () => ({ youtube: config.youtube || process.env.YOUTUBE_API_KEY || '', firecrawl: config.firecrawl || process.env.FIRECRAWL_API_KEY || '' });
  const status = () => ({ youtube: !!keys().youtube, firecrawl: !!keys().firecrawl });
  const toChannel = (c) => ({ ...c, platform: c.platform === 'youtube' ? 'YouTube' : 'Rumble', avatar: imageUrl(c.avatar) });
  const inflight = new Map();
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
      videos: (Array.isArray(value.videos) ? value.videos : []).slice(0, 4).flatMap((v) => {
        try {
          const id = label(v.id, 200);
          const thumbnail = imageUrl(v.thumbnail) || (channel.platform === 'youtube' && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
          return [{ id, title: label(v.title, 1000), thumbnail, time: label(v.time || '', 80), url: safeUrl(v.url).href }];
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
    if (c.platform === 'rumble' && !keys().firecrawl) {
      return { creator: previous || cleanCreator({ videos: [] }, c), warning: 'Rumble is showing saved feeds. Add a Firecrawl key in Settings to refresh them.' };
    }
    try {
      let videos;
      if (c.platform === 'youtube') {
        if (!/^UC[\w-]{22}$/.test(c.channelKey)) throw new Error('Invalid channel');
        if (keys().youtube) videos = await fetchYouTubeVideos(c.channelKey, keys().youtube);
        else {
          const res = await fetchRemote(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelKey}`, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error('Feed unavailable');
          videos = await filterYouTubeShorts(parseYouTubeRSS(await res.text()).videos);
        }
      } else {
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
      if (!videos.length) throw new Error('No recent videos');
      const creator = cleanCreator({ videos }, c);
      statements.setFeedCache.run(cacheKey, JSON.stringify(creator), Date.now());
      return { creator };
    } catch {
      return { creator: previous || cleanCreator({ videos: [] }, c), warning: `Could not refresh ${c.name}. ${previous ? 'Showing its saved feed.' : 'Try again later.'}` };
    }
  }
  return {
    status,
    channels: () => ({ channels: statements.listEnabled.all().map(toChannel) }),
    allChannels: () => statements.listAll.all().map(toChannel),
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
      statements.insert.run(channel.platform,channel.channelKey,channel.name,safeUrl(channel.url).href,imageUrl(channel.avatar),statements.maxPosition.get().maxPosition+1,new Date().toISOString(),category,section);
      return { channels: statements.listEnabled.all().map(toChannel) };
    },
    updateChannel(input) {
      if (!input || typeof input !== 'object') throw new Error('Invalid channel');
      const [id] = channelIds([input.id]);
      if (!statements.getById.get(id)) throw new Error('Unknown channel');
      if (typeof input.enabled !== 'boolean') throw new Error('Invalid enabled value');
      const category = label(input.category || 'Uncategorized');
      const section = label(input.section || '');
      db.prepare('UPDATE tv_channels SET enabled=?,category=?,section=? WHERE id=?').run(input.enabled ? 1 : 0,category,section,id);
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
    close: () => db.close(),
  };
}
