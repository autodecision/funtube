import { fetchRemote } from './network.js';
import { safeUrl } from './security.js';

export function cleanDescription(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, 20000) : '';
}

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[code.toLowerCase()] || entity;
  });
}

function htmlDescription(value) {
  return cleanDescription(decodeEntities(value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n\n').replace(/<[^>]*>/g, '')));
}

export function parseVideoDescription(html, platform) {
  if (platform === 'rumble') {
    const paragraphs = [...html.matchAll(/<p\b[^>]*class\s*=\s*["'][^"']*\bmedia-description--(?:first|more)\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)];
    if (paragraphs.length) return cleanDescription(paragraphs.map((match) => htmlDescription(match[1])).join('\n\n'));
  }
  if (platform === 'youtube') {
    const match = html.match(/"shortDescription"\s*:\s*("(?:\\.|[^"\\])*")/);
    if (match) {
      try { return cleanDescription(JSON.parse(match[1])); } catch { /* try page metadata */ }
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root = JSON.parse(match[1]);
      const objects = Array.isArray(root) ? root : [root, ...(Array.isArray(root['@graph']) ? root['@graph'] : [])];
      const video = objects.find((item) => item && (Array.isArray(item['@type']) ? item['@type'].includes('VideoObject') : item['@type'] === 'VideoObject'));
      if (typeof video?.description === 'string') return htmlDescription(video.description);
    } catch { /* try the next metadata block */ }
  }
  const metadata = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((attr) => [attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]]));
    const name = attributes.property || attributes.name;
    if (name && attributes.content) metadata.set(name.toLowerCase(), decodeEntities(attributes.content));
  }
  return cleanDescription(metadata.get('og:description') || metadata.get('description') || '');
}

export async function fetchVideoDescription(video, platform, youtubeKey = '') {
  const url = safeUrl(video.url);
  if (platform === 'youtube') {
    if (!/^[\w-]{11}$/.test(video.id) || !['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) throw new Error('Invalid YouTube video');
    if (youtubeKey) {
      const api = new URL('https://www.googleapis.com/youtube/v3/videos');
      api.searchParams.set('part', 'snippet');
      api.searchParams.set('id', video.id);
      api.searchParams.set('key', youtubeKey);
      try {
        const response = await fetchRemote(api.href);
        if (response.ok) {
          const data = await response.json();
          const description = data.items?.find((item) => item.id === video.id)?.snippet?.description;
          if (typeof description === 'string') return cleanDescription(description);
        }
      } catch { /* public page still works without an API key */ }
    }
  } else if (platform !== 'rumble' || !['rumble.com', 'www.rumble.com'].includes(url.hostname) || !/^\/v[^/]+\.html$/.test(url.pathname)) {
    throw new Error('Invalid Rumble video');
  }
  const page = platform === 'youtube' ? `https://www.youtube.com/watch?v=${video.id}&hl=en` : url.href;
  const response = await fetchRemote(page, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!response.ok) throw new Error('Video description unavailable');
  const html = await response.text();
  if (!/"shortDescription"|application\/ld\+json|(?:og:)?description/i.test(html)) throw new Error('Video description unavailable');
  return parseVideoDescription(html, platform);
}
