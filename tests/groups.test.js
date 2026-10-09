import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../electron/store.js';
import { ICONS, ICON_BY_ID } from '../shared/icon-library.js';
import { CATEGORY_PRESETS } from '../shared/group-presets.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'funtube-groups-'));
  const snapshot = JSON.parse(readFileSync(new URL('../data/channel-snapshot.json', import.meta.url), 'utf8'));
  snapshot.cache.forEach((entry) => entry.fetched_at = Date.now());
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  const dataDir = join(root, 'local');
  return { root, snapshotPath, dataDir, store: createStore(dataDir, snapshotPath) };
}

test('all preset categories and sections have distinct, valid library artwork', () => {
  assert.equal(CATEGORY_PRESETS.length, 16);
  assert.equal(CATEGORY_PRESETS.flatMap((entry) => entry.sections).length, 64);
  assert.equal(ICONS.length, 102);
  assert.equal(new Set(ICONS.map((icon) => icon.id)).size, ICONS.length);
  assert.equal(new Set(ICONS.map((icon) => icon.path)).size, ICONS.length);
  const assigned = CATEGORY_PRESETS.flatMap((entry) => [entry.icon, ...entry.sections.map((section) => section.icon)]);
  assert.equal(new Set(assigned).size, assigned.length);
  for (const id of assigned) assert.ok(ICON_BY_ID[id], id);
  for (const icon of ICONS) {
    assert.match(icon.id, /^[a-z][a-z-]*$/);
    assert.match(icon.path, /^M/);
    assert.doesNotMatch(icon.path, /[^a-zA-Z0-9 .,-]/);
  }
});

test('legacy labels migrate once, preserve channel data, and survive deletion/restart', () => {
  const f = fixture();
  let store = f.store;
  try {
    const channel = store.allChannels()[0];
    store.updateChannel({ id: channel.id, enabled: false, category: 'My legacy group', section: 'My legacy section' });
    store.close();
    const db = new DatabaseSync(join(f.dataDir, 'funtube.sqlite'));
    db.exec('DROP TABLE tv_groups; PRAGMA user_version=0');
    db.close();
    store = createStore(f.dataDir, f.snapshotPath);
    const parent = store.groups().find((group) => group.name === 'My legacy group');
    const child = store.groups().find((group) => group.parentId === parent.id && group.name === 'My legacy section');
    assert.equal(parent.icon, 'folder');
    assert.equal(child.icon, 'folder');
    assert.equal(store.allChannels().find((entry) => entry.id === channel.id).enabled, 0);
    const empty = store.groups().find((group) => group.name === 'Learning');
    store.removeGroup(empty.id);
    store.close();
    store = createStore(f.dataDir, f.snapshotPath);
    assert.ok(!store.groups().some((group) => group.id === empty.id));
    assert.ok(store.groups().some((group) => group.id === child.id));
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('preset imports are idempotent and preserve edited icons', () => {
  const f = fixture();
  try {
    f.store.addGroupPreset('Gaming');
    const gaming = f.store.groups().find((group) => group.name === 'Gaming');
    assert.equal(f.store.groups().filter((group) => group.parentId === gaming.id).length, 4);
    f.store.saveGroup({ ...gaming, icon: 'star' });
    const count = f.store.groups().length;
    f.store.addGroupPreset('Gaming');
    assert.equal(f.store.groups().length, count);
    assert.equal(f.store.groups().find((group) => group.id === gaming.id).icon, 'star');
    assert.throws(() => f.store.addGroupPreset('Untrusted preset'), /Unknown/);
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('migration canonicalizes label casing and preserves legacy names reserved for navigation', () => {
  const f = fixture();
  let store = f.store;
  try {
    const [first, second] = store.allChannels();
    store.close();
    const db = new DatabaseSync(join(f.dataDir, 'funtube.sqlite'));
    db.prepare('UPDATE tv_channels SET category=?,section=? WHERE id=?').run(' technology ', ' programming ', first.id);
    db.prepare('UPDATE tv_channels SET category=?,section=? WHERE id=?').run('Settings', 'My section', second.id);
    db.exec('DROP TABLE tv_groups; PRAGMA user_version=0');
    db.close();
    store = createStore(f.dataDir, f.snapshotPath);
    const migrated = store.allChannels().find((channel) => channel.id === first.id);
    assert.equal(migrated.category, 'Technology');
    assert.equal(migrated.section, 'Programming');
    const reserved = store.allChannels().find((channel) => channel.id === second.id);
    assert.equal(reserved.category, 'Settings (category)');
    assert.equal(reserved.section, 'My section');
    assert.ok(store.groups().some((group) => group.kind === 'category' && group.name === reserved.category));
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('renaming categories and moving sections preserves channel assignments and icon choices', () => {
  const f = fixture();
  let store = f.store;
  try {
    const original = store.allChannels().find((channel) => channel.category === 'Science & Learning' && channel.section === 'Experiments');
    const science = store.groups().find((group) => group.name === original.category);
    store.saveGroup({ ...science, name: 'My science', icon: 'brain' });
    assert.equal(store.allChannels().find((channel) => channel.id === original.id).category, 'My science');
    const experiments = store.groups().find((group) => group.parentId === science.id && group.name === 'Experiments');
    store.saveGroup({ ...experiments, name: 'Lab time', icon: 'robot' });
    assert.equal(store.allChannels().find((channel) => channel.id === original.id).section, 'Lab time');
    assert.throws(() => store.removeGroup(experiments.id), /Move the channels/);
    assert.throws(() => store.removeGroup(science.id), /Move the channels/);
    store.addGroupPreset('Gaming');
    const gaming = store.groups().find((group) => group.name === 'Gaming');
    store.saveGroup({ ...experiments, name: 'Lab time', icon: 'robot', parentId: gaming.id });
    const moved = store.allChannels().find((channel) => channel.id === original.id);
    assert.equal(moved.category, 'Gaming');
    assert.equal(moved.section, 'Lab time');
    assert.equal(moved.position, original.position);
    assert.equal(moved.url, original.url);
    store.close();
    store = createStore(f.dataDir, f.snapshotPath);
    assert.equal(store.groups().find((group) => group.id === experiments.id).icon, 'robot');
    assert.equal(store.allChannels().find((channel) => channel.id === original.id).section, 'Lab time');
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('invalid IDs, unsafe icon names, duplicate names and invalid parents cannot mutate groups', () => {
  const f = fixture();
  try {
    const before = f.store.groups();
    const valid = { kind: 'category', name: 'New group', icon: 'star' };
    for (const input of [null, [], { ...valid, name: ' ' }, { ...valid, name: 'Settings' }, { ...valid, name: 'All channels' }, { ...valid, icon: '<svg onload=alert(1)>' }, { ...valid, icon: '__proto__' }, { ...valid, id: '1' }, { ...valid, name: 'technology' }, { ...valid, kind: 'section', parentId: 99999 }]) assert.throws(() => f.store.saveGroup(input));
    const section = before.find((group) => group.kind === 'section');
    assert.throws(() => f.store.saveGroup({ ...valid, kind: 'section', parentId: section.id }));
    assert.throws(() => f.store.removeGroup('1'));
    assert.deepEqual(f.store.groups(), before);
    f.store.saveGroup(valid);
    const group = f.store.groups().find((entry) => entry.name === valid.name);
    f.store.saveGroup({ kind: 'section', parentId: group.id, name: 'Optional', icon: 'puzzle' });
    f.store.removeGroup(group.id);
    assert.ok(!f.store.groups().some((entry) => entry.parentId === group.id));
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
