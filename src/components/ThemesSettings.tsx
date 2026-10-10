import { useEffect, useRef, useState, type FormEvent } from 'react';
import { THEMES } from '../../shared/themes.js';

export default function ThemesSettings({
  currentTheme,
  onThemeChange,
  onPreviewTheme,
}: {
  currentTheme: string;
  onThemeChange: (theme: string) => Promise<void>;
  onPreviewTheme?: (theme: string) => void;
}) {
  const [selectedTheme, setSelectedTheme] = useState(currentTheme);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const savedThemeRef = useRef(currentTheme);

  useEffect(() => {
    savedThemeRef.current = currentTheme;
    setSelectedTheme(currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    return () => {
      if (onPreviewTheme && savedThemeRef.current) {
        onPreviewTheme(savedThemeRef.current);
      }
    };
  }, [onPreviewTheme]);

  const selectTheme = (themeId: string) => {
    setSelectedTheme(themeId);
    onPreviewTheme?.(themeId);
    document.documentElement.setAttribute('data-theme', themeId);
    setMessage('');
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await onThemeChange(selectedTheme);
      savedThemeRef.current = selectedTheme;
      const name = THEMES.find((t) => t.id === selectedTheme)?.name || selectedTheme;
      setMessage(`Theme saved: ${name}. Saved for your next session.`);
    } catch {
      setMessage('Could not save theme.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="themes-settings">
      <div className="settings-section-heading">
        <div>
          <h2>Themes</h2>
          <p>Choose the look and color scheme of your guide.</p>
        </div>
      </div>
      <p className="feed-intro">
        Try a classic color or a whole new UI style. Select to preview, then save to keep it for your next session.
      </p>
      {message && <p className="settings-message" role="status">{message}</p>}
      <form onSubmit={handleSave}>
        <div className="theme-grid" role="radiogroup" aria-label="Available themes">
          {THEMES.map((theme) => {
            const isSelected = selectedTheme === theme.id;
            const isCurrent = currentTheme === theme.id;
            return (
              <article
                key={theme.id}
                className={`theme-card${isSelected ? ' is-selected' : ''}${isCurrent ? ' is-current' : ''}`}
                data-theme-card={theme.id}
                role="radio"
                aria-checked={isSelected}
                aria-label={theme.name}
                tabIndex={0}
                onClick={() => selectTheme(theme.id)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    selectTheme(theme.id);
                  }
                }}
              >
                <div className="theme-card-heading">
                  <div className="theme-title-wrapper">
                    <span className="theme-swatch" aria-hidden="true" />
                    <h3>{theme.name}</h3>
                    {theme.isDefault && <span className="theme-default-badge">Default</span>}
                  </div>
                  <span className={`theme-status-tag${isCurrent ? ' is-active' : isSelected ? ' is-staged' : ''}`}>
                    {isCurrent ? 'Active' : isSelected ? 'Selected' : 'Select'}
                  </span>
                </div>
                <p className="theme-description">{theme.description}</p>
                {(theme.id === 'terminal' || theme.id === 'psychedelic') && <div className={`theme-style-preview theme-style-preview--${theme.id}`} aria-hidden="true">
                  <span>{theme.id === 'terminal' ? '> funtube_' : 'liquid television'}</span>
                  <div><i /><i /><i /></div>
                </div>}
                <div className="theme-palette-preview" aria-hidden="true">
                  <span className="palette-chip chip-header" title="Header" />
                  <span className="palette-chip chip-guide" title="Guide" />
                  <span className="palette-chip chip-accent" title="Accent" />
                  <span className="palette-chip chip-dock" title="Dock" />
                </div>
              </article>
            );
          })}
        </div>
        <div className="feed-save">
          <button className="primary-button" disabled={busy}>Save theme</button>
          <p>Your theme preference is saved for your next session.</p>
        </div>
      </form>
    </div>
  );
}
