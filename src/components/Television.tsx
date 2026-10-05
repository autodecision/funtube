import React, { useEffect, useMemo, useState } from 'react';
import { useTelevisionPreview } from '../contexts/TelevisionPreviewContext';
import { CATEGORY_ORDER, SECTION_ORDER } from '../constants/television';
import '../styles/Television.css';

type Channel = {
  id: number;
  name: string;
  platform: string;
  avatar: string;
  url: string;
  category: string;
  section: string;
  position: number;
};

type Video = {
  id: string;
  title: string;
  thumbnail: string;
  time: string;
  url: string;
};

type Creator = {
  channelId: number;
  name: string;
  platform: string;
  avatar: string;
  videos: Video[];
};

type Group = { key: string; category: string; section: string; channels: Channel[] };
type Cat = { name: string; sectioned: boolean; groups: Group[] };
type FeedStatus = 'idle' | 'loading' | 'done' | 'error';
type Focused = { video: Video; creatorName: string; platform: string };


const orderIndex = (list: string[], value: string) => {
  const i = list.indexOf(value);
  return i === -1 ? list.length : i;
};

export default function Television() {
  const { setPreview } = useTelevisionPreview();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lazily-loaded video feeds, keyed by numeric channel id.
  const [creators, setCreators] = useState<Record<number, Creator>>({});
  const [feedStatus, setFeedStatus] = useState<Record<string, FeedStatus>>({});

  const [openCats, setOpenCats] = useState<Set<string>>(new Set(['Science & Learning']));
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Science & Learning/Experiments']));
  const [focused, setFocused] = useState<Focused | null>(null);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    window.funtube.channels()
      .then((data) => {
        setChannels(data.channels || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load the guide');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Build the ordered category → section → channel tree, plus a stable channel
  // number for each row (cable-guide style).
  const { cats, numbers } = useMemo(() => {
    const byCat = new Map<string, Channel[]>();
    for (const ch of channels) {
      const cat = ch.category || 'Uncategorized';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(ch);
    }
    const catNames = [...byCat.keys()].sort(
      (a, b) => orderIndex(CATEGORY_ORDER, a) - orderIndex(CATEGORY_ORDER, b) || a.localeCompare(b),
    );

    const cats: Cat[] = catNames.map((name) => {
      const list = byCat.get(name)!.slice().sort((a, b) => a.position - b.position);
      const sections = [...new Set(list.map((c) => c.section))];
      const named = sections.filter(Boolean);
      if (named.length === 0) {
        return { name, sectioned: false, groups: [{ key: `${name}/`, category: name, section: '', channels: list }] };
      }
      const order = SECTION_ORDER[name] || [];
      named.sort((a, b) => orderIndex(order, a) - orderIndex(order, b) || a.localeCompare(b));
      const groups: Group[] = named.map((section) => ({
        key: `${name}/${section}`,
        category: name,
        section,
        channels: list.filter((c) => c.section === section),
      }));
      const loose = list.filter((c) => !c.section);
      if (loose.length) groups.push({ key: `${name}/`, category: name, section: 'Other', channels: loose });
      return { name, sectioned: true, groups };
    });

    // Number rows in display order, like channel numbers on a cable box.
    const numbers: Record<number, number> = {};
    let n = 201;
    for (const cat of cats) for (const g of cat.groups) for (const ch of g.channels) numbers[ch.id] = n++;
    return { cats, numbers };
  }, [channels]);

  // Once any feed loads, preview the first available video.
  useEffect(() => {
    if (focused) return;
    for (const cr of Object.values(creators)) {
      if (cr.videos?.length) {
        setFocused({ video: cr.videos[0], creatorName: cr.name, platform: cr.platform });
        return;
      }
    }
  }, [creators, focused]);

  // The preview itself renders in the SecondaryInfoBar (above the Media-mode
  // toggle), so push the focused program out to shared context. Clear it when
  // the guide unmounts (leaving Television) so the bar doesn't show a stale card.
  useEffect(() => {
    if (!focused) return;
    setPreview({
      title: focused.video.title,
      thumbnail: focused.video.thumbnail,
      url: focused.video.url,
      time: focused.video.time,
      platform: focused.platform,
      creatorName: focused.creatorName,
    });
  }, [focused, setPreview]);

  useEffect(() => () => setPreview(null), [setPreview]);

  function loadGroup(group: Group) {
    setFeedStatus((prev) => {
      if (prev[group.key] && prev[group.key] !== 'error') return prev; // already loading or loaded
      const ids = group.channels.map((c) => c.id);
      window.funtube.feed(ids)
        .then((data) => {
          const map: Record<number, Creator> = {};
          for (const cr of data.creators || []) map[cr.channelId] = cr;
          setCreators((c) => ({ ...c, ...map }));
          if (data.warnings?.length) setError(data.warnings.join(' '));
          setFeedStatus((s) => ({ ...s, [group.key]: 'done' }));
        })
        .catch(() => setFeedStatus((s) => ({ ...s, [group.key]: 'error' })));
      return { ...prev, [group.key]: 'loading' };
    });
  }

  useEffect(() => {
    const initialGroup = cats.flatMap((cat) => cat.groups).find((group) => group.key === 'Science & Learning/Experiments');
    if (initialGroup) loadGroup(initialGroup);
  }, [cats]);

  function toggleCat(cat: Cat) {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat.name)) {
        next.delete(cat.name);
      } else {
        next.add(cat.name);
        // A category without subsections loads its channels as soon as it opens.
        if (!cat.sectioned) loadGroup(cat.groups[0]);
      }
      return next;
    });
  }

  function toggleGroup(group: Group) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group.key)) next.delete(group.key);
      else {
        next.add(group.key);
        loadGroup(group);
      }
      return next;
    });
  }

  const timeLabel = clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateLabel = clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  if (loading) {
    return (
      <div className="tv-guide">
        <div className="guide-topbar"><span className="guide-brand">Funtube</span></div>
        <div className="guide-status">Tuning in…</div>
      </div>
    );
  }
  if (error && channels.length === 0) {
    return (
      <div className="tv-guide">
        <div className="guide-topbar"><span className="guide-brand">Funtube</span></div>
        <div className="guide-status guide-status-error">{error}</div>
      </div>
    );
  }

  const renderRows = (group: Group) => {
    const status = feedStatus[group.key] || 'idle';
    return group.channels.map((ch) => {
      const creator = creators[ch.id];
      const vids = creator?.videos || [];
      return (
        <div className="guide-row" key={ch.id}>
          <a className="row-channel" href={ch.url} target="_blank" rel="noreferrer" title={ch.name}>
            <span className="row-num">{numbers[ch.id]}</span>
            {ch.avatar ? <img className="row-logo" src={ch.avatar} alt="" loading="lazy" /> : <span className="row-logo row-logo-blank" />}
            <span className="row-name">{ch.name}</span>
          </a>
          <div className="row-cells">
            {status === 'done' && vids.length === 0 && <div className="cell cell-empty">No recent videos</div>}
            {status === 'error' && <div className="cell cell-empty">Couldn’t load this channel</div>}
            {(status === 'loading' || status === 'idle') &&
              [0, 1, 2, 3].map((i) => <div className="cell cell-skeleton" key={i} />)}
            {status === 'done' &&
              vids.map((v) => {
                const isFocused = focused?.video.id === v.id;
                const focus = () => setFocused({ video: v, creatorName: ch.name, platform: creator!.platform });
                return (
                  <a
                    key={v.id}
                    className={`cell cell-video${isFocused ? ' cell-focused' : ''}`}
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    onMouseEnter={focus}
                    onFocus={focus}
                    title={v.title}
                  >
                    <span className="cell-title">{v.title}</span>
                    {v.time && <span className="cell-time">{v.time}</span>}
                  </a>
                );
              })}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="tv-guide">
      <div className="guide-topbar">
        <span className="guide-clock">{dateLabel} · {timeLabel}</span>
        <span className="guide-brand">Funtube</span>
      </div>

      {error && <div className="guide-notice" role="status">{error}</div>}
      <div className="guide-scroll">
        {cats.map((cat) => {
          const catOpen = openCats.has(cat.name);
          const channelCount = cat.groups.reduce((sum, g) => sum + g.channels.length, 0);
          return (
            <div className="guide-category" key={cat.name}>
              <button className="cat-header" onClick={() => toggleCat(cat)} aria-expanded={catOpen}>
                <span className="chevron">{catOpen ? '▾' : '▸'}</span>
                <span className="cat-name">{cat.name}</span>
                <span className="cat-count">{channelCount}</span>
              </button>

              {catOpen && cat.sectioned &&
                cat.groups.map((g) => {
                  const groupOpen = openGroups.has(g.key);
                  return (
                    <div className="guide-section" key={g.key}>
                      <button className="section-header" onClick={() => toggleGroup(g)} aria-expanded={groupOpen}>
                        <span className="chevron">{groupOpen ? '▾' : '▸'}</span>
                        <span className="section-name">{g.section}</span>
                        <span className="cat-count">{g.channels.length}</span>
                      </button>
                      {groupOpen && <div className="guide-rows">{renderRows(g)}</div>}
                    </div>
                  );
                })}

              {catOpen && !cat.sectioned && <div className="guide-rows">{renderRows(cat.groups[0])}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
