import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { safeUrl, imageUrl } from '../electron/security.js';
import { CATEGORY_ORDER, SECTION_ORDER } from '../src/constants/television.ts';

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
    assert.ok(videos.length > 0 && videos.length <= 4);
    for (const v of videos) {
      assert.ok(v.title);
      assert.equal(safeUrl(v.url).hostname, c.platform === 'youtube' ? 'www.youtube.com' : 'rumble.com');
      assert.ok(imageUrl(v.thumbnail));
    }
  }
  assert.deepEqual(new Set(snapshot.cache.map((c) => c.cache_key)), keys);
  assert.ok(!snapshot.channels.some((c) => /lofi girl/i.test(c.name)));
});
