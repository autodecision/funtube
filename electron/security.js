import { resolve, relative, isAbsolute, sep } from 'node:path';

export const APP_URL = 'funtube://app/index.html';
const PROVIDERS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'rumble.com', 'www.rumble.com']);
const REMOTE_HOSTS = new Set([...PROVIDERS, 'www.googleapis.com', 'api.firecrawl.dev']);
const IMAGE_HOSTS = new Set(['yt3.googleusercontent.com', 'yt3.ggpht.com', 'i.ytimg.com', '1a-1791.com', 'hugh.cdn.rumble.cloud']);

export function safeUrl(value, hosts = PROVIDERS) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname)) {
    throw new Error('Use a YouTube or Rumble HTTPS URL');
  }
  return url;
}

export const remoteUrl = (value) => safeUrl(value, REMOTE_HOSTS);
export const imageUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' && !url.port && IMAGE_HOSTS.has(url.hostname)) url.protocol = 'https:';
    return safeUrl(url.href, IMAGE_HOSTS).href;
  } catch { return ''; }
};

export function assertSender(event, webContents) {
  if (event.sender !== webContents || event.senderFrame !== webContents.mainFrame || event.senderFrame.url !== APP_URL) {
    throw new Error('Unauthorized renderer');
  }
}

export function channelIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100 || value.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Invalid channel selection');
  }
  return [...new Set(value)];
}

export function label(value, max = 80) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error('Invalid text');
  return value.trim();
}

export function assetPath(root, requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== 'funtube:' || url.host !== 'app') throw new Error('Invalid origin');
  const path = resolve(root, '.' + decodeURIComponent(url.pathname));
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || rel.includes('\0')) throw new Error('Invalid asset');
  return path;
}
