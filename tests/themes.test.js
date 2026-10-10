import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../electron/store.js';
import { THEMES, normalizeTheme } from '../shared/themes.js';

const sourceSnapshot = new URL('../data/channel-snapshot.json', import.meta.url);

test('theme configuration defaults to blue as the first selectable theme', () => {
  assert.equal(THEMES[0].id, 'blue');
  assert.equal(THEMES[0].name, 'Blue');
  assert.equal(THEMES[0].isDefault, true);

  const themeIds = THEMES.map((t) => t.id);
  assert.deepEqual(themeIds, ['blue', 'green', 'red', 'pink', 'yellow', 'orange', 'indigo', 'violet', 'terminal', 'psychedelic']);
});

test('store initializes theme to blue and persists theme across sessions', () => {
  const root = mkdtempSync(join(tmpdir(), 'funtube-themes-'));
  const snapshot = JSON.parse(readFileSync(sourceSnapshot, 'utf8'));
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  const dataDir = join(root, 'local');

  let store = createStore(dataDir, snapshotPath);
  try {
    // Default theme is blue
    assert.equal(store.getTheme(), 'blue');

    // Save green theme
    assert.equal(store.saveTheme('green'), 'green');
    assert.equal(store.getTheme(), 'green');

    // Verify file and mode
    const themeJsonPath = join(dataDir, 'theme.json');
    assert.equal(statSync(themeJsonPath).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(themeJsonPath, 'utf8')), { theme: 'green' });

    // Close and reopen to verify next session persistence
    store.close();
    store = createStore(dataDir, snapshotPath);
    assert.equal(store.getTheme(), 'green');

    // Test saving each supported theme
    const supported = THEMES.map((theme) => theme.id);
    for (const theme of supported) {
      assert.equal(store.saveTheme(theme), theme);
      store.close();
      store = createStore(dataDir, snapshotPath);
      assert.equal(store.getTheme(), theme);
    }

    // Normalization of 'orage' typo to 'orange'
    assert.equal(store.saveTheme('orage'), 'orange');
    assert.equal(store.getTheme(), 'orange');

    // Invalid themes throw
    assert.throws(() => store.saveTheme('purple'), /Invalid theme/);
    assert.throws(() => store.saveTheme(123), /Invalid theme/);
    assert.throws(() => store.saveTheme(''), /Invalid theme/);

    // Corrupted file recovery
    writeFileSync(themeJsonPath, '{ invalid json');
    store.close();
    store = createStore(dataDir, snapshotPath);
    assert.equal(store.getTheme(), 'blue');
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
