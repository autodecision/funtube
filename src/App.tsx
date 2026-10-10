import { useEffect, useRef, useState, type FormEvent } from 'react';
import Television from './components/Television';
import { useTelevisionPreview } from './contexts/TelevisionPreviewContext';
import { formatVideoDate } from './constants/television';
import { CATEGORY_PRESETS } from '../shared/group-presets.js';
import type { Channel, FeedSettings, GuideGroup } from './bridge';
import GuideIcon from './components/GuideIcon';
import GroupFields from './components/GroupFields';
import GroupsSettings from './components/GroupsSettings';
import ThemesSettings from './components/ThemesSettings';
import VideoDescription from './components/VideoDescription';

export default function App() {
  const { preview } = useTelevisionPreview();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('channels');
  const [channelQuery, setChannelQuery] = useState('');
  const [editingChannel, setEditingChannel] = useState<number | null>(null);
  const settingsContent = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState('All channels');
  const [section, setSection] = useState('');
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [guideVersion, setGuideVersion] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [groups, setGroups] = useState<GuideGroup[]>([]);
  const [settings, setSettings] = useState<FeedSettings>({ youtube: false, firecrawl: false });
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem('funtube-theme') || 'blue'; } catch { return 'blue'; }
  });
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const activeTheme = previewTheme ?? theme;
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme);
  }, [activeTheme]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSettings = async () => {
    const [channelList, feedSettings, groupList, savedTheme] = await Promise.all([
      window.funtube.allChannels(),
      window.funtube.settings(),
      window.funtube.groups(),
      window.funtube.getTheme ? window.funtube.getTheme().catch(() => 'blue') : Promise.resolve('blue'),
    ]);
    setChannels(channelList);
    setSettings(feedSettings);
    setGroups(groupList);
    if (savedTheme) {
      setTheme(savedTheme);
      try { localStorage.setItem('funtube-theme', savedTheme); } catch { /* ignore */ }
    }
  };
  useEffect(() => { void loadSettings().catch(() => setMessage('Could not load settings.')); }, []);

  async function saveTheme(newTheme: string) {
    setBusy(true);
    try {
      if (window.funtube?.saveTheme) {
        await window.funtube.saveTheme(newTheme);
      }
      try { localStorage.setItem('funtube-theme', newTheme); } catch { /* ignore */ }
      setTheme(newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
    } finally { setBusy(false); }
  }

  async function saveKeys(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const youtube = String(data.get('youtube') || '').trim();
    const firecrawl = String(data.get('firecrawl') || '').trim();
    setBusy(true);
    try {
      setSettings(await window.funtube.saveKeys({ ...(youtube ? { youtube } : {}), ...(firecrawl ? { firecrawl } : {}) }));
      form.reset();
      setGuideVersion((v) => v + 1);
      setMessage('Feed settings saved. Blank fields keep the current keys.');
    } catch { setMessage('Could not save feed settings.'); }
    finally { setBusy(false); }
  }

  async function addChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage('Finding this channel…');
    try {
      await window.funtube.addChannel({ url: String(data.get('url')), category: String(data.get('category')), section: String(data.get('section')) });
      await loadSettings();
      form.reset();
      setGuideVersion((v) => v + 1);
      setMessage('Channel added to your guide.');
    } catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Could not add channel.'); }
    finally { setBusy(false); }
  }

  async function updateChannel(event: FormEvent<HTMLFormElement>, channel: Channel) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await window.funtube.updateChannel({ id: channel.id, enabled: data.get('enabled') === 'on', category: String(data.get('category')), section: String(data.get('section')) });
      await loadSettings();
      setGuideVersion((v) => v + 1);
      setMessage(`Updated ${channel.name}.`);
      setEditingChannel(null);
    } catch { setMessage('Could not update channel.'); }
    finally { setBusy(false); }
  }

  async function removeChannel(channel: Channel) {
    if (!window.confirm(`Remove ${channel.name} from your guide?`)) return;
    setBusy(true);
    try {
      setChannels(await window.funtube.removeChannel(channel.id));
      setGuideVersion((v) => v + 1);
      setMessage(`Removed ${channel.name}.`);
    } catch { setMessage('Could not remove channel.'); }
    finally { setBusy(false); }
  }

  async function groupsChanged(updated: GuideGroup[]) {
    const selectedId = groups.find((group) => group.kind === 'category' && group.name === category)?.id;
    if (selectedId) setCategory(updated.find((group) => group.id === selectedId)?.name || 'All channels');
    setGroups(updated);
    setSection('');
    setChannels(await window.funtube.allChannels());
    setGuideVersion((v) => v + 1);
  }

  function dockButton(name: string, icon: string, label: string) {
    const selected = name === 'Settings' ? settingsOpen : !settingsOpen && category === name;
    return <button key={name} className="dock-button" aria-label={name} aria-pressed={selected} title={name} onClick={() => {
      setSettingsOpen(name === 'Settings');
      if (name !== 'Settings') { setCategory(name); setSection(''); }
      else setMessage('');
    }}><span className="dock-icon"><GuideIcon icon={icon} /></span><span className="dock-label">{label}</span></button>;
  }

  const [dynamicCrop, setDynamicCrop] = useState(false);
  const isLetterboxed = Boolean(preview?.thumbnail && (preview.thumbnail.includes('hqdefault') || preview.thumbnail.includes('sddefault')));
  const shouldCrop = isLetterboxed || dynamicCrop;
  useEffect(() => {
    setDynamicCrop(false);
  }, [preview?.thumbnail]);

  const visibleChannels = channels.filter((channel) => `${channel.name} ${channel.platform} ${channel.category} ${channel.section}`.toLowerCase().includes(channelQuery.trim().toLowerCase()));

  return (
    <div className={`desktop-app${settingsOpen ? ' settings-open' : ''}`} data-theme={activeTheme}>
      {settingsOpen ? <header className="settings-masthead">
        <span className="app-wordmark">fun<span>tube</span><small>CHANNEL GUIDE</small></span>
        <button type="button" onClick={() => setSettingsOpen(false)}>← Back to guide</button>
      </header> : <header id="program-preview" className="program-header" aria-label="Program preview">
        {preview ? <a className="preview-image" href={preview.url} target="_blank" rel="noreferrer" aria-label={`Watch ${preview.title} on ${preview.platform}`}>
          <div className="preview-frame">
            {preview.thumbnail && <img
              className={shouldCrop ? 'preview-thumb preview-thumb-ythq' : 'preview-thumb'}
              src={preview.thumbnail}
              alt=""
              onLoad={(e) => {
                if (shouldCrop) return;
                const { naturalWidth, naturalHeight } = e.currentTarget;
                if (naturalWidth && naturalHeight) {
                  const ratio = naturalWidth / naturalHeight;
                  if (ratio > 1.25 && ratio < 1.45 && (preview.platform === 'YouTube' || preview.thumbnail.includes('ytimg') || preview.thumbnail.includes('youtube'))) {
                    setDynamicCrop(true);
                  }
                }
              }}
            />}
            <span className="preview-play" aria-hidden="true">▶</span>
          </div>
        </a> : <div className="preview-image preview-placeholder"><GuideIcon name="All channels" /><span>YOUR CHANNEL GUIDE</span></div>}
        <div className="program-info">
          <div className="program-masthead">
            <span className="app-wordmark">fun<span>tube</span><small>CHANNEL GUIDE</small></span>
            <time className="header-clock" dateTime={clock.toISOString()}><span>{clock.toLocaleDateString(undefined, { dateStyle: 'full' })}</span><b>{clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</b></time>
          </div>
          {preview ? <div className="preview-details">
            <div className="program-channel"><span className="program-channel-number">{preview.channelNumber}</span>{preview.creatorName}<span className={`provider-label ${preview.platform.toLowerCase()}`}>{preview.platform}</span></div>
            <h1><a href={preview.url} target="_blank" rel="noreferrer">{preview.title}</a></h1>
            <div className="program-meta"><span>{formatVideoDate(preview.time, preview.publishedAt)}</span><a className="watch-link" href={preview.url} target="_blank" rel="noreferrer">Watch on {preview.platform} <span aria-hidden="true">↗</span></a></div>
            <VideoDescription key={`${preview.channelId}:${preview.id}`} preview={preview} />
          </div> : <div className="preview-details"><h1>Something good is on.</h1><p className="preview-hint">Browse the guide below to find your next video.</p></div>}
        </div>
      </header>}
      <main className="desktop-main">
        {!settingsOpen ? <Television key={guideVersion} category={category} section={section} onSectionChange={setSection} groups={groups} /> : <div className="settings-page">
          <aside className="settings-sidebar">
            <div className="settings-intro"><h1>Settings</h1><p>Make the guide your own.</p></div>
            <nav aria-label="Settings sections">
              {[
                { id: 'channels', title: 'Channels', description: 'Your personal lineup', icon: 'tv' },
                { id: 'groups', title: 'Categories & sections', description: 'Keep things organized', icon: 'folder' },
                { id: 'feeds', title: 'Video feeds', description: 'Optional connections', icon: 'gear' },
                { id: 'themes', title: 'Themes', description: 'Colors & UI styles', icon: 'palette' },
              ].map((item) => <button key={item.id} type="button" aria-current={settingsSection === item.id ? 'page' : undefined} aria-controls={`settings-${item.id}`} onClick={() => { setSettingsSection(item.id); setMessage(''); settingsContent.current?.scrollTo(0, 0); }}>
                <GuideIcon icon={item.icon} /><span>{item.title}<small>{item.description}</small></span>
              </button>)}
            </nav>
          </aside>
          <div className="settings-content" ref={settingsContent}>
            {message && <p className="settings-message" role="status">{message}</p>}
            <div id="settings-channels" hidden={settingsSection !== 'channels'}>
              <div className="settings-section-heading"><div><h2>Your channels <span>{channels.length}</span></h2><p>Choose what appears in your guide.</p></div></div>
              <details className="add-channel-panel">
                <summary><span aria-hidden="true">＋</span> Add a channel</summary>
                <form onSubmit={addChannel}>
                  <label>Channel URL or YouTube @handle<input name="url" required maxLength={2048} placeholder="https://www.youtube.com/@creator" /></label>
                  <div className="form-columns"><GroupFields key={guideVersion} groups={groups} category={groups.find((group) => group.name === 'Technology')?.name || groups.find((group) => group.kind === 'category')?.name || ''} /></div>
                  <button className="primary-button" disabled={busy}>Add channel</button>
                </form>
              </details>
              <label className="channel-search">Find a channel<input type="search" placeholder="Search by name, provider, or group…" value={channelQuery} onChange={(event) => setChannelQuery(event.target.value)} /></label>
              <div className="channel-list">
                {visibleChannels.map((channel) => <article className="channel-row" key={channel.id}>
                  <div className="channel-summary">
                    <span className="channel-avatar"><GuideIcon icon={groups.find((group) => group.kind === 'category' && group.name === channel.category)?.icon || 'tv'} /></span>
                    <div className="channel-editor-name"><a href={channel.url} target="_blank" rel="noreferrer">{channel.name}</a><small>{channel.platform}<span aria-hidden="true"> · </span>{channel.category}{channel.section ? ` / ${channel.section}` : ''}</small></div>
                    <span className={`channel-state${channel.enabled ? '' : ' is-disabled'}`}>{channel.enabled ? 'In guide' : 'Hidden'}</span>
                    <button type="button" aria-expanded={editingChannel === channel.id} aria-controls={`channel-edit-${channel.id}`} aria-label={`${editingChannel === channel.id ? 'Close editor for' : 'Edit'} ${channel.name}`} onClick={() => setEditingChannel(editingChannel === channel.id ? null : channel.id)}>{editingChannel === channel.id ? 'Close' : 'Edit'}</button>
                  </div>
                  {editingChannel === channel.id && <form id={`channel-edit-${channel.id}`} className="channel-edit-form" key={`${channel.category}-${channel.section}-${channel.enabled}`} onSubmit={(event) => { void updateChannel(event, channel); }}>
                    <div className="form-columns"><GroupFields groups={groups} category={channel.category || 'Uncategorized'} section={channel.section} /></div>
                    <label className="checkbox-label"><input type="checkbox" name="enabled" defaultChecked={!!channel.enabled} /> Show in guide</label>
                    <div className="channel-editor-actions"><button className="primary-button" disabled={busy}>Save changes</button><button type="button" disabled={busy} onClick={() => setEditingChannel(null)}>Cancel</button><button className="remove-channel-button" type="button" disabled={busy} onClick={() => { void removeChannel(channel); }}>Remove channel</button></div>
                  </form>}
                </article>)}
                {!channels.length && <p className="settings-empty">Your lineup starts here. Add a YouTube or Rumble channel above.</p>}
                {!!channels.length && !visibleChannels.length && <p className="settings-empty">No channels match “{channelQuery}”. Try another name or group.</p>}
              </div>
            </div>
            <div id="settings-groups" hidden={settingsSection !== 'groups'}><GroupsSettings groups={groups} onChange={groupsChanged} /></div>
            <div id="settings-feeds" hidden={settingsSection !== 'feeds'}>
              <div className="settings-section-heading"><div><h2>Video feeds</h2><p>Optional API keys for additional feed support.</p></div></div>
              <p className="feed-intro">YouTube and Rumble refresh from their public channel pages. You can use the guide without adding any keys.</p>
              <form onSubmit={saveKeys}>
                <section className="feed-card">
                  <div className="feed-card-heading"><h3>YouTube</h3><span className="connection-status">{settings.youtube ? 'Configured' : 'Optional'}</span></div>
                  <p>A Data API key provides another way to load upload history.</p>
                  <label>YouTube Data API key<input name="youtube" type="password" maxLength={256} autoComplete="off" placeholder={settings.youtube ? 'Leave blank to keep current key' : 'Enter an API key'} /></label>
                  <button type="button" className="quiet-button" disabled={busy || !settings.youtube} onClick={() => { void window.funtube.saveKeys({ youtube: '' }).then(setSettings).catch(() => setMessage('Could not clear key.')); }}>Clear YouTube key</button>
                </section>
                <section className="feed-card">
                  <div className="feed-card-heading"><h3>Rumble</h3><span className="connection-status">{settings.firecrawl ? 'Configured' : 'Optional'}</span></div>
                  <p>A Firecrawl key offers a fallback when public channel pages are unavailable.</p>
                  <label>Firecrawl API key<input name="firecrawl" type="password" maxLength={256} autoComplete="off" placeholder={settings.firecrawl ? 'Leave blank to keep current key' : 'Enter an API key'} /></label>
                  <button type="button" className="quiet-button" disabled={busy || !settings.firecrawl} onClick={() => { void window.funtube.saveKeys({ firecrawl: '' }).then(setSettings).catch(() => setMessage('Could not clear key.')); }}>Clear Firecrawl key</button>
                </section>
                <div className="feed-save"><button className="primary-button" disabled={busy}>Save feed settings</button><p>Blank fields keep your current keys.</p></div>
              </form>
            </div>
            <div id="settings-themes" hidden={settingsSection !== 'themes'}>
              <ThemesSettings currentTheme={theme} onThemeChange={saveTheme} onPreviewTheme={setPreviewTheme} />
            </div>
          </div>
        </div>}
      </main>
      <footer className="guide-footer">
        <div className="guide-statusline"><span>{settingsOpen ? 'Settings & channels' : `${category}${section ? ` / ${section}` : ''}`}<span className="status-divider">/</span>{channels.filter((c) => c.enabled && (settingsOpen || ((category === 'All channels' || c.category === category) && (!section || c.section === section)))).length} channels</span><span>{settingsOpen ? 'Your local library' : 'Browse ↑ ↓ ← → · Enter for details'}</span></div>
        <nav className="guide-dock" aria-label="Guide categories">
          {dockButton('All channels', 'tv', 'Guide')}
          <div className="dock-categories">{groups.filter((group) => group.kind === 'category').map((group) => dockButton(group.name, group.icon, CATEGORY_PRESETS.find((preset) => preset.name === group.name)?.label || group.name))}</div>
          <span className="dock-divider" aria-hidden="true" />
          {dockButton('Settings', 'gear', 'Settings')}
        </nav>
      </footer>
    </div>
  );
}
