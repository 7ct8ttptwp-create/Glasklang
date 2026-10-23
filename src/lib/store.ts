// Application state (zustand). The audio Engine lives next to it and is driven from here.

import { create } from 'zustand';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { api, getJson, Playlist, ScanStats, setJson, Track } from './api';
import { Engine } from './audio';
import { DEFAULT_SETTINGS, mergeSettings, Settings, themeOf, ThemeData } from './settings';
import { dominantColor, loadCover, setCustomCovers, shuffled } from './util';

export type View =
  | { kind: 'songs' }
  | { kind: 'albums' }
  | { kind: 'artists' }
  | { kind: 'album'; key: string }
  | { kind: 'artist'; artist: string }
  | { kind: 'playlist'; id: number }
  | { kind: 'queue' }
  | { kind: 'now' }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'top' }
  | { kind: 'stats' }
  | { kind: 'browse' };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface State {
  ready: boolean;
  tracks: Track[];
  playlists: Playlist[];
  settings: Settings;
  view: View;
  search: string;
  scanning: boolean;
  scanCount: number;
  dragging: boolean;
  settingsOpen: boolean;
  mini: boolean;

  queue: Track[];
  baseQueue: Track[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  coverUrl: string | null;
  coverVersion: number;
  customCovers: Record<string, string>;
  tint: string | null;
  toasts: Toast[];

  init: () => Promise<void>;
  toast: (text: string, kind?: 'info' | 'error') => void;
  setView: (v: View) => void;
  setSearch: (s: string) => void;
  setSettingsOpen: (b: boolean) => void;
  setDragging: (b: boolean) => void;
  setMini: (b: boolean) => void;

  addPaths: (paths: string[]) => Promise<void>;
  addFolderDialog: () => Promise<void>;
  addFilesDialog: () => Promise<void>;
  rescan: () => Promise<void>;
  reloadTracks: () => Promise<void>;

  playList: (list: Track[], start: number) => void;
  playQueueIndex: (i: number) => void;
  enqueueNext: (t: Track) => void;
  enqueueEnd: (ts: Track[]) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (i: number, delta: number) => void;
  clearQueue: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (s: number) => void;
  setCustomCover: (tracks: Track[], src: string | null) => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => void;
  applyTheme: (t: ThemeData) => void;

  refreshPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<number>;
  addToPlaylist: (id: number, ts: Track[]) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  renamePlaylist: (id: number, name: string) => Promise<void>;
  importM3uDialog: () => Promise<void>;
  exportM3uDialog: (id: number, name: string) => Promise<void>;
}

// ---- module-level helpers (not reactive) ----
let engine: Engine | null = null;
const failed = new Set<number>();
let failStreak = 0;
let saveTimer: number | null = null;
let queueTimer: number | null = null;
let toastId = 1;
let initStarted = false; // React StrictMode runs effects twice in dev; start only once

export const useStore = create<State>()((set, get) => {
  // ---------- internal helpers ----------

  const currentTrack = (): Track | undefined => get().queue[get().index];

  /** Index of the track that should follow the current one, or null at the end of the queue. */
  const nextIndex = (): number | null => {
    const { queue, index, settings } = get();
    const n = queue.length;
    if (n === 0) return null;
    if (settings.repeat === 'one') return index;
    for (let step = 1; step <= n; step++) {
      let i = index + step;
      if (i >= n) {
        if (settings.repeat !== 'all') return null;
        i = i % n;
      }
      if (!failed.has(queue[i].id)) return i;
    }
    return null;
  };

  const refreshPreload = () => {
    if (!engine) return;
    const i = nextIndex();
    engine.setNext(i === null ? null : get().queue[i]);
  };

  const persistQueueSoon = () => {
    if (queueTimer !== null) window.clearTimeout(queueTimer);
    queueTimer = window.setTimeout(() => {
      const { queue, baseQueue, index } = get();
      void setJson('queue', { ids: queue.map((t) => t.id), base: baseQueue.map((t) => t.id), index });
    }, 800);
  };

  const updateMediaSession = (t: Track, cover: string | null) => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: t.album,
        artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
      });
    } catch {
      /* media session is a nice-to-have */
    }
  };

  const showTrack = (t: Track) => {
    set({ duration: t.duration_ms / 1000, position: 0, coverUrl: null });
    updateMediaSession(t, null);
    void loadCover(t.path).then((url) => {
      if (currentTrack()?.id !== t.id) return;
      set({ coverUrl: url });
      updateMediaSession(t, url);
      if (url) {
        void dominantColor(url).then((c) => {
          if (currentTrack()?.id === t.id) set({ tint: c });
        });
      } else {
        set({ tint: null });
      }
    });
  };

  const startAt = (index: number, autoplay: boolean, startPos = 0) => {
    const t = get().queue[index];
    if (!t || !engine) return;
    set({ index });
    showTrack(t);
    void engine.load(t, { autoplay, startAt: startPos });
    refreshPreload();
    persistQueueSoon();
  };

  const saveSettingsSoon = () => {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void setJson('settings', get().settings), 500);
  };

  const applyMediaKeys = async (enabled: boolean) => {
    try {
      await unregisterAll();
      if (!enabled) return;
      await register('MediaPlayPause', (e) => e.state === 'Pressed' && get().togglePlay());
      await register('MediaNextTrack', (e) => e.state === 'Pressed' && get().next());
      await register('MediaPreviousTrack', (e) => e.state === 'Pressed' && get().prev());
    } catch (e) {
      void api.logError(`media keys: ${String(e)}`);
    }
  };

  const wireEngine = () => {
    engine = new Engine({
      onTime: (position, duration) => {
        if (position > 1) failStreak = 0;
        set({ position, duration: duration || get().duration });
      },
      onAdvanced: () => {
        const i = nextIndex();
        if (i === null) return;
        const t = get().queue[i];
        set({ index: i });
        showTrack(t);
        refreshPreload();
        persistQueueSoon();
      },
      onEndedNoNext: () => {
        const i = nextIndex();
        if (i !== null) startAt(i, true);
        else set({ playing: false, position: 0 });
      },
      onError: (trackId) => {
        const t = get().queue.find((x) => x.id === trackId) ?? currentTrack();
        if (t) {
          failed.add(t.id);
          get().toast(`Can't play "${t.title}" - the file is missing or damaged. Skipping.`, 'error');
          void api.logError(`playback failed: ${t.path}`);
        }
        failStreak++;
        const i = nextIndex();
        if (i !== null && failStreak < Math.max(3, get().queue.length)) startAt(i, true);
        else set({ playing: false });
      },
      onPlayState: (playing) => {
        set({ playing });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      },
    });

    const s = get().settings;
    engine.setVolume(s.volume);
    engine.setSpeed(s.speed);
    engine.setEq(s.eqEnabled, s.eqGains);

    // Pause when headphones are unplugged / the output device disappears.
    try {
      let outputs = -1;
      const count = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').length;
      void count().then((n) => (outputs = n));
      navigator.mediaDevices.addEventListener('devicechange', () => {
        void count().then((n) => {
          if (outputs >= 0 && n < outputs && engine?.isPlaying) engine.pause();
          outputs = n;
        });
      });
    } catch {
      /* not available: the OS usually pauses for us */
    }

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
        ['play', () => get().togglePlay()],
        ['pause', () => get().togglePlay()],
        ['previoustrack', () => get().prev()],
        ['nexttrack', () => get().next()],
        ['seekto', (d) => d.seekTime !== undefined && d.seekTime !== null && get().seek(d.seekTime)],
      ];
      for (const [action, fn] of handlers) {
        try {
          ms.setActionHandler(action, fn);
        } catch {
          /* unsupported action */
        }
      }
    }
  };

  return {
    ready: false,
    tracks: [],
    playlists: [],
    settings: DEFAULT_SETTINGS,
    view: { kind: 'songs' },
    search: '',
    scanning: false,
    scanCount: 0,
    dragging: false,
    settingsOpen: false,
    mini: false,
    queue: [],
    baseQueue: [],
    index: -1,
    playing: false,
    position: 0,
    duration: 0,
    coverUrl: null,
    coverVersion: 0,
    customCovers: {},
    tint: null,
    toasts: [],

    // ---------- lifecycle ----------

    init: async () => {
      if (initStarted) return;
      initStarted = true;
      const settings = mergeSettings(await getJson<Partial<Settings>>('settings'));
      set({ settings });
      const covers = (await getJson<Record<string, string>>('customCovers')) ?? {};
      setCustomCovers(covers);
      set({ customCovers: covers });
      wireEngine();

      await listen<number>('scan-progress', (e) => set({ scanCount: e.payload }));
      await listen<string>('tray-action', (e) => {
        if (e.payload === 'toggle') get().togglePlay();
        if (e.payload === 'next') get().next();
        if (e.payload === 'prev') get().prev();
      });
      if (settings.forceMediaKeys) void applyMediaKeys(true);

      await get().reloadTracks();
      await get().refreshPlaylists();

      // Restore the last queue and position (paused).
      const byId = new Map(get().tracks.map((t) => [t.id, t]));
      const q = await getJson<{ ids: number[]; base: number[]; index: number }>('queue');
      const pos = await getJson<{ id: number; position: number }>('pos');
      if (q && q.ids.length > 0) {
        const queue = q.ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
        const base = (q.base ?? q.ids).map((id) => byId.get(id)).filter((t): t is Track => !!t);
        if (queue.length > 0) {
          const wanted = q.ids[q.index];
          let idx = queue.findIndex((t) => t.id === wanted);
          if (idx < 0) idx = 0;
          set({ queue, baseQueue: base, index: idx });
          startAt(idx, false, pos && pos.id === queue[idx].id ? pos.position : 0);
          if (pos && pos.id === queue[idx].id) set({ position: pos.position });
        }
      }

      // Remember the playback position every few seconds while playing.
      window.setInterval(() => {
        const t = currentTrack();
        if (t && get().playing) void setJson('pos', { id: t.id, position: get().position });
      }, 5000);
      window.addEventListener('beforeunload', () => {
        const t = currentTrack();
        if (t) void setJson('pos', { id: t.id, position: get().position });
      });

      set({ ready: true });
    },

    toast: (text, kind = 'info') => {
      const id = toastId++;
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4500);
    },

    setView: (view) => set({ view }),

    // Pick your own cover for some tracks (one song or a whole album). It is copied into the
    // app data folder and remembered; src = null goes back to the cover inside the file.
    setCustomCover: async (tracks, src) => {
      try {
        const next = { ...get().customCovers };
        if (src) {
          const stored = await api.importBackground(src);
          for (const t of tracks) next[t.path] = stored;
        } else {
          for (const t of tracks) delete next[t.path];
        }
        setCustomCovers(next);
        set({ customCovers: next, coverVersion: get().coverVersion + 1 });
        await setJson('customCovers', next);
        const cur = currentTrack();
        if (cur && tracks.some((t) => t.id === cur.id)) showTrack(cur);
        get().toast(src ? 'Cover saved' : 'Cover reset');
      } catch (e) {
        get().toast(`Could not set cover: ${String(e)}`, 'error');
      }
    },
    setSearch: (search) => set({ search }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setDragging: (dragging) => set({ dragging }),
    setMini: (mini) => set({ mini }),

    // ---------- library ----------

    reloadTracks: async () => {
      try {
        const tracks = await api.listTracks();
        set({ tracks });
      } catch (e) {
        get().toast(`Could not read the library: ${String(e)}`, 'error');
      }
    },

    addPaths: async (paths) => {
      if (paths.length === 0) return;
      set({ scanning: true, scanCount: 0 });
      try {
        const s: ScanStats = await api.addPaths(paths);
        await get().reloadTracks();
        const bad = s.bad_tags > 0 ? `, ${s.bad_tags} with unreadable tags` : '';
        get().toast(`Added ${s.added} track${s.added === 1 ? '' : 's'}${bad}.`);
      } catch (e) {
        get().toast(`Scan failed: ${String(e)}`, 'error');
        void api.logError(`scan failed: ${String(e)}`);
      } finally {
        set({ scanning: false });
      }
    },

    addFolderDialog: async () => {
      const picked = await open({ directory: true, multiple: true, title: 'Add music folder' });
      if (!picked) return;
      await get().addPaths(Array.isArray(picked) ? picked : [picked]);
    },

    addFilesDialog: async () => {
      const picked = await open({
        multiple: true,
        title: 'Add music files',
        filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'ogg', 'opus', 'aac', 'm4a'] }],
      });
      if (!picked) return;
      await get().addPaths(Array.isArray(picked) ? picked : [picked]);
    },

    rescan: async () => {
      set({ scanning: true, scanCount: 0 });
      try {
        const s = await api.rescan();
        await get().reloadTracks();
        get().toast(`Rescan done: ${s.added} new, ${s.updated} changed, ${s.removed} removed.`);
      } catch (e) {
        get().toast(`Rescan failed: ${String(e)}`, 'error');
      } finally {
        set({ scanning: false });
      }
    },

    // ---------- playback / queue ----------

    playList: (list, start) => {
      if (list.length === 0) return;
      failed.clear();
      failStreak = 0;
      let queue = list;
      let idx = start;
      if (get().settings.shuffle) {
        const first = list[start];
        queue = [first, ...shuffled(list.filter((_, i) => i !== start))];
        idx = 0;
      }
      set({ queue, baseQueue: list, index: idx });
      startAt(idx, true);
    },

    playQueueIndex: (i) => {
      failStreak = 0;
      startAt(i, true);
    },

    enqueueNext: (t) => {
      const { queue, index, baseQueue } = get();
      const q = queue.slice();
      q.splice(index + 1, 0, t);
      set({ queue: q, baseQueue: [...baseQueue, t] });
      if (index < 0) startAt(0, false);
      else refreshPreload();
      persistQueueSoon();
      get().toast(`"${t.title}" plays next.`);
    },

    enqueueEnd: (ts) => {
      const { queue, baseQueue, index } = get();
      set({ queue: [...queue, ...ts], baseQueue: [...baseQueue, ...ts] });
      if (index < 0 && ts.length > 0) startAt(0, false);
      else refreshPreload();
      persistQueueSoon();
      get().toast(`Added ${ts.length} to the queue.`);
    },

    removeFromQueue: (i) => {
      const { queue, index } = get();
      if (i === index) return; // do not remove what is playing
      const q = queue.slice();
      q.splice(i, 1);
      set({ queue: q, index: i < index ? index - 1 : index });
      refreshPreload();
      persistQueueSoon();
    },

    moveInQueue: (i, delta) => {
      const { queue, index } = get();
      const j = i + delta;
      if (j < 0 || j >= queue.length) return;
      const q = queue.slice();
      [q[i], q[j]] = [q[j], q[i]];
      let idx = index;
      if (index === i) idx = j;
      else if (index === j) idx = i;
      set({ queue: q, index: idx });
      refreshPreload();
      persistQueueSoon();
    },

    clearQueue: () => {
      engine?.pause();
      engine?.setNext(null);
      set({ queue: [], baseQueue: [], index: -1, playing: false, position: 0, duration: 0, coverUrl: null });
      persistQueueSoon();
    },

    togglePlay: () => {
      if (!engine) return;
      if (get().index < 0 && get().tracks.length > 0) {
        get().playList(get().tracks, 0);
        return;
      }
      engine.toggle();
    },

    next: () => {
      failStreak = 0;
      const { queue, index, settings } = get();
      if (queue.length === 0) return;
      let i = index + 1;
      if (i >= queue.length) {
        if (settings.repeat === 'off') return;
        i = 0;
      }
      startAt(i, true);
    },

    prev: () => {
      const { queue, index, position, settings } = get();
      if (queue.length === 0) return;
      // Like most players: restart the song if it is already past 3 seconds.
      if (position > 3) {
        engine?.seek(0);
        return;
      }
      if (index <= 0) {
        if (settings.repeat === 'all') startAt(queue.length - 1, true);
        else engine?.seek(0);
        return;
      }
      startAt(index - 1, true);
    },

    seek: (s) => {
      engine?.seek(s);
      set({ position: s });
    },

    // ---------- settings ----------

    updateSettings: (patch) => {
      const prev = get().settings;
      const settings = { ...prev, ...patch };
      set({ settings });
      if (engine) {
        if (patch.volume !== undefined) engine.setVolume(settings.volume);
        if (patch.speed !== undefined) engine.setSpeed(settings.speed);
        if (patch.eqEnabled !== undefined || patch.eqGains !== undefined) engine.setEq(settings.eqEnabled, settings.eqGains);
      }
      if (patch.repeat !== undefined) refreshPreload();
      if (patch.shuffle !== undefined && patch.shuffle !== prev.shuffle) {
        const { queue, baseQueue, index } = get();
        const cur = queue[index];
        if (cur) {
          if (patch.shuffle) {
            const rest = queue.filter((_, i) => i !== index);
            set({ queue: [cur, ...shuffled(rest)], baseQueue: queue, index: 0 });
          } else {
            const i = baseQueue.findIndex((t) => t.id === cur.id);
            set({ queue: baseQueue, index: i < 0 ? 0 : i });
          }
          refreshPreload();
          persistQueueSoon();
        }
      }
      if (patch.forceMediaKeys !== undefined) void applyMediaKeys(settings.forceMediaKeys);
      saveSettingsSoon();
    },

    applyTheme: (t) => get().updateSettings({ ...t }),

    // ---------- playlists ----------

    refreshPlaylists: async () => {
      try {
        set({ playlists: await api.listPlaylists() });
      } catch (e) {
        get().toast(`Could not load playlists: ${String(e)}`, 'error');
      }
    },

    createPlaylist: async (name) => {
      const id = await api.createPlaylist(name || 'New playlist');
      await get().refreshPlaylists();
      return id;
    },

    addToPlaylist: async (id, ts) => {
      await api.playlistAppend(id, ts.map((t) => t.id));
      await get().refreshPlaylists();
      get().toast(`Added ${ts.length} to the playlist.`);
    },

    deletePlaylist: async (id) => {
      await api.deletePlaylist(id);
      await get().refreshPlaylists();
      if (get().view.kind === 'playlist') set({ view: { kind: 'songs' } });
    },

    renamePlaylist: async (id, name) => {
      await api.renamePlaylist(id, name);
      await get().refreshPlaylists();
    },

    importM3uDialog: async () => {
      const picked = await open({ multiple: false, title: 'Import playlist', filters: [{ name: 'Playlist', extensions: ['m3u', 'm3u8'] }] });
      if (!picked || Array.isArray(picked)) return;
      try {
        const id = await api.importM3u(picked);
        await get().reloadTracks();
        await get().refreshPlaylists();
        set({ view: { kind: 'playlist', id } });
      } catch (e) {
        get().toast(`Import failed: ${String(e)}`, 'error');
      }
    },

    exportM3uDialog: async (id, name) => {
      const dest = await save({ title: 'Export playlist', defaultPath: `${name}.m3u8`, filters: [{ name: 'Playlist', extensions: ['m3u8', 'm3u'] }] });
      if (!dest) return;
      try {
        await api.exportM3u(id, dest);
        get().toast('Playlist exported.');
      } catch (e) {
        get().toast(`Export failed: ${String(e)}`, 'error');
      }
    },
  };
});

export { themeOf };
