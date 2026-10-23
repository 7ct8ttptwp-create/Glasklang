import { useEffect, useMemo, useState } from 'react';
import { getJson, setJson, Track } from '../lib/api';
import { useExtras } from '../lib/extras';
import { useStore } from '../lib/store';
import { basename } from '../lib/util';
import { Icon } from './Icon';
import { TrackList } from './TrackList';

type Tab = 'years' | 'folders' | 'dupes' | 'smart';

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

function Results({ title, sub, list, onBack }: { title: string; sub: string; list: Track[]; onBack?: () => void }) {
  const playList = useStore((s) => s.playList);
  const update = useStore((s) => s.updateSettings);
  return (
    <>
      <div className="view-header">
        <div className="vh-text">
          <h1>{title}</h1>
          <div className="sub">{sub}</div>
        </div>
        <div className="vh-actions">
          {onBack && (
            <button className="btn" onClick={onBack}>
              Back
            </button>
          )}
          <button className="btn primary" disabled={list.length === 0} onClick={() => playList(list, 0)}>
            <Icon name="play" size={16} /> Play
          </button>
          <button
            className="btn"
            disabled={list.length === 0}
            onClick={() => {
              update({ shuffle: true });
              playList(list, Math.floor(Math.random() * list.length));
            }}
          >
            <Icon name="shuffle" size={16} /> Shuffle
          </button>
        </div>
      </div>
      <TrackList tracks={list} onPlay={(i) => playList(list, i)} empty="Nothing matches." />
    </>
  );
}

/** Browse by decade, folder, find duplicates, and saved smart lists. */
export function BrowseView() {
  const [tab, setTab] = useState<Tab>('years');
  const tabs: [Tab, string][] = [
    ['years', 'Years'],
    ['folders', 'Folders'],
    ['dupes', 'Duplicates'],
    ['smart', 'Smart lists'],
  ];
  return (
    <>
      <div className="view-header">
        <div className="vh-text">
          <h1>Browse</h1>
          <div className="sub">Find music in other ways</div>
        </div>
      </div>
      <div className="browse-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={`btn small${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="browse-body">
        {tab === 'years' && <YearsTab />}
        {tab === 'folders' && <FoldersTab />}
        {tab === 'dupes' && <DupesTab />}
        {tab === 'smart' && <SmartTab />}
      </div>
    </>
  );
}

function YearsTab() {
  const tracks = useStore((s) => s.tracks);
  const [decade, setDecade] = useState<number | null>(null);
  const groups = useMemo(() => {
    const m = new Map<number, Track[]>();
    for (const t of tracks) {
      if (!t.year) continue;
      const d = Math.floor(t.year / 10) * 10;
      const arr = m.get(d);
      if (arr) arr.push(t);
      else m.set(d, [t]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [tracks]);

  if (decade !== null) {
    const list = (groups.find(([d]) => d === decade)?.[1] ?? []).slice().sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    return <Results title={`${decade}s`} sub={`${list.length} songs`} list={list} onBack={() => setDecade(null)} />;
  }
  if (groups.length === 0) return <div className="empty">None of your songs have a year tag.</div>;
  return (
    <div className="chip-grid">
      {groups.map(([d, list]) => (
        <button key={d} className="chip-card glass-soft" onClick={() => setDecade(d)}>
          <strong>{d}s</strong>
          <small>{list.length} songs</small>
        </button>
      ))}
    </div>
  );
}

function FoldersTab() {
  const tracks = useStore((s) => s.tracks);
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, Track[]>();
    for (const t of tracks) {
      const d = dirOf(t.path);
      const arr = m.get(d);
      if (arr) arr.push(t);
      else m.set(d, [t]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tracks]);

  if (open !== null) {
    const list = groups.find(([d]) => d === open)?.[1] ?? [];
    return <Results title={basename(open)} sub={open} list={list} onBack={() => setOpen(null)} />;
  }
  if (groups.length === 0) return <div className="empty">Add a music folder first.</div>;
  return (
    <div className="folder-list">
      {groups.map(([d, list]) => (
        <button key={d} className="row" onClick={() => setOpen(d)} title={d}>
          <Icon name="folderPlus" size={16} />
          <span className="fl-name">{basename(d)}</span>
          <span className="fl-path">{d}</span>
          <span className="badge">{list.length}</span>
        </button>
      ))}
    </div>
  );
}

function DupesTab() {
  const tracks = useStore((s) => s.tracks);
  const playList = useStore((s) => s.playList);
  const groups = useMemo(() => {
    const norm = (x: string) => x.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const m = new Map<string, Track[]>();
    for (const t of tracks) {
      const key = `${norm(t.artist)}|${norm(t.title)}`;
      if (!norm(t.title)) continue;
      const arr = m.get(key);
      if (arr) arr.push(t);
      else m.set(key, [t]);
    }
    const out: Track[][] = [];
    for (const arr of m.values()) {
      if (arr.length < 2) continue;
      // same song = durations within 3 seconds of another copy
      const same = arr.filter((a) => arr.some((b) => b !== a && Math.abs(a.duration_ms - b.duration_ms) < 3000));
      if (same.length >= 2) out.push(same);
    }
    return out.sort((a, b) => b.length - a.length);
  }, [tracks]);

  if (groups.length === 0) return <div className="empty">No duplicates found. Your library is tidy.</div>;
  return (
    <div className="dupes">
      <p className="hint">{groups.length} songs exist more than once. Nothing is deleted by Glasklang - this just shows where the copies are.</p>
      {groups.map((g) => (
        <div key={g[0].id} className="dupe-group glass-soft">
          <div className="dupe-title">
            {g[0].title} <small>{g[0].artist}</small>
          </div>
          {g.map((t, i) => (
            <button key={t.id} className="dupe-copy" onClick={() => playList(g, i)} title="Play this copy">
              <Icon name="play" size={13} />
              <span>{t.path}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

interface Rule {
  id: number;
  name: string;
  text: string;
  yearFrom: string;
  yearTo: string;
  minPlays: string;
  favOnly: boolean;
  notPlayed: boolean;
}

const BLANK: Omit<Rule, 'id'> = { name: '', text: '', yearFrom: '', yearTo: '', minPlays: '', favOnly: false, notPlayed: false };

function SmartTab() {
  const tracks = useStore((s) => s.tracks);
  const favs = useExtras((s) => s.favs);
  const plays = useExtras((s) => s.plays);
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Omit<Rule, 'id'>>(BLANK);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    void getJson<Rule[]>('smartLists').then((r) => r && setRules(r));
  }, []);

  const save = (next: Rule[]) => {
    setRules(next);
    void setJson('smartLists', next);
  };

  const run = (r: Omit<Rule, 'id'>): Track[] => {
    const q = r.text.trim().toLowerCase();
    const from = r.yearFrom ? Number(r.yearFrom) : null;
    const to = r.yearTo ? Number(r.yearTo) : null;
    const min = r.minPlays ? Number(r.minPlays) : null;
    const favSet = new Set(favs);
    return tracks.filter((t) => {
      if (q && !`${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) return false;
      if (from !== null && (!t.year || t.year < from)) return false;
      if (to !== null && (!t.year || t.year > to)) return false;
      const c = plays[t.path]?.count ?? 0;
      if (min !== null && c < min) return false;
      if (r.notPlayed && c > 0) return false;
      if (r.favOnly && !favSet.has(t.path)) return false;
      return true;
    });
  };

  const active = rules.find((r) => r.id === openId);
  if (active) return <Results title={active.name} sub="Smart list" list={run(active)} onBack={() => setOpenId(null)} />;

  const preview = run(draft).length;
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  return (
    <div className="smart">
      <div className="smart-list">
        {rules.length === 0 && <div className="hint">No smart lists yet. Make one below - it updates itself as your library changes.</div>}
        {rules.map((r) => (
          <div key={r.id} className="row">
            <button className="sl-open" onClick={() => setOpenId(r.id)}>
              <Icon name="list" size={16} /> <span>{r.name}</span> <span className="badge">{run(r).length}</span>
            </button>
            <button className="icon-btn" title="Delete list" onClick={() => save(rules.filter((x) => x.id !== r.id))}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="smart-form glass-soft">
        <h3>New smart list</h3>
        <input placeholder="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        <input placeholder="Contains (title, artist or album)" value={draft.text} onChange={(e) => set({ text: e.target.value })} />
        <div className="sf-row">
          <input placeholder="Year from" inputMode="numeric" value={draft.yearFrom} onChange={(e) => set({ yearFrom: e.target.value.replace(/\D/g, '') })} />
          <input placeholder="Year to" inputMode="numeric" value={draft.yearTo} onChange={(e) => set({ yearTo: e.target.value.replace(/\D/g, '') })} />
          <input placeholder="Min plays" inputMode="numeric" value={draft.minPlays} onChange={(e) => set({ minPlays: e.target.value.replace(/\D/g, '') })} />
        </div>
        <label className="np-check">
          <input type="checkbox" checked={draft.favOnly} onChange={(e) => set({ favOnly: e.target.checked })} /> Only favorites
        </label>
        <label className="np-check">
          <input type="checkbox" checked={draft.notPlayed} onChange={(e) => set({ notPlayed: e.target.checked })} /> Never played
        </label>
        <div className="sf-row">
          <span className="hint">{preview} songs match</span>
          <button
            className="btn primary small"
            disabled={!draft.name.trim()}
            onClick={() => {
              save([...rules, { ...draft, name: draft.name.trim(), id: Date.now() }]);
              setDraft(BLANK);
            }}
          >
            Save list
          </button>
        </div>
      </div>
    </div>
  );
}
