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
    return {
      id: videoId,
      title: decodeEntities(title),
      thumbnail,
      time: published ? new Date(published).toLocaleDateString() : '',
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  });
  return { channelTitle, videos };
}

/**
 * Pull a channel's recent uploads via the YouTube Data API instead of RSS.
 * RSS caps at ~15 entries with no pagination, which starves Short-heavy channels
 * of full-length videos. The uploads playlist id is just the channel id with the
 * "UC" prefix swapped for "UU", so one playlistItems.list call (1 quota unit)
 * returns up to 50 recent uploads. Shorts are then dropped by filterYouTubeShorts.
 */
export async function fetchYouTubeVideos(channelId, apiKey, keep = 4) {
  const uploadsPlaylistId = `UU${channelId.slice(2)}`;
  const api = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  api.searchParams.set('part', 'snippet,contentDetails');
  api.searchParams.set('playlistId', uploadsPlaylistId);
  api.searchParams.set('maxResults', '50');
  api.searchParams.set('key', apiKey);

  const res = await fetchRemote(api, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`YouTube Data API playlistItems failed (${res.status})`);
  const json = await res.json();

  const candidates = (json.items || [])
    .map((item) => {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
      const sn = item.snippet || {};
      const thumbs = sn.thumbnails || {};
      const thumbnail = (thumbs.high || thumbs.medium || thumbs.default || {}).url
        || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const published = item.contentDetails?.videoPublishedAt || sn.publishedAt || '';
      return {
        id: videoId,
        title: decodeEntities(sn.title || ''),
        thumbnail,
        time: published ? new Date(published).toLocaleDateString() : '',
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    })
    .filter((v) => v.id);

  return filterYouTubeShorts(candidates, keep);
}

// Return the first `keep` videos that aren't Shorts. Candidates are checked in
// order, in small concurrent batches, stopping once we have enough — so a
// 50-video uploads list doesn't fan out into 50 HEAD requests.
export async function filterYouTubeShorts(videos, keep = 4) {
  const kept = [];
  const batchSize = keep * 2;
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
