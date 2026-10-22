// Extra features that live next to the main store: favorites, play counts, sleep timer,
// look options and backup / restore. Everything is saved locally as one JSON value.
import { create } from 'zustand';
import { open, save } from '@tauri-apps/plugin-dialog';
import { api, getJson, setJson } from './api';
import { useStore } from './store';
import { basename } from './util';

export interface PlayStat {
  count: number;
  last: number;
}

export type SleepState = { mode: 'off' } | { mode: 'timer'; endsAt: number } | { mode: 'track'; armedId: number };

interface Saved {
  favs: string[];
  plays: Record<string, PlayStat>;
  glow: boolean;
  timeTheme: boolean;
  savedAccent: string | null;
}

interface Extras extends Saved {
  loaded: boolean;
  sleep: SleepState;
  helpOpen: boolean;
  load: () => Promise<void>;
  toggleFav: (path: string) => void;
  recordPlay: (path: string) => void;
  setSleep: (s: SleepState) => void;
  setHelp: (b: boolean) => void;
  setGlow: (b: boolean) => void;
  setTimeTheme: (b: boolean) => void;
  exportBackup: () => Promise<void>;
  importBackup: () => Promise<void>;
}

const BACKUP_KEYS = ['settings', 'queue', 'pos', 'customCovers', 'extras'];
let saveTimer: number | null = null;

export const useExtras = create<Extras>()((set, get) => {
  const persistSoon = () => {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const { favs, plays, glow, timeTheme, savedAccent } = get();
      void setJson('extras', { favs, plays, glow, timeTheme, savedAccent });
    }, 600);
  };

  return {
    loaded: false,
    favs: [],
    plays: {},
    glow: true,
    timeTheme: false,
    savedAccent: null,
    sleep: { mode: 'off' },
    helpOpen: false,

    load: async () => {
      const saved = await getJson<Partial<Saved>>('extras');
      set({
        favs: saved?.favs ?? [],
        plays: saved?.plays ?? {},
        glow: saved?.glow ?? true,
        timeTheme: saved?.timeTheme ?? false,
        savedAccent: saved?.savedAccent ?? null,
        loaded: true,
      });
    },

    toggleFav: (path) => {
      const favs = get().favs;
      set({ favs: favs.includes(path) ? favs.filter((p) => p !== path) : [...favs, path] });
      persistSoon();
    },

    recordPlay: (path) => {
      const plays = { ...get().plays };
      const old = plays[path];
      plays[path] = { count: (old?.count ?? 0) + 1, last: Date.now() };
      set({ plays });
      persistSoon();
    },

    setSleep: (sleep) => set({ sleep }),
    setHelp: (helpOpen) => set({ helpOpen }),
    setGlow: (glow) => {
      set({ glow });
      persistSoon();
    },
    setTimeTheme: (timeTheme) => {
      const st = useStore.getState();
      if (timeTheme) set({ savedAccent: st.settings.accent });
      else st.updateSettings({ accent: get().savedAccent });
      set({ timeTheme });
      persistSoon();
    },

    // ---------- backup / restore ----------

    exportBackup: async () => {
      const toast = useStore.getState().toast;
      try {
        const dest = await save({
          title: 'Save backup',
          defaultPath: 'Glasklang-backup.json',
          filters: [{ name: 'Glasklang backup', extensions: ['json'] }],
        });
        if (!dest) return;
        const kv: Record<string, string | null> = {};
        for (const k of BACKUP_KEYS) kv[k] = await api.kvGet(k);
        const files: Record<string, { name: string; data: string }> = {};
        const addFile = async (p: string | null | undefined) => {
          if (!p || files[p]) return;
          try {
            files[p] = { name: basename(p), data: await api.fileToBase64(p) };
          } catch {
            /* a missing or too large file is skipped */
          }
        };
        const covers = (await getJson<Record<string, string>>('customCovers')) ?? {};
        for (const p of new Set(Object.values(covers))) await addFile(p);
        const bg = useStore.getState().settings.bg;
        if ((bg.kind === 'image' || bg.kind === 'video') && bg.value) await addFile(bg.value);
        await api.writeTextFile(dest, JSON.stringify({ app: 'glasklang', version: 1, kv, files }));
        toast('Backup saved');
      } catch (e) {
        toast(`Backup failed: ${String(e)}`, 'error');
      }
    },

    importBackup: async () => {
      const toast = useStore.getState().toast;
      try {
        const f = await open({ multiple: false, title: 'Restore backup', filters: [{ name: 'Glasklang backup', extensions: ['json'] }] });
        if (typeof f !== 'string') return;
        const data = JSON.parse(await api.readTextFile(f)) as {
          app?: string;
          kv?: Record<string, string | null>;
          files?: Record<string, { name: string; data: string }>;
        };
        if (data.app !== 'glasklang' || !data.kv) throw new Error('This is not a Glasklang backup file');
        const map: Record<string, string> = {};
        for (const [oldPath, file] of Object.entries(data.files ?? {})) {
          map[oldPath] = await api.importBackgroundB64(file.name, file.data);
        }
        const esc = (s: string) => JSON.stringify(s).slice(1, -1);
        for (const [key, raw] of Object.entries(data.kv)) {
          if (!BACKUP_KEYS.includes(key) || raw === null || raw === undefined) continue;
          let out = raw;
          for (const [o, n] of Object.entries(map)) out = out.split(esc(o)).join(esc(n));
          await api.kvSet(key, out);
        }
        toast('Backup restored. Restarting the view...');
        window.setTimeout(() => window.location.reload(), 900);
      } catch (e) {
        toast(`Restore failed: ${String(e)}`, 'error');
      }
    },
  };
});
