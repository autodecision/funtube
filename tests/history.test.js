import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchYouTubeVideos, parseYouTubeHistoryPage, parseRumbleHistoryPage } from '../electron/channels.js';

test('public upload lists read dates and continuation without picking up menu videos', () => {
  const result = parseYouTubeHistoryPage({ items: [
    { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'abcdefghijk', metadata: { lockupMetadataViewModel: {
      title: { content: 'Older experiment' }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ accessibilityLabel: '2 years ago' }] }] } },
    } } } },
    { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next-page' } } } },
  ] });
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].title, 'Older experiment');
  assert.ok(Date.parse(result.videos[0].publishedAt) < Date.now() - 365 * 86400000);
  assert.match(result.videos[0].time, /approx/);
  assert.equal(result.continuation, 'next-page');
});

test('API history follows pagination through a year and removes Shorts', async () => {
  const originalFetch = globalThis.fetch;
  const tokens = [];
  const item = (id, date) => ({ contentDetails: { videoId: id, videoPublishedAt: date }, snippet: { title: id } });
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'www.googleapis.com') {
      tokens.push(parsed.searchParams.get('pageToken'));
      return new Response(JSON.stringify(tokens.length === 1
        ? { items: [item('abcdefghijk', new Date().toISOString())], nextPageToken: 'older' }
        : { items: [item('lmnopqrstuv', '2024-01-01T00:00:00Z')], nextPageToken: 'unneeded' }));
    }
    if (parsed.pathname === '/shorts/abcdefghijk') return new Response(null);
    return new Response(null, { status: 302, headers: { location: 'https://www.youtube.com/watch?v=lmnopqrstuv' } });
  };
  try {
    const videos = await fetchYouTubeVideos('UCY1kMZp36IQSyNx_9h4mpCg', 'fake-test-key');
    assert.deepEqual(tokens, [null, 'older']);
    assert.deepEqual(videos.map((v) => v.id), ['lmnopqrstuv']);
  } finally { globalThis.fetch = originalFetch; }
});


test('Rumble history uses upload dates, deduplicates and excludes live videos and Shorts', () => {
  const item = { object_type: 'video', permalink_id: 'v12345', title: 'Garden restoration', thumb: 'https://hugh.cdn.rumble.cloud/image.jpg', upload_date: '2024-05-01T00:00:00Z', url: 'https://rumble.com/v12345-garden.html' };
  const html = `<script type="application/json">${JSON.stringify({ items: [item, item, { ...item, permalink_id: 'short', is_short: true }, { ...item, permalink_id: 'live', live: true }] })}</script>`;
  const videos = parseRumbleHistoryPage(html);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].time, '2024-05-01');
  assert.equal(videos[0].publishedAt, item.upload_date);
});
