import { open } from '@tauri-apps/plugin-dialog';
import { FormEvent, useEffect, useState } from 'react';
import { api, Track, YtItem, YtStatus } from '../lib/api';
import { useStore } from '../lib/store';
import { useYt } from '../lib/yt';
import { formatTime } from '../lib/util';
import { Icon } from './Icon';

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, '');

/** Hash a video id into a negative number so streamed songs never clash with library ids. */
function fakeId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return -(Math.abs(h) + 1);
}

export function YouTubeView() {
  const enabled = useYt((s) => s.enabled);
  const saveDir = useYt((s) => s.saveDir);
  const toast = useStore((s) => s.toast);
  const playList = useStore((s) => s.playList);
  const reloadTracks = useStore((s) => s.reloadTracks);
  const setCustomCover = useStore((s) => s.setCustomCover);
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<YtItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (enabled) void api.ytStatus().then(setStatus).catch(() => setStatus({ installed: false, version: null }));
  }, [enabled]);

  if (!enabled) {
    return (
      <div className="empty">
        YouTube is switched off. Turn it on in Settings &gt; Look &gt; YouTube if you want to use it.
      </div>
    );
  }

  if (!status) return <div className="empty">Checking...</div>;

  if (!status.installed) {
    return (
      <div className="yt-install glass-soft">
        <h2>Set up YouTube</h2>
        <p>
          Glasklang uses the free program <b>yt-dlp</b> for this. Pressing Install downloads the official yt-dlp.exe from
          github.com/yt-dlp (about 20 MB) into Glasklang's own data folder. Nothing else is installed.
        </p>
        <p className="hint">
          Only download what you are allowed to. YouTube's terms forbid downloading, and copyrighted music is protected - using this is your own responsibility.
        </p>
        <button
          className="btn primary"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            api
              .ytInstall()
              .then(() => api.ytStatus())
              .then((s) => {
                setStatus(s);
                toast(s.installed ? 'yt-dlp installed' : 'Install finished but yt-dlp did not start', s.installed ? 'info' : 'error');
              })
              .catch((e) => toast(errText(e), 'error'))
              .finally(() => setInstalling(false));
          }}
        >
          {installing ? 'Downloading...' : 'Install yt-dlp'}
        </button>
      </div>
    );
  }

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    api
      .ytSearch(query)
      .then(setItems)
      .catch((err) => {
        setItems([]);
        toast(errText(err), 'error');
      })
      .finally(() => setSearching(false));
  };

  const stream = (it: YtItem) => {
    setBusy(`s${it.id}`);
    api
      .ytFetch(it.id, false, null)
      .then(async (f) => {
        const t: Track = {
          id: fakeId(it.id),
          path: f.path,
          title: it.title,
          artist: it.channel || 'YouTube',
          album: 'YouTube',
          album_artist: '',
          track_no: null,
          disc_no: null,
          year: null,
          duration_ms: Math.round(it.duration * 1000),
        };
        if (f.cover) await setCustomCover([t], f.cover, true);
        playList([t], 0);
      })
      .catch((err) => toast(errText(err), 'error'))
      .finally(() => setBusy(null));
  };

  const save = (it: YtItem) => {
    setBusy(`d${it.id}`);
    api
      .ytFetch(it.id, true, saveDir || null)
      .then(async (f) => {
        await reloadTracks();
        const saved = useStore.getState().tracks.find((t) => t.path === f.path);
        if (saved && f.cover) await setCustomCover([saved], f.cover, true);
        toast(`Saved "${it.title}" to your library`);
      })
      .catch((err) => toast(errText(err), 'error'))
      .finally(() => setBusy(null));
  };

  return (
    <>
      <div className="view-header">
        <div className="vh-text">
          <h1>YouTube</h1>
          <div className="sub">Search, play right away, or save to your library{status.version ? ` - yt-dlp ${status.version}` : ''}</div>
        </div>
      </div>
      <form className="yt-search" onSubmit={search}>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a song or artist" />
        <button className="btn primary" type="submit" disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>
      <div className="yt-results">
        {items.length === 0 && searched && !searching && <div className="empty">No results.</div>}
        {items.map((it) => (
          <div key={it.id} className="yt-row">
            <div className="yt-meta">
              <div className="yt-title" title={it.title}>{it.title}</div>
              <div className="yt-sub">
                {it.channel}
                {it.duration > 0 ? ` - ${formatTime(it.duration)}` : ''}
              </div>
            </div>
            <button className="btn small" disabled={busy !== null} onClick={() => stream(it)} title="Play now (temporary, not added to your library)">
              <Icon name="play" size={14} /> {busy === `s${it.id}` ? 'Loading...' : 'Play'}
            </button>
            <button className="btn small" disabled={busy !== null} onClick={() => save(it)} title="Download to your library so you can use it in playlists">
              <Icon name="download" size={14} /> {busy === `d${it.id}` ? 'Saving...' : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

/** The on/off switch and options for the YouTube feature, shown in Settings. */
export function YtSettings() {
  const yt = useYt();
  const toast = useStore((s) => s.toast);
  const [version, setVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (yt.enabled) void api.ytStatus().then((s) => setVersion(s.installed ? s.version : null)).catch(() => undefined);
  }, [yt.enabled]);

  return (
    <>
      <label className="switch-row">
        <span>
          YouTube (yt-dlp)
          <small>Off by default. When on, Glasklang can search YouTube and download songs. Everything else stays offline.</small>
        </span>
        <input type="checkbox" checked={yt.enabled} onChange={(e) => yt.set({ enabled: e.target.checked })} />
        <span className="switch" aria-hidden="true" />
      </label>
      {yt.enabled && (
        <div className="row">
          <button
            className="btn small"
            onClick={() => {
              void open({ directory: true, multiple: false, title: 'Where should saved songs go?' }).then((d) => {
                if (typeof d === 'string') yt.set({ saveDir: d });
              });
            }}
          >
            <Icon name="folderPlus" size={15} /> Save folder
          </button>
          <span className="hint">{yt.saveDir || 'Music/Glasklang (default)'}</span>
          <button
            className="btn small"
            disabled={updating || !version}
            onClick={() => {
              setUpdating(true);
              api
                .ytUpdate()
                .then((m) => toast(m || 'yt-dlp is up to date'))
                .catch((e) => toast(errText(e), 'error'))
                .finally(() => setUpdating(false));
            }}
          >
            <Icon name="refresh" size={15} /> {updating ? 'Updating...' : 'Update yt-dlp'}
          </button>
        </div>
      )}
    </>
  );
}
