// Sound & Now playing options: crossfade, visualizer, breathing cover, lyrics.
import { create } from 'zustand';
import { getJson, setJson } from './api';
import { setCrossfadeSeconds } from './audio';

interface Saved {
  crossfade: number;
  visualizer: boolean;
  breathe: boolean;
  lyrics: boolean;
}

interface Fx extends Saved {
  load: () => Promise<void>;
  set: (patch: Partial<Saved>) => void;
}

export const useFx = create<Fx>()((set, get) => ({
  crossfade: 0,
  visualizer: true,
  breathe: true,
  lyrics: true,

  load: async () => {
    const s = await getJson<Partial<Saved>>('fx');
    const next = {
      crossfade: s?.crossfade ?? 0,
      visualizer: s?.visualizer ?? true,
      breathe: s?.breathe ?? true,
      lyrics: s?.lyrics ?? true,
    };
    set(next);
    setCrossfadeSeconds(next.crossfade);
  },

  set: (patch) => {
    set(patch);
    const { crossfade, visualizer, breathe, lyrics } = get();
    setCrossfadeSeconds(crossfade);
    void setJson('fx', { crossfade, visualizer, breathe, lyrics });
  },
}));
