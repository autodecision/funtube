import { fetchRemote } from './network.js';
import { safeUrl } from './security.js';
// SQLite channel registry and provider parsers for the Funtube desktop guide.
// The main process owns persistence and fetching; Settings manages the channels.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export function initializeChannelTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tv_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      channel_key TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(platform, channel_key)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS tv_channels_position_idx ON tv_channels(position)');

  // Group channels into collapsible sections in the Television guide. `category`
  // is the top-level group (e.g. "Technology", "Comedy"); `section` is an
  // optional sub-group within it (e.g. Technology → "AI", "Networking").
  // Added via guarded ALTER so existing databases migrate in place.
  const cols = db.prepare('PRAGMA table_info(tv_channels)').all().map((c) => c.name);
  if (!cols.includes('category')) db.exec("ALTER TABLE tv_channels ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('section')) db.exec("ALTER TABLE tv_channels ADD COLUMN section TEXT NOT NULL DEFAULT ''");

  // Per-channel cache of the most recent feed payload. Persisting it (rather than
  // keeping it only in memory) means an app restart doesn't trigger a fresh
  // scrape of every channel — important because Rumble pulls are metered through
  // Firecrawl. Feeds refresh through the main-process store.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tv_feed_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `);
}

export function createChannelStatements(db) {
  return {
    listEnabled: db.prepare(`
      SELECT id, platform, channel_key AS channelKey, name, url, avatar, position, category, section
      FROM tv_channels WHERE enabled = 1 ORDER BY position ASC, id ASC
    `),
    listAll: db.prepare(`
      SELECT id, platform, channel_key AS channelKey, name, url, avatar, position, enabled, category, section
      FROM tv_channels ORDER BY position ASC, id ASC
    `),
    getByKey: db.prepare('SELECT id FROM tv_channels WHERE platform = ? AND channel_key = ?'),
    getById: db.prepare(`
      SELECT id, platform, channel_key AS channelKey, name, url, avatar, position, enabled, category, section
      FROM tv_channels WHERE id = ?
    `),
    maxPosition: db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPosition FROM tv_channels'),
    insert: db.prepare(`
      INSERT INTO tv_channels (platform, channel_key, name, url, avatar, position, enabled, created_at, category, section)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `),
    deleteById: db.prepare('DELETE FROM tv_channels WHERE id = ?'),
    deleteByKey: db.prepare('DELETE FROM tv_channels WHERE platform = ? AND channel_key = ?'),
    setEnabled: db.prepare('UPDATE tv_channels SET enabled = ? WHERE id = ?'),
    setCategory: db.prepare('UPDATE tv_channels SET category = ?, section = ? WHERE id = ?'),
    getFeedCache: db.prepare('SELECT payload, fetched_at AS fetchedAt FROM tv_feed_cache WHERE cache_key = ?'),
    setFeedCache: db.prepare(`
      INSERT INTO tv_feed_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
    `),
  };
}

// ── URL resolution ────────────────────────────────────────────────────────

/**
 * Turn any YouTube or Rumble URL/handle into a canonical channel record:
 *   { platform, channelKey, name, url, avatar }
 * Throws with a human-readable message if the platform is unsupported or the
 * channel can't be found. `firecrawlKey` is required for Rumble (Cloudflare).
 */
export async function resolveChannelFromUrl(rawInput, { firecrawlKey } = {}) {
  const url = normalizeUrl(rawInput);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    return resolveYouTube(url);
  }
  if (host === 'rumble.com') {
    return resolveRumble(url, firecrawlKey);
  }
  throw new Error(`Unsupported platform "${host}". Provide a youtube.com or rumble.com channel URL.`);
}

function normalizeUrl(rawInput) {
  let s = String(rawInput || '').trim();
  if (!s) throw new Error('No URL provided');
  // Bare handle like "@MKBHD" → YouTube handle URL.
  if (s.startsWith('@')) s = `https://www.youtube.com/${s}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return safeUrl(s);
  } catch {
    throw new Error(`Could not parse "${rawInput}" as a URL`);
  }
}

function extractYouTubeAvatar(html) {
  return (
    html.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/) ||
    html.match(/<meta property="og:image" content="([^"]+)"/) ||
    []
  )[1] || '';
}

async function resolveYouTube(url) {
  let channelId = (url.pathname.match(/\/channel\/(UC[\w-]{20,})/) || [])[1] || null;
  let avatar = '';

  if (!channelId) {
    // Handle (/@name), legacy (/c/, /user/), or a /watch URL — scrape the page
    // for the canonical channel id and avatar.
    const res = await fetchRemote(url.href, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`YouTube page fetch failed (${res.status})`);
    const html = await res.text();
    channelId = (html.match(/"externalId":"(UC[\w-]+)"/) || html.match(/\/channel\/(UC[\w-]+)"/) || [])[1];
    if (!channelId) throw new Error('Could not determine the YouTube channel ID from that URL.');
    avatar = extractYouTubeAvatar(html);
  }

  // RSS confirms the channel is public and gives the authoritative title.
  const rss = await fetchRemote(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!rss.ok) throw new Error(`Channel feed unavailable (${rss.status}) — is the channel public?`);
  const xml = await rss.text();
  const name = (xml.match(/<title>([^<]*)<\/title>/) || [])[1]?.trim() || channelId;

  if (!avatar) {
    try {
      const pres = await fetchRemote(`https://www.youtube.com/channel/${channelId}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(10000),
      });
      if (pres.ok) avatar = extractYouTubeAvatar(await pres.text());
    } catch { /* avatar is best-effort */ }
  }

  return {
    platform: 'youtube',
    channelKey: channelId,
    name,
    url: `https://www.youtube.com/channel/${channelId}`,
    avatar,
  };
}

async function resolveRumble(url, firecrawlKey) {
  const m = url.pathname.match(/^\/(c|user)\/([^/]+)/);
  if (!m) {
    throw new Error('Rumble URL must point to a channel (rumble.com/c/<name>) or user (rumble.com/user/<name>).');
  }
  const channelKey = `${m[1]}/${m[2]}`; // e.g. "c/TimPool"
  const canonical = `https://rumble.com/${channelKey}`;

  if (!firecrawlKey) {
    // Can't reach Rumble without Firecrawl (Cloudflare); store the slug as-is.
    return { platform: 'rumble', channelKey, name: m[2], url: canonical, avatar: '' };
  }

  const res = await fetchRemote('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: canonical, formats: ['markdown'], waitFor: 3000 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Firecrawl request failed (${res.status})`);
  const json = await res.json();
  const md = json?.data?.markdown || '';
  if (!json.success || /\b40[34] error|Not found|Private channel/i.test(md.slice(0, 200))) {
    throw new Error('That Rumble channel does not exist or is private.');
  }

  const name = (md.match(/^#\s+(.+)$/m) || [])[1]?.trim() || m[2];
  // The banner has no alt text (![](url)); the avatar has the channel name as alt.
  // This holds for both /c/ and /user/ page layouts.
  const avatarMatch = md.slice(0, 800).match(/!\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const avatar = avatarMatch ? avatarMatch[2] : '';

  return { platform: 'rumble', channelKey, name, url: canonical, avatar };
}

// ── Video fetching (used by /api/television/feed) ──────────────────────────

export function parseYouTubeRSS(xml) {
  const channelTitle = (xml.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  // Grab all available entries (RSS provides up to 15) so Shorts filtering has
  // enough candidates to fill 4 slots even on Short-heavy channels.
  const entries = xml.split('<entry>').slice(1);
  const videos = entries.map((entry) => {
    const videoId = (entry.match(/<yt:videoId>([^<]*)<\/yt:videoId>/) || [])[1] || '';
    const title = (entry.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const thumbnail = (entry.match(/<media:thumbnail url="([^"]*)"/) || [])[1]
      || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const published = (entry.match(/<published>([^<]*)<\/published>/) || [])[1] || '';
    const description = entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1];
    return {
      id: videoId,
      title: decodeEntities(title),
      ...(description !== undefined ? { description: decodeEntities(description) } : {}),
      thumbnail,
      time: published ? new Date(published).toLocaleDateString() : '',
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  });
  return { channelTitle, videos };
}

export function parseYouTubeHistoryPage(data) {
  const videos = [];
  let continuation = '';
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    const model = value.lockupViewModel;
    const renderer = value.videoRenderer;
    if (model?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' || renderer) {
      const id = model?.contentId || renderer.videoId;
      const metadata = model?.metadata?.lockupMetadataViewModel;
      const parts = metadata?.metadata?.contentMetadataViewModel?.metadataRows?.flatMap((row) => row.metadataParts || []) || [];
      const age = parts.map((part) => part.accessibilityLabel || part.text?.content || '').find((text) => /ago$/.test(text))
        || renderer?.publishedTimeText?.simpleText || renderer?.publishedTimeText?.runs?.map((r) => r.text).join('') || '';
      const title = metadata?.title?.content || renderer?.title?.runs?.map((r) => r.text).join('') || '';
      const match = age.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
      let publishedAt = '';
      if (match) {
        const days = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 31, year: 366 }[match[2].toLowerCase()];
        publishedAt = new Date(Date.now() - Number(match[1]) * days * 86400000).toISOString();
      }
      if (/^[\w-]{11}$/.test(id) && title) videos.push({ id, title, publishedAt, time: age ? `${age} (approx.)` : '', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${id}` });
      return;
    }
    if (value.continuationItemRenderer) continuation = value.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || continuation;
    for (const child of Object.values(value)) visit(child);
  }
  visit(data);
  return { videos, continuation };
}

export async function fetchYouTubeHistory(channelId) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };
  const response = await fetchRemote(`https://www.youtube.com/channel/${channelId}/videos?hl=en`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Upload history unavailable');
  const html = await response.text();
  const initial = html.match(/(?:var ytInitialData = |window\["ytInitialData"\] = )(\{[^\n]+?\});/);
  if (!initial) throw new Error('Upload history unavailable');
  const data = JSON.parse(initial[1]);
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  let page = tabs.find((tab) => tab.tabRenderer?.selected)?.tabRenderer?.content;
  if (!page) throw new Error('Upload history unavailable');
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  const videos = new Map();
  const cutoff = Date.now() - 400 * 86400000;
  for (let index = 0; index < 34; index++) {
    const parsed = parseYouTubeHistoryPage(page);
    for (const video of parsed.videos) videos.set(video.id, video);
    if (!parsed.continuation || !clientVersion || videos.size >= 1000 || parsed.videos.some((v) => v.publishedAt && Date.parse(v.publishedAt) <= cutoff)) break;
    const next = await fetchRemote('https://www.youtube.com/youtubei/v1/browse', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } }, continuation: parsed.continuation }),
      signal: AbortSignal.timeout(15000),
    });
    if (!next.ok) throw new Error('Upload history unavailable');
    page = await next.json();
  }
  if (!videos.size) throw new Error('Upload history unavailable');
  return [...videos.values()].slice(0, 1000);
}

export async function fetchYouTubeVideos(channelId, apiKey, keep = 1000) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const candidates = [];
  let pageToken = '';
  for (let page = 0; page < 20; page++) {
    const api = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    api.searchParams.set('part', 'snippet,contentDetails');
    api.searchParams.set('playlistId', `UU${channelId.slice(2)}`);
    api.searchParams.set('maxResults', '50');
    api.searchParams.set('key', apiKey);
    if (pageToken) api.searchParams.set('pageToken', pageToken);
    const res = await fetchRemote(api, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`YouTube Data API playlistItems failed (${res.status})`);
    const json = await res.json();
    let reachedCutoff = false;
    for (const item of json.items || []) {
      const id = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
      const sn = item.snippet || {};
      const publishedAt = item.contentDetails?.videoPublishedAt || sn.publishedAt || '';
      if (publishedAt && new Date(publishedAt) <= cutoff) reachedCutoff = true;
      if (!id || ['Private video', 'Deleted video'].includes(sn.title)) continue;
      const thumbs = sn.thumbnails || {};
      candidates.push({ id, title: decodeEntities(sn.title || ''), ...(typeof sn.description === 'string' ? { description: sn.description } : {}),
        thumbnail: (thumbs.high || thumbs.medium || thumbs.default || {}).url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        publishedAt, time: publishedAt ? new Date(publishedAt).toLocaleDateString() : '',
        url: `https://www.youtube.com/watch?v=${id}` });
    }
    pageToken = json.nextPageToken || '';
    if (!pageToken || reachedCutoff) break;
  }
  return filterYouTubeShorts(candidates, keep);
}

// Return the first `keep` videos that aren't Shorts. Candidates are checked in
// order, in small concurrent batches, stopping once we have enough — so a
// 50-video uploads list doesn't fan out into 50 HEAD requests.
export async function filterYouTubeShorts(videos, keep = 4) {
  const kept = [];
  const batchSize = 8;
  for (let i = 0; i < videos.length && kept.length < keep; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    const checks = await Promise.all(
      batch.map(async (v) => ({ video: v, short: await isYouTubeShort(v.id) }))
    );
    for (const c of checks) {
      if (!c.short) {
        kept.push(c.video);
        if (kept.length >= keep) break;
      }
    }
  }
  return kept;
}

async function isYouTubeShort(videoId) {
  try {
    const res = await fetchRemote(`https://www.youtube.com/shorts/${videoId}`, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(5000),
    });
    // Shorts stay at /shorts/…; regular videos redirect to /watch?v=…
    return res.url.includes('/shorts/');
  } catch {
    return false; // on error, assume not a Short rather than dropping the video
  }
}

export function parseRumbleHistoryPage(html) {
  const videos = new Map();
  for (const match of html.matchAll(/<script type="application\/json">\s*([\s\S]*?)\s*<\/script>/g)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    for (const item of data.items || []) {
      if (item.object_type !== 'video' || item.is_short || item.live || item.live_placeholder || !item.permalink_id) continue;
      videos.set(item.permalink_id, { id: item.permalink_id, title: item.title, thumbnail: item.thumb,
        publishedAt: item.upload_date || '', time: (item.upload_date || '').slice(0, 10), url: item.url });
    }
  }
  return [...videos.values()];
}

export async function fetchRumbleHistory(channelUrl) {
  const canonical = safeUrl(channelUrl);
  if (canonical.hostname !== 'rumble.com' || !/^\/(c|user)\/[^/]+\/?$/.test(canonical.pathname)) throw new Error('Invalid Rumble channel');
  const videos = new Map();
  const cutoff = Date.now() - 400 * 86400000;
  for (let page = 1; page <= 34; page++) {
    const url = new URL(canonical);
    if (page > 1) url.searchParams.set('page', String(page));
    const res = await fetchRemote(url.href, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('Rumble history unavailable');
    const parsed = parseRumbleHistoryPage(await res.text());
    const before = videos.size;
    for (const video of parsed) videos.set(video.id, video);
    if (videos.size === before || videos.size >= 1000 || parsed.some((v) => v.publishedAt && Date.parse(v.publishedAt) <= cutoff)) break;
  }
  if (!videos.size) throw new Error('Rumble history unavailable');
  return [...videos.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 1000);
}

export function parseRumbleMarkdown(markdown) {
  // The channel page opens with a "Featured" block whose video Rumble also pins
  // to the top of the grid below. That pick is often a promotional/pinned video
  // rather than the latest upload, so identify it and skip it — we want the feed
  // to show recent content. The featured link carries the `ucp_f` source marker;
  // ordinary grid links carry `ucp_a`.
  const featuredMatch = markdown.match(/\((https:\/\/rumble\.com\/v[^)?]+)[^)]*e9s=src_v1_ucp_f/);
  const featuredId = featuredMatch ? rumbleVideoId(featuredMatch[1]) : null;

  // Compact video link form: [![Title](thumb)\ ... \n](https://rumble.com/v...)
  const videoRegex = /\[!\[([^\]]+)\]\((https?:\/\/[^)]+)\)[^\]]*\]\((https:\/\/rumble\.com\/v[^)?]+)/g;
  const seen = new Set();
  const videos = [];
  let mm;
  while ((mm = videoRegex.exec(markdown)) !== null && videos.length < 4) {
    const [, title, thumbnail, videoUrl] = mm;
    const id = rumbleVideoId(videoUrl);
    if (id === featuredId) continue; // skip the pinned/featured video
    const baseUrl = videoUrl.split('?')[0].replace(/\.html$/, '');
    const cleanUrl = `${baseUrl}.html`;
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    videos.push({
      id,
      title: title.replace(/\*\*/g, '').trim(),
      thumbnail,
      time: '',
      url: cleanUrl,
    });
  }
  return videos;
}

// Last path segment of a Rumble video URL, minus any query string or .html suffix.
function rumbleVideoId(videoUrl) {
  return videoUrl.split('?')[0].split('/').pop().replace(/\.html$/, '');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
