import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_URL, assertSender, safeUrl, remoteUrl, imageUrl, channelIds, assetPath } from '../electron/security.js';
import { fetchRemote } from '../electron/network.js';

test('provider URLs reject private hosts, alternate schemes, credentials and ports', () => {
  for (const value of ['http://youtube.com/channel/test', 'file:///etc/passwd', 'javascript:alert(1)', 'https://youtube.com.evil.test/', 'https://youtube.com@127.0.0.1/', 'https://user:pass@youtube.com/', 'https://youtube.com:8080/', 'https://127.0.0.1/']) assert.throws(() => safeUrl(value));
  assert.equal(safeUrl('https://www.youtube.com/watch?v=abc').hostname, 'www.youtube.com');
  assert.equal(remoteUrl('https://api.firecrawl.dev/v1/scrape').hostname, 'api.firecrawl.dev');
  assert.throws(() => remoteUrl('https://example.com/'));
  assert.equal(imageUrl('https://i.ytimg.com/vi/test/hqdefault.jpg'), 'https://i.ytimg.com/vi/test/hqdefault.jpg');
  assert.equal(imageUrl('http://i.ytimg.com/vi/test/hqdefault.jpg'), 'https://i.ytimg.com/vi/test/hqdefault.jpg');
  assert.equal(imageUrl('https://127.0.0.1/private'), '');
});

test('IPC requires the exact app main frame and rejects other windows and subframes', () => {
  const mainFrame = { url: APP_URL };
  const contents = { mainFrame };
  assert.doesNotThrow(() => assertSender({ sender: contents, senderFrame: mainFrame }, contents));
  assert.throws(() => assertSender({ sender: {}, senderFrame: mainFrame }, contents));
  assert.throws(() => assertSender({ sender: contents, senderFrame: { url: APP_URL } }, contents));
  mainFrame.url = 'https://youtube.com/';
  assert.throws(() => assertSender({ sender: contents, senderFrame: mainFrame }, contents));
});

test('channel ids and protocol paths have bounds and reject traversal', () => {
  assert.deepEqual(channelIds([1, 2, 1]), [1, 2]);
  for (const value of [[], [0], [-1], [1.1], ['1'], Array(101).fill(1), null]) assert.throws(() => channelIds(value));
  assert.equal(assetPath('/tmp/funtube-dist', APP_URL), '/tmp/funtube-dist/index.html');
  for (const value of ['funtube://app/%2e%2e%2fprivate', 'funtube://other/index.html', 'funtube://app/%00']) assert.throws(() => assetPath('/tmp/funtube-dist', value));
});

test('provider redirects cannot reach private hosts or forward API credentials', async () => {
  let calls = 0;
  await assert.rejects(fetchRemote('https://www.youtube.com/feed', {}, async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  }));
  assert.equal(calls, 1);
  await assert.rejects(fetchRemote('https://api.firecrawl.dev/v1/scrape', { headers: { authorization: 'Bearer private-value' } }, async () => new Response(null, { status: 302, headers: { location: 'https://youtube.com/' } })));
});

test('responses are capped even when Content-Length is absent', async () => {
  const oversized = () => new Response(new Uint8Array(2 * 1024 * 1024 + 1));
  await assert.rejects(fetchRemote('https://www.youtube.com/feed', {}, oversized), /Response too large/);
  const result = await fetchRemote('https://www.youtube.com/feed', {}, async () => new Response('feed'));
  assert.equal(await result.text(), 'feed');
});
