import { remoteUrl } from './security.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function fetchRemote(input, options = {}, fetcher = fetch) {
  let url = remoteUrl(String(input));
  const signal = options.signal || AbortSignal.timeout(10000);
  let headers = new Headers(options.headers);
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetcher(url.href, { ...options, headers, signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Invalid redirect');
      const next = remoteUrl(new URL(location, url).href);
      if (next.origin !== url.origin) {
        headers = new Headers(headers);
        headers.delete('authorization');
        if (url.hostname === 'www.googleapis.com' || url.hostname === 'api.firecrawl.dev') throw new Error('API redirect rejected');
      }
      url = next;
      continue;
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error('Response too large');
    }
    const chunks = [];
    let length = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > MAX_RESPONSE_BYTES) throw new Error('Response too large');
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel();
        throw error;
      } finally { reader.releaseLock(); }
    }
    const body = options.method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks);
    const result = new Response(body, { status: response.status, headers: response.headers });
    Object.defineProperty(result, 'url', { value: url.href });
    return result;
  }
  throw new Error('Too many redirects');
}
