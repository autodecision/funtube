import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTelevisionPreview } from '../contexts/TelevisionPreviewContext';
import { CATEGORY_ORDER, SECTION_ORDER, formatVideoDate, getCategoryChannelBase, formatChannelNumber } from '../constants/television';
import type { Channel, GuideGroup } from '../bridge';
import GuideIcon from './GuideIcon';
import '../styles/Television.css';

type Creator = Awaited<ReturnType<Window['funtube']['feed']>>['creators'][number];
type Video = Creator['videos'][number];
type Focused = { video: Video; channel: Channel; number: string };
const orderIndex = (list: string[], value: string) => {
  const i = list.indexOf(value);
  return i === -1 ? list.length : i;
};

export default function Television({ category, section, onSectionChange, groups }: { category: string; section: string; onSectionChange: (section: string) => void; groups: GuideGroup[] }) {
  const { setPreview } = useTelevisionPreview();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creators, setCreators] = useState<Record<number, Creator>>({});
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [held, setHeld] = useState<Focused | null>(null);
  const [pinned, setPinned] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.funtube.channels().then((data) => {
      if (!cancelled) setChannels(data.channels);
    }).catch(() => { if (!cancelled) setError('Could not load your channels. Reopen the guide to try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const categories = groups.filter((group) => group.kind === 'category');
  const categoryNames = categories.length ? categories.map((group) => group.name) : CATEGORY_ORDER;
  const sectionNames = (name: string) => {
    const parent = categories.find((group) => group.name === name);
    return parent ? groups.filter((group) => group.parentId === parent.id).map((group) => group.name) : SECTION_ORDER[name] || [];
  };
  const currentCategory = categories.find((group) => group.name === category);
  const sections = groups.filter((group) => group.parentId === currentCategory?.id);
  const ordered = useMemo(() => {
    const sorted = channels.slice().sort((a, b) => {
      const aBase = getCategoryChannelBase(a.category, categoryNames);
      const bBase = getCategoryChannelBase(b.category, categoryNames);
      if (aBase !== bBase) return aBase - bBase;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      const aSecIndex = orderIndex(sectionNames(a.category), a.section);
      const bSecIndex = orderIndex(sectionNames(b.category), b.section);
      if (aSecIndex !== bSecIndex) return aSecIndex - bSecIndex;
      if (a.section !== b.section) return a.section.localeCompare(b.section);
      return a.position - b.position;
    });
    const counts: Record<number, number> = {};
    return sorted.map((channel) => {
      const base = getCategoryChannelBase(channel.category, categoryNames);
      const offset = counts[base] || 0;
      counts[base] = offset + 1;
      return { channel, number: formatChannelNumber(base, offset) };
    });
  }, [channels, groups]);
  const visible = ordered.filter(({ channel }) => (category === 'All channels' || channel.category === category) && (!section || channel.section === section));

  useEffect(() => {
    let cancelled = false;
    for (let i = 0; i < ordered.length; i += 4) {
      const ids = ordered.slice(i, i + 4).map(({ channel }) => channel.id);
      window.funtube.feed(ids).then((data) => {
        if (cancelled) return;
        setCreators((previous) => ({ ...previous, ...Object.fromEntries(data.creators.map((creator) => [creator.channelId, creator])) }));
        if (data.warnings.length) {
          const keyWarning = data.warnings.find((w) => /firecrawl|key/i.test(w));
          setError(keyWarning || 'Some feeds could not refresh. Saved videos are shown where available. Check Video feeds in Settings.');
        }
      }).catch(() => {
        if (!cancelled) setFailed((previous) => new Set([...previous, ...ids]));
      });
    }
    return () => { cancelled = true; };
  }, [ordered]);

  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
    setHistoryPage(0);
    setHeld(null);
    setPinned(false);
    setPreview(null);
  }, [category, section, setPreview]);


  useEffect(() => {
    if (held) return;
    for (const row of visible) {
      const video = creators[row.channel.id]?.videos[historyPage * 4];
      if (video) { setHeld({ ...row, video }); break; }
    }
  }, [visible, creators, held, historyPage]);

  useEffect(() => {
    if (held) setPreview({ ...held.video, channelId: held.channel.id, creatorName: held.channel.name, platform: held.channel.platform, channelNumber: held.number });
  }, [held, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, row: number, column: number) {
    const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const targetRow = row + direction[0];
    const cells = scroll.current?.querySelectorAll<HTMLButtonElement>(`[data-row="${targetRow}"] .cell-video`);
    if (!cells?.length) return;
    const targetColumn = direction[0] ? Math.min(column, cells.length - 1) : column + direction[1];
    cells[targetColumn]?.focus();
  }

  const maxPage = Math.max(0, ...visible.map(({ channel }) => Math.ceil((creators[channel.id]?.videos.length || 0) / 4) - 1));
  function changePage(page: number) { setHistoryPage(page); setHeld(null); setPinned(false); }
  return <div className="tv-guide">
    {category !== 'All channels' && <div className="guide-sections" role="group" aria-label={`${category} sections`}>
      <button aria-pressed={!section} onClick={() => onSectionChange('')}>All sections</button>
      {sections.map((group) => <button key={group.id} aria-pressed={section === group.name} onClick={() => onSectionChange(group.name)}><GuideIcon icon={group.icon} />{group.name}</button>)}
    </div>}
    <div className="guide-history"><button disabled={historyPage === 0} onClick={() => changePage(historyPage - 1)}>← Newer</button><span>{historyPage === 0 ? 'Latest uploads' : `Older uploads · page ${historyPage + 1}`} · select a show for details above</span><button disabled={historyPage >= maxPage} onClick={() => changePage(historyPage + 1)}>Older →</button></div>
    <div className="guide-column-headings" aria-hidden="true"><span>CHANNEL</span><div><span>{historyPage ? `UPLOAD ${historyPage * 4 + 1}` : 'LATEST UPLOAD'}</span><span>{historyPage ? `UPLOAD ${historyPage * 4 + 2}` : 'PREVIOUS'}</span><span>{historyPage ? `UPLOAD ${historyPage * 4 + 3}` : 'EARLIER'}</span><span>{historyPage ? `UPLOAD ${historyPage * 4 + 4}` : 'MORE'}</span></div></div>
    {error && <div className="guide-notice" role="status">
      <span>{error}</span>
      <button type="button" className="guide-notice-dismiss" onClick={() => setError('')} aria-label="Dismiss notice">✕</button>
    </div>}
    <div className="guide-scroll" ref={scroll} aria-label={`${category} video guide`}>
      {loading ? <div className="guide-status" role="status">Tuning in…</div> : visible.length === 0 ? <div className="guide-status">No channels here yet. Add a channel in Settings.</div> : visible.map(({ channel, number }, row) => {
        const creator = creators[channel.id];
        const videos = creator?.videos.slice(historyPage * 4, historyPage * 4 + 4) || [];
        const isChannelHeld = held?.channel.id === channel.id;
        const firstVideo = videos[0];
        return <div className="guide-row" key={channel.id} data-row={row}>
          <a
            className={`row-channel${isChannelHeld ? ' row-channel-held' : ''}`}
            href={channel.url}
            target="_blank"
            rel="noreferrer"
            title={`${number} · ${channel.name} · ${channel.platform}`}
            onClick={(event) => {
              if (!event.ctrlKey && !event.metaKey && !event.shiftKey) event.preventDefault();
              if (firstVideo) { setHeld({ video: firstVideo, channel, number }); setPinned(true); }
            }}
          >
            <span className="row-num">{number}</span>
            <span className="row-channel-details"><span className="row-name">{channel.name}</span><span className="row-provider">{channel.platform}</span>{channel.section && <span className="row-section"><GuideIcon icon={groups.find((group) => group.kind === 'section' && group.name === channel.section && group.parentId === categories.find((parent) => parent.name === channel.category)?.id)?.icon || 'folder'} />{channel.section}</span>}</span>
          </a>
          <div className="row-cells">
            {failed.has(channel.id) ? <div className="cell cell-empty">Couldn’t load this channel. Reopen the guide to retry.</div> : !creator ? <div className="cell cell-empty cell-loading">Loading programs…</div> : videos.length === 0 ? <div className="cell cell-empty">No videos on this page</div> : <>
              {videos.map((video, column) => {
                const isSelected = held?.channel.id === channel.id && held.video.id === video.id;
                const select = () => setHeld({ video, channel, number });
                return <button
                  type="button"
                  key={video.id}
                  className={`cell cell-video${isSelected ? ' cell-focused' : ''}`}
                  aria-pressed={isSelected}
                  aria-controls="program-preview"
                  onClick={() => { select(); setPinned(true); }}
                  onMouseEnter={() => { if (!pinned) select(); }}
                  onFocus={select}
                  onKeyDown={(event) => navigate(event, row, column)}
                  title={`${video.title} · ${formatVideoDate(video.time, video.publishedAt)} · Details above`}
                >
                  <span className="cell-title">{video.title}</span>
                </button>;
              })}
              {videos.length < 4 && <div className="cell cell-unavailable" style={{ gridColumn: `span ${4 - videos.length}` }}>No more saved uploads</div>}
            </>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
