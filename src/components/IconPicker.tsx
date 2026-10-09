import { useId, useState } from 'react';
import { ICONS, ICON_BY_ID } from '../../shared/icon-library.js';
import GuideIcon from './GuideIcon';

export default function IconPicker({ value, onChange, disabled }: { value: string; onChange: (icon: string) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('All icons');
  const id = useId();
  const visible = ICONS.filter((icon) => (family === 'All icons' || icon.family === family) && `${icon.label} ${icon.id} ${icon.family}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="icon-picker">
    <div className="icon-picker-heading"><span className="dock-icon"><GuideIcon icon={value} /></span><div><strong>{ICON_BY_ID[value]?.label || 'Folder'}</strong><p>Choose from {ICONS.length} original SVG icons.</p></div></div>
    <div className="form-columns">
      <label htmlFor={`${id}-search`}>Find an icon<input id={`${id}-search`} type="search" placeholder="Try space, pets, music…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label htmlFor={`${id}-family`}>Icon collection<select id={`${id}-family`} value={family} onChange={(event) => setFamily(event.target.value)}><option>All icons</option>{[...new Set(ICONS.map((icon) => icon.family))].map((name) => <option key={name}>{name}</option>)}</select></label>
    </div>
    <div className="icon-grid" role="group" aria-label="Choose a group icon">
      {visible.map((icon) => <button type="button" key={icon.id} aria-label={`Use ${icon.label} icon`} aria-pressed={value === icon.id} title={icon.label} disabled={disabled} onClick={() => onChange(icon.id)}><GuideIcon icon={icon.id} /><span>{icon.label}</span></button>)}
      {!visible.length && <p>No icons match. Try another search or collection.</p>}
    </div>
  </div>;
}
