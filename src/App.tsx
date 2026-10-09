import { useEffect, useState, type FormEvent } from 'react';
import Television from './components/Television';
import { useTelevisionPreview } from './contexts/TelevisionPreviewContext';
import { formatVideoDate } from './constants/television';
import { CATEGORY_PRESETS } from '../shared/group-presets.js';
import type { Channel, FeedSettings, GuideGroup } from './bridge';
import GuideIcon from './components/GuideIcon';
import GroupFields from './components/GroupFields';
import GroupsSettings from './components/GroupsSettings';
import VideoDescription from './components/VideoDescription';

export default function App() {
  const { preview } = useTelevisionPreview();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSettings = async () => {
    const [channelList, feedSettings, groupList] = await Promise.all([window.funtube.allChannels(), window.funtube.settings(), window.funtube.groups()]);
    setChannels(channelList);
    setSettings(feedSettings);
    setGroups(groupList);
  };
  useEffect(() => { void loadSettings().catch(() => setMessage('Could not load settings.')); }, []);

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

  return (
    <div className="desktop-app">
      <header id="program-preview" className="program-header" aria-label="Program preview">
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
            <h1>{preview.title}</h1>
            <div className="program-meta"><span>{formatVideoDate(preview.time, preview.publishedAt)}</span><a className="watch-link" href={preview.url} target="_blank" rel="noreferrer">Watch on {preview.platform} <span aria-hidden="true">↗</span></a></div>
            <VideoDescription key={`${preview.channelId}:${preview.id}`} preview={preview} />
          </div> : <div className="preview-details"><h1>{settingsOpen ? 'Make yourself at home.' : 'Something good is on.'}</h1><p className="preview-hint">{settingsOpen ? 'Manage your channels and video feeds.' : 'Browse the guide below to find your next video.'}</p></div>}
        </div>
      </header>
      <main className="desktop-main">
        {!settingsOpen ? <Television key={guideVersion} category={category} section={section} onSectionChange={setSection} groups={groups} /> : <div className="settings-page">
          <h1>Settings & channels</h1>
          <p>Your channels and saved feeds live on this computer.</p>
          {message && <p className="settings-message" role="status">{message}</p>}
          <GroupsSettings groups={groups} onChange={groupsChanged} />
          <section>
            <h2>Video feeds</h2>
            <p>YouTube works through its public RSS feeds. An optional Data API key checks more uploads for full-length videos. Rumble needs a Firecrawl key to refresh; saved feeds remain available.</p>
            <form onSubmit={saveKeys}>
              <label>YouTube Data API key <span>{settings.youtube ? 'Configured' : 'Optional'}</span><input name="youtube" type="password" maxLength={256} autoComplete="off" placeholder={settings.youtube ? 'Leave blank to keep current key' : 'YouTube API key'} /></label>
              <label>Firecrawl API key <span>{settings.firecrawl ? 'Configured' : 'Not configured'}</span><input name="firecrawl" type="password" maxLength={256} autoComplete="off" placeholder={settings.firecrawl ? 'Leave blank to keep current key' : 'Firecrawl API key'} /></label>
              <button disabled={busy}>Save feed settings</button>
            </form>
            <div className="key-clear-actions">
              <button disabled={busy || !settings.youtube} onClick={() => { void window.funtube.saveKeys({ youtube: '' }).then(setSettings).catch(() => setMessage('Could not clear key.')); }}>Clear YouTube key</button>
              <button disabled={busy || !settings.firecrawl} onClick={() => { void window.funtube.saveKeys({ firecrawl: '' }).then(setSettings).catch(() => setMessage('Could not clear key.')); }}>Clear Firecrawl key</button>
            </div>
          </section>
          <section>
            <h2>Add a channel</h2>
            <form onSubmit={addChannel}>
              <label>Channel URL or YouTube @handle<input name="url" required maxLength={2048} placeholder="https://www.youtube.com/@creator" /></label>
              <div className="form-columns">
                <GroupFields key={guideVersion} groups={groups} category={groups.find((group) => group.name === 'Technology')?.name || groups.find((group) => group.kind === 'category')?.name || ''} />
              </div>
              <button disabled={busy}>Add channel</button>
            </form>
          </section>
          <section>
            <h2>Your channels <span>({channels.length})</span></h2>
            <div className="channel-editor">
              {channels.map((channel) => <form key={`${channel.id}-${channel.category}-${channel.section}-${channel.enabled}`} onSubmit={(event) => { void updateChannel(event, channel); }}>
                <div className="channel-editor-name"><a href={channel.url} target="_blank" rel="noreferrer">{channel.name}</a><small>{channel.platform}</small></div>
                <label className="checkbox-label"><input type="checkbox" name="enabled" defaultChecked={!!channel.enabled} /> Enabled</label>
                <GroupFields groups={groups} category={channel.category || 'Uncategorized'} section={channel.section} />
                <div className="channel-editor-actions"><button disabled={busy}>Save</button><button type="button" disabled={busy} onClick={() => { void removeChannel(channel); }}>Remove</button></div>
              </form>)}
            </div>
          </section>
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
