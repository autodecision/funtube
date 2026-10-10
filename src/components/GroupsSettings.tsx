import { useState, type FormEvent } from 'react';
import { CATEGORY_PRESETS } from '../../shared/group-presets.js';
import type { GuideGroup, GroupInput } from '../bridge';
import GuideIcon from './GuideIcon';
import IconPicker from './IconPicker';

const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Could not save this group.';

export default function GroupsSettings({ groups, onChange }: { groups: GuideGroup[]; onChange: (groups: GuideGroup[]) => Promise<void> }) {
  const categories = groups.filter((group) => group.kind === 'category');
  const [activeId, setActiveId] = useState<number | null>(categories[0]?.id || null);
  const active = categories.find((group) => group.id === activeId) || categories[0];
  const sections = groups.filter((group) => group.parentId === active?.id);
  const [draft, setDraft] = useState<GroupInput>(categories[0] || { kind: 'category', name: '', icon: 'folder' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(work: () => Promise<GuideGroup[]>, success: string) {
    setBusy(true);
    setMessage('');
    try { const updated = await work(); await onChange(updated); setMessage(success); return updated; }
    catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const updated = await run(() => window.funtube.saveGroup(draft), `${draft.name} saved.`);
    if (updated) {
      const saved = updated.find((group) => group.kind === draft.kind && group.name === draft.name.trim() && group.parentId === (draft.parentId || null));
      if (saved) { setDraft(saved); setActiveId(saved.kind === 'category' ? saved.id : saved.parentId); }
    }
  }
  async function remove() {
    if (!draft.id) return;
    const updated = await run(() => window.funtube.removeGroup(draft.id!), `${draft.name} removed.`);
    if (updated) setDraft({ kind: 'category', name: '', icon: 'folder' });
  }
  async function removePreset(presetName: string, categoryId: number) {
    if (!window.confirm(`Remove the "${presetName}" category preset and its sections from your guide?`)) return;
    const updated = await run(() => window.funtube.removeGroup(categoryId), `${presetName} removed.`);
    if (updated) {
      if (activeId === categoryId) {
        const next = updated.find((group) => group.kind === 'category');
        setActiveId(next?.id || null);
        if (next) setDraft(next);
        else setDraft({ kind: 'category', name: '', icon: 'folder' });
      } else if (draft.id === categoryId || draft.parentId === categoryId) {
        setDraft({ kind: 'category', name: '', icon: 'folder' });
      }
    }
  }
  const preset = CATEGORY_PRESETS.find((entry) => entry.name === active?.name);
  const missingSections = preset?.sections.filter((section) => !sections.some((group) => group.name.toLowerCase() === section.name.toLowerCase())) || [];

  return <section className="groups-settings" aria-labelledby="groups-heading">
    <h2 id="groups-heading">Categories & sections</h2>
    <p>Organize your lineup into categories and smaller sections.</p>
    {message && <p className="settings-message" role="status">{message}</p>}
    <details className="preset-browser">
      <summary>Browse {CATEGORY_PRESETS.length} category presets · {CATEGORY_PRESETS.reduce((total, item) => total + item.sections.length, 0)} sections</summary>
      <div className="preset-grid">{CATEGORY_PRESETS.map((preset) => {
        const existing = categories.find((group) => group.name.toLowerCase() === preset.name.toLowerCase());
        const complete = existing && preset.sections.every((section) => groups.some((group) => group.parentId === existing.id && group.name.toLowerCase() === section.name.toLowerCase()));
        return <article key={preset.name}>
          <div className="preset-title"><GuideIcon icon={preset.icon} /><strong>{preset.name}</strong></div>
          <div className="preset-sections">{preset.sections.map((section) => <span key={section.name}><GuideIcon icon={section.icon} />{section.name}</span>)}</div>
          <div className="preset-actions">
            <button type="button" disabled={busy || complete} onClick={() => { void run(() => window.funtube.addGroupPreset(preset.name), `${preset.name} preset added.`); }}>{complete ? 'Added' : existing ? 'Add missing sections' : 'Add preset'}</button>
            {existing && <button type="button" className="preset-remove-button" disabled={busy} onClick={() => { void removePreset(preset.name, existing.id); }}>Remove</button>}
          </div>
        </article>;
      })}</div>
    </details>
    <div className="group-workspace">
      <div className="group-navigation">
        <div className="group-actions"><button type="button" disabled={busy} onClick={() => setDraft({ kind: 'category', name: '', icon: 'folder' })}>New category</button><button type="button" disabled={busy || !active} onClick={() => setDraft({ kind: 'section', parentId: active?.id, name: '', icon: 'folder' })}>New section</button></div>
        <label>Browse your categories<select value={active?.id || ''} onChange={(event) => { const next = categories.find((group) => group.id === Number(event.target.value)); setActiveId(next?.id || null); if (next) setDraft(next); }}><option value="" disabled>Choose a category</option>{categories.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        {active && <button type="button" className="group-list-item" aria-pressed={draft.id === active.id} onClick={() => setDraft(active)}><GuideIcon icon={active.icon} /><span>{active.name}<small>Category</small></span></button>}
        {sections.map((group) => <button type="button" className="group-list-item" key={group.id} aria-pressed={draft.id === group.id} onClick={() => setDraft(group)}><GuideIcon icon={group.icon} /><span>{group.name}<small>Section</small></span></button>)}
        {active && !sections.length && <p>No sections yet. Add one to organize this category.</p>}
        {!!missingSections.length && <div className="suggested-sections"><strong>Suggested sections</strong>{missingSections.map((section) => <button type="button" key={section.name} disabled={busy} onClick={() => { void run(() => window.funtube.saveGroup({ ...section, kind: 'section', parentId: active.id }), `${section.name} added.`); }}><GuideIcon icon={section.icon} />Add {section.name}</button>)}</div>}
      </div>
      <form className="group-editor" onSubmit={(event) => { void save(event); }}>
        <h3>{draft.id ? 'Edit' : 'Create'} {draft.kind}</h3>
        <label>{draft.kind === 'category' ? 'Category name' : 'Section name'}<input required maxLength={80} value={draft.name} placeholder={draft.kind === 'category' ? 'My interests' : 'A new section'} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        {draft.kind === 'section' && <label>Parent category<select required value={draft.parentId || ''} onChange={(event) => setDraft({ ...draft, parentId: Number(event.target.value) })}><option value="" disabled>Choose a category</option>{categories.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
        <IconPicker value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} disabled={busy} />
        <div className="group-actions"><button disabled={busy}>{draft.id ? 'Save group' : 'Create group'}</button>{draft.id && <button type="button" disabled={busy} onClick={() => { void remove(); }}>Remove group</button>}</div>
        {draft.id && <p className="group-help">Renaming updates its channels too. To remove a group, move its channels first.</p>}
      </form>
    </div>
  </section>;
}
