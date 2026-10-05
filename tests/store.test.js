import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../electron/store.js';

const sourceSnapshot = new URL('../data/channel-snapshot.json', import.meta.url);

test('migration imports only channels/cache, preserves IDs/order, and persists local edits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'funtube-store-'));
  const snapshot = JSON.parse(readFileSync(sourceSnapshot, 'utf8'));
  snapshot.cache.forEach((c) => c.fetched_at = Date.now());
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  const dataDir = join(root, 'local');
  let store = createStore(dataDir, snapshotPath);
  try {
    assert.equal(store.allChannels().length, snapshot.channels.length);
    assert.deepEqual(store.allChannels().map((c) => c.id).sort((a,b) => a-b), snapshot.channels.map((c) => c.id).sort((a,b) => a-b));
    assert.equal(statSync(dataDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(dataDir, 'funtube.sqlite')).mode & 0o777, 0o600);
    const db = new DatabaseSync(join(dataDir, 'funtube.sqlite'));
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name), ['tv_channels', 'tv_feed_cache']);
    db.close();
    const first = store.allChannels().find((c) => c.enabled && snapshot.cache.some((cache) => cache.cache_key === `${c.platform.toLowerCase()}:${c.channelKey}`));
    const result = await store.feed([first.id]);
    assert.ok(result.creators[0].videos.length);
    assert.equal(result.creators[0].channelId, first.id);
    assert.throws(() => store.saveKeys({ youtube: 123 }));
    assert.throws(() => store.saveKeys({ secret: 'unexpected' }));
    assert.deepEqual(store.saveKeys({ youtube: 'test-key', firecrawl: 'test-firecrawl-key' }), { youtube: true, firecrawl: true });
    assert.deepEqual(Object.keys(store.status()).sort(), ['firecrawl', 'youtube']);
    assert.equal(statSync(join(dataDir, 'feed-settings.json')).mode & 0o777, 0o600);
    await assert.rejects(store.feed(['1']));
    await assert.rejects(store.feed([999999]));
    await assert.rejects(store.addChannel({ url: 'http://127.0.0.1/internal' }));
    assert.throws(() => store.updateChannel({ id: first.id, enabled: 'yes' }));
    store.updateChannel({ id: first.id, enabled: false, category: 'Science & Learning', section: 'Local' });
    await assert.rejects(store.feed([first.id]));
    store.close();
    store = createStore(dataDir, snapshotPath);
    const updated = store.allChannels().find((c) => c.id === first.id);
    assert.equal(updated.category, 'Science & Learning');
    assert.equal(updated.section, 'Local');
    assert.equal(updated.enabled, 0);
    for (const channel of store.allChannels()) store.removeChannel(channel.id);
    store.close();
    store = createStore(dataDir, snapshotPath);
    assert.deepEqual(store.allChannels(), []);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('network failures serve the saved feed, and no Firecrawl key preserves Rumble cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'funtube-offline-'));
  const snapshot = JSON.parse(readFileSync(sourceSnapshot, 'utf8'));
  snapshot.cache.forEach((c) => c.fetched_at = 0);
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  const store = createStore(join(root, 'local'), snapshotPath);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const channel = store.allChannels().find((c) => c.platform === 'YouTube' && snapshot.cache.some((cache) => cache.cache_key === `youtube:${c.channelKey}`));
    const result = await store.feed([channel.id]);
    assert.ok(result.creators[0].videos.length);
    assert.match(result.warnings[0], /Showing its saved feed/);
    const rumble = store.allChannels().find((c) => c.platform === 'Rumble');
    const rumbleResult = await store.feed([rumble.id]);
    assert.ok(rumbleResult.creators[0].videos.length);
    assert.match(rumbleResult.warnings[0], /Firecrawl key/);
  } finally { globalThis.fetch = originalFetch; store.close(); rmSync(root, { recursive: true, force: true }); }
});
