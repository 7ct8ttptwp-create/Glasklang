import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../lib/api';
import { useExtras } from '../lib/extras';
import { useFx } from '../lib/fx';
import { useStore } from '../lib/store';
import { formatDuration } from '../lib/util';
import { Icon } from './Icon';
import { TrackList } from './TrackList';

// ---------------------------------------------------------------------------
// Background helper: play counting, sleep timer, keyboard shortcuts, time-of-day look
// ---------------------------------------------------------------------------

const isTyping = (el: HTMLElement | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && (el as HTMLInputElement).type !== 'range';

const TIME_ACCENTS: { from: number; to: number; accent: string | null }[] = [
  { from: 5, to: 11, accent: '#4fc3f7' }, // morning: cool blue
  { from: 11, to: 17, accent: null }, // daytime: Windows accent
  { from: 17, to: 22, accent: '#ff9f6b' }, // evening: warm
  { from: 22, to: 29, accent: '#8b7bff' }, // night: violet (22-5)
];

function accentForNow(): string | null {
  let h = new Date().getHours();
  if (h < 5) h += 24;
  return TIME_ACCENTS.find((r) => h >= r.from && h < r.to)?.accent ?? null;
}

export function ExtrasRunner() {
  const load = useExtras((s) => s.load);
  const glow = useExtras((s) => s.glow);
  const timeTheme = useExtras((s) => s.timeTheme);
  const recordPlay = useExtras((s) => s.recordPlay);
  const track = useStore((s) => s.queue[s.index]);
  const playing = useStore((s) => s.playing);
  const position = useStore((s) => s.position);
  const ready = useStore((s) => s.ready);
  const counted = useRef<string | null>(null);
  const fadeBase = useRef<number | null>(null);

  useEffect(() => {
    void load();
    void useFx.getState().load();
  }, [load]);

  // soft glow from the cover color
  useEffect(() => {
    document.documentElement.dataset.glow = glow ? 'on' : 'off';
  }, [glow]);

  // count a play after 20 seconds of listening
  useEffect(() => {
    if (!track) return;
    if (position < 2 && counted.current === track.path) counted.current = null;
    if (playing && position >= 20 && counted.current !== track.path) {
      counted.current = track.path;
      recordPlay(track.path);
    }
  }, [track, playing, position, recordPlay]);

  // time-of-day accent color
  useEffect(() => {
    if (!timeTheme || !ready) return;
    const apply = () => {
      const a = accentForNow();
      if (useStore.getState().settings.accent !== a) useStore.getState().updateSettings({ accent: a });
    };
    apply();
    const id = window.setInterval(apply, 60_000);
    return () => window.clearInterval(id);
  }, [timeTheme, ready]);

  // sleep timer (fades the volume out over the last 10 seconds)
  useEffect(() => {
    const id = window.setInterval(() => {
      const ex = useExtras.getState();
      const st = useStore.getState();
      const restore = () => {
        if (fadeBase.current !== null) {
          st.updateSettings({ volume: fadeBase.current });
          fadeBase.current = null;
        }
      };
      if (ex.sleep.mode === 'timer') {
        const left = ex.sleep.endsAt - Date.now();
        if (left <= 0) {
          if (st.playing) st.togglePlay();
          restore();
          ex.setSleep({ mode: 'off' });
          st.toast('Sleep timer: music stopped');
        } else if (left <= 10_000) {
          if (fadeBase.current === null) fadeBase.current = st.settings.volume;
          st.updateSettings({ volume: fadeBase.current * (left / 10_000) });
        }
      } else if (ex.sleep.mode === 'track') {
        const cur = st.queue[st.index];
        if (!cur || cur.id !== ex.sleep.armedId) {
          if (st.playing) st.togglePlay();
          ex.setSleep({ mode: 'off' });
          st.toast('Sleep timer: stopped after the song');
        }
      } else {
        restore();
      }
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target as HTMLElement | null)) return;
      const st = useStore.getState();
      const ex = useExtras.getState();
      const cur = st.queue[st.index];
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          st.seek(Math.min(st.duration, st.position + (e.shiftKey ? 15 : 5)));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          st.seek(Math.max(0, st.position - (e.shiftKey ? 15 : 5)));
          break;
        case 'ArrowUp':
          e.preventDefault();
          st.updateSettings({ volume: Math.min(1, Math.round((st.settings.volume + 0.05) * 100) / 100) });
          break;
        case 'ArrowDown':
          e.preventDefault();
          st.updateSettings({ volume: Math.max(0, Math.round((st.settings.volume - 0.05) * 100) / 100) });
          break;
        case 'm':
        case 'M':
          st.updateSettings({ volume: st.settings.volume === 0 ? 0.8 : 0 });
          break;
        case 'n':
        case 'N':
          st.setView(st.view.kind === 'now' ? { kind: 'songs' } : { kind: 'now' });
          break;
        case 'f':
        case 'F':
          if (cur) ex.toggleFav(cur.path);
          break;
        case 's':
        case 'S':
          st.updateSettings({ shuffle: !st.settings.shuffle });
          break;
        case 'r':
        case 'R':
          st.updateSettings({ repeat: st.settings.repeat === 'off' ? 'all' : st.settings.repeat === 'all' ? 'one' : 'off' });
          break;
        case '?':
        case 'F1':
          e.preventDefault();
          ex.setHelp(!ex.helpOpen);
          break;
        case 'Escape':
          if (ex.helpOpen) ex.setHelp(false);
          else if (st.view.kind === 'now') st.setView({ kind: 'songs' });
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// Shortcut help
// ---------------------------------------------------------------------------

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['Left / Right', 'Seek 5 s (Shift: 15 s)'],
  ['Up / Down', 'Volume'],
  ['M', 'Mute'],
  ['N', 'Now playing page'],
  ['F', 'Favorite this song'],
  ['S', 'Shuffle'],
  ['R', 'Repeat'],
  ['Ctrl + F', 'Search'],
  ['?', 'This help'],
  ['Esc', 'Close / back'],
];

export function ShortcutsOverlay() {
  const open = useExtras((s) => s.helpOpen);
  const setHelp = useExtras((s) => s.setHelp);
  if (!open) return null;
  return (
    <>
      <div className="menu-backdrop" style={{ zIndex: 70 }} onClick={() => setHelp(false)} />
      <div className="help glass" role="dialog" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <div className="help-grid">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="help-row">
              <kbd>{k}</kbd>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sleep timer button + menu (used on the Now playing page)
// ---------------------------------------------------------------------------

export function SleepButton() {
  const sleep = useExtras((s) => s.sleep);
  const setSleep = useExtras((s) => s.setSleep);
  const track = useStore((s) => s.queue[s.index]);
  const [pos, setPos] = useState<{ x: number; bottom: number } | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (sleep.mode !== 'timer') return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [sleep.mode]);

  const label =
    sleep.mode === 'timer'
      ? formatDuration(Math.max(0, sleep.endsAt - Date.now()))
      : sleep.mode === 'track'
        ? 'End of song'
        : 'Sleep timer';

  const choose = (s: typeof sleep) => {
    setSleep(s);
    setPos(null);
  };

  return (
    <>
      <button
        className={`btn small${sleep.mode !== 'off' ? ' primary' : ''}`}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 248)), bottom: window.innerHeight - r.top + 8 });
        }}
      >
        <Icon name="moon" size={15} /> {label}
      </button>
      {pos && (
        <>
          <div className="menu-backdrop" onClick={() => setPos(null)} />
          <div className="menu glass" style={{ left: pos.x, bottom: pos.bottom }} role="menu">
            <div className="menu-title">Stop the music after...</div>
            <div className="menu-list" style={{ maxHeight: 260 }}>
              {[15, 30, 45, 60, 90].map((m) => (
                <button key={m} onClick={() => choose({ mode: 'timer', endsAt: Date.now() + m * 60_000 })}>
                  {m} minutes
                </button>
              ))}
              <button disabled={!track} onClick={() => track && choose({ mode: 'track', armedId: track.id })}>
                End of this song
              </button>
              {sleep.mode !== 'off' && <button onClick={() => choose({ mode: 'off' })}>Turn off</button>}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Favorites / recently played / most played
// ---------------------------------------------------------------------------

function ListHeader({ title, sub, list }: { title: string; sub: string; list: Track[] }) {
  const playList = useStore((s) => s.playList);
  const update = useStore((s) => s.updateSettings);
  return (
    <div className="view-header">
      <div className="vh-text">
        <h1>{title}</h1>
        <div className="sub">{sub}</div>
      </div>
      <div className="vh-actions">
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
  );
}

export function SmartView({ kind }: { kind: 'favorites' | 'recent' | 'top' }) {
  const tracks = useStore((s) => s.tracks);
  const playList = useStore((s) => s.playList);
  const favs = useExtras((s) => s.favs);
  const plays = useExtras((s) => s.plays);

  const list = useMemo(() => {
    const byPath = new Map(tracks.map((t) => [t.path, t] as const));
    const pick = (paths: string[]) => paths.map((p) => byPath.get(p)).filter((t): t is Track => !!t);
    if (kind === 'favorites') return pick(favs.slice().reverse());
    const entries = Object.entries(plays);
    if (kind === 'recent') return pick(entries.sort((a, b) => b[1].last - a[1].last).slice(0, 200).map(([p]) => p));
    return pick(entries.filter(([, v]) => v.count > 0).sort((a, b) => b[1].count - a[1].count).slice(0, 200).map(([p]) => p));
  }, [tracks, favs, plays, kind]);

  const title = kind === 'favorites' ? 'Favorites' : kind === 'recent' ? 'Recently played' : 'Most played';
  const empty =
    kind === 'favorites'
      ? 'Tap the heart on a song (or press F while it plays) to add it here.'
      : 'Songs show up here after you have listened to them for a while.';
  return (
    <>
      <ListHeader title={title} sub={`${list.length} ${list.length === 1 ? 'song' : 'songs'}`} list={list} />
      <TrackList tracks={list} onPlay={(i) => playList(list, i)} empty={empty} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function StatsView() {
  const tracks = useStore((s) => s.tracks);
  const plays = useExtras((s) => s.plays);
  const favs = useExtras((s) => s.favs);

  const stats = useMemo(() => {
    const byPath = new Map(tracks.map((t) => [t.path, t] as const));
    let totalPlays = 0;
    let totalMs = 0;
    const artists = new Map<string, number>();
    const songs: { t: Track; count: number }[] = [];
    for (const [path, v] of Object.entries(plays)) {
      const t = byPath.get(path);
      if (!t) continue;
      totalPlays += v.count;
      totalMs += v.count * t.duration_ms;
      artists.set(t.artist, (artists.get(t.artist) ?? 0) + v.count);
      songs.push({ t, count: v.count });
    }
    songs.sort((a, b) => b.count - a.count);
    const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { totalPlays, totalMs, topArtists, topSongs: songs.slice(0, 5) };
  }, [tracks, plays]);

  const hours = stats.totalMs / 3_600_000;
  return (
    <>
      <div className="view-header">
        <div className="vh-text">
          <h1>Your listening</h1>
          <div className="sub">Stored only on this computer</div>
        </div>
      </div>
      <div className="stats">
        <div className="stat glass-soft"><b>{stats.totalPlays}</b><span>plays</span></div>
        <div className="stat glass-soft"><b>{hours < 10 ? hours.toFixed(1) : Math.round(hours)}</b><span>hours listened</span></div>
        <div className="stat glass-soft"><b>{favs.length}</b><span>favorites</span></div>
        <div className="stat glass-soft"><b>{tracks.length.toLocaleString()}</b><span>songs in library</span></div>

        <div className="stat-list glass-soft">
          <h3>Top artists</h3>
          {stats.topArtists.length === 0 && <div className="muted">Nothing yet</div>}
          {stats.topArtists.map(([a, c]) => (
            <div className="stat-row" key={a}><span>{a}</span><span>{c}</span></div>
          ))}
        </div>
        <div className="stat-list glass-soft">
          <h3>Top songs</h3>
          {stats.topSongs.length === 0 && <div className="muted">Nothing yet</div>}
          {stats.topSongs.map(({ t, count }) => (
            <div className="stat-row" key={t.id}><span>{t.title}</span><span>{count}</span></div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings section (goes into the Look tab)
// ---------------------------------------------------------------------------

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="switch-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function ExtrasSettings() {
  const glow = useExtras((s) => s.glow);
  const timeTheme = useExtras((s) => s.timeTheme);
  const setGlow = useExtras((s) => s.setGlow);
  const setTimeTheme = useExtras((s) => s.setTimeTheme);
  const exportBackup = useExtras((s) => s.exportBackup);
  const importBackup = useExtras((s) => s.importBackup);
  const setHelp = useExtras((s) => s.setHelp);
  const fx = useFx();
  return (
    <>
      <label className="switch-row">
        <span>
          Crossfade
          <small>{fx.crossfade === 0 ? 'Off - songs hop with almost no gap' : `Songs overlap for ${fx.crossfade} seconds`}</small>
        </span>
        <input type="range" min={0} max={12} step={1} value={fx.crossfade} onChange={(e) => fx.set({ crossfade: Number(e.target.value) })} />
      </label>
      <Toggle label="Visualizer" hint="Moving bars on the Now playing page" checked={fx.visualizer} onChange={(b) => fx.set({ visualizer: b })} />
      <Toggle label="Breathing cover" hint="The big cover pulses gently with the bass" checked={fx.breathe} onChange={(b) => fx.set({ breathe: b })} />
      <Toggle label="Lyrics" hint="Shows synced lyrics from a .lrc file with the same name as the song" checked={fx.lyrics} onChange={(b) => fx.set({ lyrics: b })} />
      <Toggle label="Cover glow" hint="The window softly glows in the color of the current cover" checked={glow} onChange={setGlow} />
      <Toggle label="Time-of-day accent" hint="Cool in the morning, warm in the evening, violet at night" checked={timeTheme} onChange={setTimeTheme} />
      <div className="row">
        <button className="btn small" onClick={() => void exportBackup()}><Icon name="upload" size={15} /> Back up settings</button>
        <button className="btn small" onClick={() => void importBackup()}><Icon name="download" size={15} /> Restore backup</button>
        <button className="btn small" onClick={() => setHelp(true)}><Icon name="keyboard" size={15} /> Shortcuts</button>
      </div>
    </>
  );
}
