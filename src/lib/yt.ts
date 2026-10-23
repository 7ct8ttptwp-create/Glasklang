// Optional YouTube support (yt-dlp). Off until the user turns it on in Settings.
import { create } from 'zustand';
import { api, getJson, setJson } from './api';

interface Saved {
  enabled: boolean;
  saveDir: string;
}

interface Yt extends Saved {
  load: () => Promise<void>;
  set: (patch: Partial<Saved>) => void;
}

export const useYt = create<Yt>()((set, get) => ({
  enabled: false,
  saveDir: '',

  load: async () => {
    const s = await getJson<Partial<Saved>>('yt');
    set({ enabled: s?.enabled ?? false, saveDir: s?.saveDir ?? '' });
    // streamed songs are temporary: start every session with an empty cache
    if (s?.enabled) void api.ytClearCache().catch(() => undefined);
  },

  set: (patch) => {
    set(patch);
    const { enabled, saveDir } = get();
    void setJson('yt', { enabled, saveDir });
  },
}));
