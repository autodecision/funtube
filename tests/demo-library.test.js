import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { safeUrl, imageUrl } from '../electron/security.js';
import { CATEGORY_ORDER, SECTION_ORDER, formatVideoDate, getCategoryChannelBase, formatChannelNumber } from '../src/constants/television.ts';

const snapshot = JSON.parse(readFileSync(new URL('../data/channel-snapshot.json', import.meta.url), 'utf8'));

test('demo library uses verified provider channels and matching saved feeds', () => {
  assert.equal(snapshot.edition, 'demo');
  assert.equal(snapshot.channels.length, 23);
  assert.equal(snapshot.channels.filter((c) => c.platform === 'youtube').length, 20);
  assert.equal(snapshot.channels.filter((c) => c.platform === 'rumble').length, 3);
  const keys = new Set();
  for (const c of snapshot.channels) {
    const key = `${c.platform}:${c.channel_key}`;
    assert.ok(!keys.has(key), `Duplicate ${key}`);
    keys.add(key);
    assert.ok(CATEGORY_ORDER.includes(c.category));
    if (SECTION_ORDER[c.category]) assert.ok(SECTION_ORDER[c.category].includes(c.section));
    assert.equal(safeUrl(c.url).hostname, c.platform === 'youtube' ? 'www.youtube.com' : 'rumble.com');
    if (c.avatar) assert.ok(imageUrl(c.avatar));
    const cache = snapshot.cache.find((row) => row.cache_key === key);
    assert.ok(cache, `Missing saved feed for ${c.name}`);
    const { videos } = JSON.parse(cache.payload);
    assert.ok(videos.length > 0 && videos.length <= 1000);
    assert.ok(videos.some((v) => Date.parse(v.publishedAt) <= Date.now() - 365 * 86400000), `Missing year of history for ${c.name}`);
    for (const v of videos) {
      assert.ok(v.title);
      assert.equal(safeUrl(v.url).hostname, c.platform === 'youtube' ? 'www.youtube.com' : 'rumble.com');
      assert.ok(imageUrl(v.thumbnail));
      if (v.time) assert.ok(!v.time.includes('approx'), `Found approx in ${c.name} video time`);
    }
  }
  assert.deepEqual(new Set(snapshot.cache.map((c) => c.cache_key)), keys);
  assert.ok(!snapshot.channels.some((c) => /lofi girl/i.test(c.name)));
});

test('formatVideoDate removes approx and formats dates cleanly', () => {
  assert.equal(formatVideoDate('3 weeks ago (approx.)', '2026-09-18T12:00:00Z'), '3 weeks ago');
  assert.equal(formatVideoDate('2025-10 (approx.)', '2025-10-06T00:00:00Z'), '2025-10');
  assert.equal(formatVideoDate('3 weeks ago', '2026-09-18T12:00:00Z'), '3 weeks ago');
  assert.ok(!formatVideoDate('yesterday (approx.)').includes('approx'));
});

test('channel numbers start at 0001 and categories own 100 channels starting at 0100 for technology', () => {
  assert.equal(getCategoryChannelBase(''), 0);
  assert.equal(getCategoryChannelBase('Uncategorized'), 0);
  assert.equal(formatChannelNumber(0, 0), '0001');
  assert.equal(formatChannelNumber(0, 1), '0002');

  assert.equal(getCategoryChannelBase('Science & Learning'), 0);
  assert.equal(formatChannelNumber(0, 0), '0001');
  assert.equal(formatChannelNumber(0, 1), '0002');

  assert.equal(getCategoryChannelBase('Technology'), 100);
  assert.equal(formatChannelNumber(100, 0), '0100');
  assert.equal(formatChannelNumber(100, 1), '0101');

  assert.equal(getCategoryChannelBase('Nature & Outdoors'), 200);
  assert.equal(formatChannelNumber(200, 0), '0200');

  assert.equal(getCategoryChannelBase('Food & Cooking'), 300);
  assert.equal(formatChannelNumber(300, 0), '0300');

  assert.equal(getCategoryChannelBase('Art & Creativity'), 400);
  assert.equal(formatChannelNumber(400, 0), '0400');

  assert.equal(getCategoryChannelBase('Entertainment'), 500);
  assert.equal(formatChannelNumber(500, 0), '0500');
});
