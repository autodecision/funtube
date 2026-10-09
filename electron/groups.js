import { ICON_BY_ID } from '../shared/icon-library.js';
import { CATEGORY_PRESETS, suggestedIcon } from '../shared/group-presets.js';
import { label } from './security.js';

export function createGroups(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tv_groups (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('category','section')),
    parent_id INTEGER REFERENCES tv_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE, icon TEXT NOT NULL, position INTEGER NOT NULL,
    CHECK((kind='category' AND parent_id IS NULL) OR (kind='section' AND parent_id IS NOT NULL))
  ); CREATE UNIQUE INDEX IF NOT EXISTS tv_group_names ON tv_groups(COALESCE(parent_id,0),name COLLATE NOCASE)`);
  const all = db.prepare('SELECT id,kind,parent_id AS parentId,name,icon,position FROM tv_groups ORDER BY position,id');
  const byId = db.prepare('SELECT id,kind,parent_id AS parentId,name,icon,position FROM tv_groups WHERE id=?');
  const byName = db.prepare('SELECT id,kind,parent_id AS parentId,name,icon,position FROM tv_groups WHERE COALESCE(parent_id,0)=? AND name=? COLLATE NOCASE');
  const insert = db.prepare('INSERT INTO tv_groups(kind,parent_id,name,icon,position) VALUES(?,?,?,?,?)');
  const nextPosition = () => db.prepare('SELECT COALESCE(MAX(position),0)+1 AS next FROM tv_groups').get().next;
  function transaction(work) {
    db.exec('BEGIN');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function checkedName(value, kind) {
    const name = label(value);
    if (!name) throw new Error('Give this group a name.');
    if (kind === 'category' && ['all channels', 'settings'].includes(name.toLowerCase())) throw new Error('Choose a different category name.');
    return name;
  }
  function ensure(categoryValue, sectionValue = '') {
    const category = checkedName(categoryValue || 'Uncategorized', 'category');
    const section = label(sectionValue);
    let parent = byName.get(0, category);
    if (!parent) {
      if (all.all().length >= 500) throw new Error('Group limit reached.');
      const result = insert.run('category', null, category, suggestedIcon(category), nextPosition());
      parent = byId.get(Number(result.lastInsertRowid));
    }
    let child;
    if (section) {
      child = byName.get(parent.id, section);
      if (!child) {
        if (all.all().length >= 500) throw new Error('Group limit reached.');
        const result = insert.run('section', parent.id, section, suggestedIcon(parent.name, section), nextPosition());
        child = byId.get(Number(result.lastInsertRowid));
      }
    }
    return { category: parent.name, section: child?.name || '' };
  }
  function addPreset(nameValue) {
    const name = label(nameValue);
    const preset = CATEGORY_PRESETS.find((entry) => entry.name === name);
    if (!preset) throw new Error('Unknown category preset.');
    return transaction(() => {
      ensure(preset.name);
      for (const section of preset.sections) ensure(preset.name, section.name);
      return all.all();
    });
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 1) {
    transaction(() => {
      for (const preset of CATEGORY_PRESETS.slice(0, 6)) {
        ensure(preset.name);
        for (const section of preset.sections) ensure(preset.name, section.name);
      }
      const migrateChannel = db.prepare('UPDATE tv_channels SET category=?,section=? WHERE id=?');
      for (const channel of db.prepare('SELECT id,category,section FROM tv_channels').all()) {
        let category = label(channel.category || 'Uncategorized');
        if (['all channels', 'settings'].includes(category.toLowerCase())) category += ' (category)';
        const assignment = ensure(category, channel.section);
        migrateChannel.run(assignment.category, assignment.section, channel.id);
      }
      db.exec('PRAGMA user_version = 1');
    });
  }
  return {
    all: () => all.all(),
    ensure: (category, section) => transaction(() => ensure(category, section)),
    addPreset,
    save(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid group.');
      if (!['category', 'section'].includes(input.kind)) throw new Error('Invalid group type.');
      const name = checkedName(input.name, input.kind);
      if (typeof input.icon !== 'string' || !Object.hasOwn(ICON_BY_ID, input.icon)) throw new Error('Choose an icon from the library.');
      const previous = input.id === undefined ? null : byId.get(Number.isSafeInteger(input.id) ? input.id : -1);
      if (input.id !== undefined && !previous) throw new Error('Unknown group.');
      if (previous && previous.kind !== input.kind) throw new Error('Group type cannot change.');
      const parent = input.kind === 'section' ? byId.get(Number.isSafeInteger(input.parentId) ? input.parentId : -1) : null;
      if (input.kind === 'section' && parent?.kind !== 'category') throw new Error('Choose a category for this section.');
      const duplicate = byName.get(parent?.id || 0, name);
      if (duplicate && duplicate.id !== previous?.id) throw new Error('A group with this name already exists here.');
      if (!previous && all.all().length >= 500) throw new Error('Group limit reached.');
      return transaction(() => {
        if (previous) {
          if (previous.kind === 'category') db.prepare('UPDATE tv_channels SET category=? WHERE category=? COLLATE NOCASE').run(name, previous.name);
          else {
            const oldParent = byId.get(previous.parentId);
            db.prepare('UPDATE tv_channels SET category=?,section=? WHERE category=? COLLATE NOCASE AND section=? COLLATE NOCASE').run(parent.name, name, oldParent.name, previous.name);
          }
          db.prepare('UPDATE tv_groups SET name=?,icon=?,parent_id=? WHERE id=?').run(name, input.icon, parent?.id || null, previous.id);
        } else insert.run(input.kind, parent?.id || null, name, input.icon, nextPosition());
        return all.all();
      });
    },
    remove(id) {
      if (!Number.isSafeInteger(id)) throw new Error('Invalid group.');
      const group = byId.get(id);
      if (!group) throw new Error('Unknown group.');
      const assigned = group.kind === 'category'
        ? db.prepare('SELECT COUNT(*) AS n FROM tv_channels WHERE category=? COLLATE NOCASE').get(group.name).n
        : db.prepare('SELECT COUNT(*) AS n FROM tv_channels WHERE category=? COLLATE NOCASE AND section=? COLLATE NOCASE').get(byId.get(group.parentId).name, group.name).n;
      if (assigned) throw new Error('Move the channels in this group before removing it. Disabled channels count too.');
      db.prepare('DELETE FROM tv_groups WHERE id=?').run(id);
      return all.all();
    },
  };
}
