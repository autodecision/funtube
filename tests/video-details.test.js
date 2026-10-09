import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../electron/store.js';
import { cleanDescription, parseVideoDescription, fetchVideoDescription } from '../electron/video-details.js';

test('YouTube descriptions preserve complete site text, line breaks, quotes and Unicode', () => {
  const description = 'How a reactor works.\n\nA "core" & cooling 🧪\nhttps://example.com';
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { shortDescription: description } })};</script><meta name="description" content="Short teaser…">`;
  assert.equal(parseVideoDescription(html, 'youtube'), description);
  assert.equal(cleanDescription('a\r\nb\u0000c\t d'), 'a\nbc\t d');
  assert.equal(cleanDescription('x'.repeat(30000)).length, 20000);
});

test('Rumble structured video metadata is preferred over teasers and rendered as plain text', () => {
  const html = `<meta property="og:description" content="Short teaser"><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebSite', description: 'Wrong description' }, { '@type': 'VideoObject', description: '<p>A garden &amp; its wildlife.</p><p>Birds<br>and bees &#x1F41D;.</p>' }] })}</script>`;
  assert.equal(parseVideoDescription(html, 'rumble'), 'A garden & its wildlife.\n\nBirds\nand bees 🐝.');
  assert.equal(parseVideoDescription('<meta content="A &quot;quoted&quot; title &#39; &amp; more" property="og:description">', 'rumble'), 'A "quoted" title \' & more');
  assert.equal(parseVideoDescription('<meta content=\'A video\' name=\'description\'>', 'rumble'), 'A video');
  assert.equal(parseVideoDescription('<script type="application/ld+json">broken</script>', 'rumble'), '');
  assert.equal(parseVideoDescription('<meta name="description" content="&#9999999999;">', 'rumble'), '');
  assert.equal(parseVideoDescription('<meta property=og:description content="Public teaser">', 'rumble'), 'Public teaser');
});

test('Rumble expanded page description includes all paragraphs and excludes Show more controls', () => {
  const html = '<meta property=og:description content="Teaser"><p class="media-description media-description--first">First paragraph <a href="https://example.com">site link</a></p><button>Show more</button><p class="media-description media-description--more">Full story &apos;with quotes&apos;.<br>Another line.</p><button>Show less</button>';
  assert.equal(parseVideoDescription(html, 'rumble'), "First paragraph site link\n\nFull story 'with quotes'.\nAnother line.");
});

test('details only fetch provider video pages and fall back from a failed optional API', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(url));
    if (new URL(url).hostname === 'www.googleapis.com') return new Response('', { status: 403 });
    return new Response('<script>{"shortDescription":"Original page description"}</script>');
  };
  try {
    const video = { id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
    assert.equal(await fetchVideoDescription(video, 'youtube', 'fake-key'), 'Original page description');
    assert.equal(urls.length, 2);
    assert.equal(urls[1].searchParams.get('v'), video.id);
    await assert.rejects(fetchVideoDescription({ ...video, url: 'https://example.com/video' }, 'youtube'));
    await assert.rejects(fetchVideoDescription({ ...video, url: 'https://rumble.com/c/channel' }, 'rumble'));
    assert.equal(urls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('details validate saved video selection, deduplicate requests and persist descriptions for offline use', async () => {
  const root = mkdtempSync(join(tmpdir(), 'funtube-details-'));
  const snapshot = JSON.parse(readFileSync(new URL('../data/channel-snapshot.json', import.meta.url), 'utf8'));
  snapshot.cache.forEach((cache) => { cache.fetched_at = Date.now(); });
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  const directory = join(root, 'local');
  let store = createStore(directory, snapshotPath);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('<script>{"shortDescription":"Site description\\nSecond line"}</script>'); };
  try {
    const channel = store.allChannels().find((item) => item.platform === 'YouTube' && snapshot.cache.some((cache) => cache.cache_key === `youtube:${item.channelKey}`));
    const video = (await store.feed([channel.id])).creators[0].videos[0];
    const input = { channelId: channel.id, videoId: video.id };
    await assert.rejects(store.videoDetails({ ...input, videoId: 'unknown' }));
    await assert.rejects(store.videoDetails({ ...input, channelId: '1' }));
    await assert.rejects(store.videoDetails({ ...input, channelId: 999999 }));
    assert.equal(calls, 0);
    const results = await Promise.all([store.videoDetails(input), store.videoDetails(input)]);
    assert.deepEqual(results, [{ description: 'Site description\nSecond line' }, { description: 'Site description\nSecond line' }]);
    assert.equal(calls, 1);
    assert.equal((await store.feed([channel.id])).creators[0].videos[0].description, results[0].description);
    store.close();
    store = createStore(directory, snapshotPath);
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await store.videoDetails(input), results[0]);
    await assert.rejects(store.videoDetails({ ...input, videoId: (await store.feed([channel.id])).creators[0].videos[1].id }));
    store.updateChannel({ id: channel.id, enabled: false, category: channel.category, section: channel.section });
    await assert.rejects(store.videoDetails(input));
  } finally { globalThis.fetch = originalFetch; store.close(); rmSync(root, { recursive: true, force: true }); }
});
