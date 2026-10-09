import { ICON_BY_ID } from '../../shared/icon-library.js';
import { suggestedIcon } from '../../shared/group-presets.js';

export default function GuideIcon({ name = '', icon }: { name?: string; icon?: string }) {
  const id = icon || ({ 'All channels': 'tv', Settings: 'gear' } as Record<string, string>)[name] || suggestedIcon(name);
  const artwork = ICON_BY_ID[id] || ICON_BY_ID.folder;
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={artwork.path} /></svg>;
}
