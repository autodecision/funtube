import { useEffect, useState, type FormEvent } from 'react';
import Television from './components/Television';
import { useTelevisionPreview } from './contexts/TelevisionPreviewContext';
import { CATEGORY_ORDER } from './constants/television';
import type { Channel, FeedSettings } from './bridge';

export default function App() {
  const { preview } = useTelevisionPreview();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideVersion, setGuideVersion] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [settings, setSettings] = useState<FeedSettings>({ youtube: false, firecrawl: false });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSettings = async () => {
    const [channelList, feedSettings] = await Promise.all([window.funtube.allChannels(), window.funtube.settings()]);
    setChannels(channelList);
    setSettings(feedSettings);
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
      setChannels(await window.funtube.updateChannel({ id: channel.id, enabled: data.get('enabled') === 'on', category: String(data.get('category')), section: String(data.get('section')) }));
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

  return (
    <div className="desktop-app">
      <aside className="desktop-sidebar">
        <div className="app-wordmark">Funtube<span>YOUR CHANNEL GUIDE</span></div>
        <button className="sidebar-action" aria-pressed={!settingsOpen} onClick={() => setSettingsOpen(false)}>Guide</button>
        <button className="sidebar-action" aria-pressed={settingsOpen} onClick={() => { setSettingsOpen(true); setMessage(''); }}>Settings & channels</button>
        <section className="preview" aria-label="Program preview">
          {preview ? <>
            <a className="preview-image" href={preview.url} target="_blank" rel="noreferrer">
              {preview.thumbnail && <img src={preview.thumbnail} alt="" />}
              <span className="preview-play">▶</span>
            </a>
            <h2>{preview.title}</h2>
            <p>{preview.creatorName} · {preview.platform}</p>
            <p className="preview-time">{preview.time}</p>
            <a className="watch-link" href={preview.url} target="_blank" rel="noreferrer">Watch on {preview.platform} ↗</a>
          </> : <p className="preview-hint">Hover or focus a program to preview it here.</p>}
        </section>
        <p className="sidebar-footer">{channels.filter((c) => c.enabled).length} channels · local library</p>
      </aside>
      <main className="desktop-main">
        {!settingsOpen ? <Television key={guideVersion} /> : <div className="settings-page">
          <h1>Settings & channels</h1>
          <p>Your channels and saved feeds live on this computer.</p>
          {message && <p className="settings-message" role="status">{message}</p>}
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
                <label>Category<input name="category" list="categories" defaultValue="Technology" required maxLength={80} /></label>
                <label>Section<input name="section" maxLength={80} placeholder="AI, Networking…" /></label>
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
                <label>Category<input name="category" list="categories" defaultValue={channel.category || 'Uncategorized'} required maxLength={80} /></label>
                <label>Section<input name="section" defaultValue={channel.section} maxLength={80} /></label>
                <div className="channel-editor-actions"><button disabled={busy}>Save</button><button type="button" disabled={busy} onClick={() => { void removeChannel(channel); }}>Remove</button></div>
              </form>)}
            </div>
          </section>
          <datalist id="categories">{CATEGORY_ORDER.map((name) => <option key={name} value={name} />)}</datalist>
        </div>}
      </main>
    </div>
  );
}
