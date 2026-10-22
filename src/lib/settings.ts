// Everything the user can customize, with defaults. Saved as one JSON blob in the local database.

export type ThemeMode = 'auto' | 'light' | 'dark';
export type BgKind = 'gradient' | 'color' | 'image' | 'video' | 'slideshow' | 'album';
export type BgFit = 'cover' | 'contain' | 'fill';
export type RepeatMode = 'off' | 'all' | 'one';

export interface GlassSettings {
  blur: number; // px, 0..60
  saturation: number; // percent, 100..250
  intensity: number; // percent, how milky the glass is, 0..100
  quality: 'frosted' | 'refraction';
}

export interface BgSettings {
  kind: BgKind;
  /** gradient: CSS gradient text, color: #hex, image/video: file path, slideshow: folder path */
  value: string;
  fit: BgFit;
  blur: number; // px, 0..40
  brightness: number; // percent, 40..160
  tint: string; // #hex
  tintOpacity: number; // percent, 0..80
  interval: number; // seconds, for slideshow
}

export interface ThemeData {
  theme: ThemeMode;
  accent: string | null; // null = Windows accent color
  useAlbumTint: boolean;
  autoContrast: boolean;
  glass: GlassSettings;
  bg: BgSettings;
}

export interface Preset {
  name: string;
  data: ThemeData;
}

export interface Settings extends ThemeData {
  presets: Preset[];
  closeToTray: boolean;
  forceMediaKeys: boolean;
  eqEnabled: boolean;
  eqGains: number[];
  volume: number; // 0..1
  speed: number; // 0.5..2
  shuffle: boolean;
  repeat: RepeatMode;
}

export const GRADIENT_PRESETS: { name: string; value: string }[] = [
  {
    name: 'Aurora',
    value:
      'radial-gradient(60% 50% at 20% 15%, #3be8b0 0%, transparent 60%), radial-gradient(55% 45% at 80% 25%, #6a5cff 0%, transparent 62%), radial-gradient(70% 60% at 55% 95%, #ff6fb5 0%, transparent 60%), linear-gradient(160deg, #0b1330, #14213d 55%, #0a0f24)',
  },
  {
    name: 'Midsommar',
    value:
      'radial-gradient(60% 50% at 80% 10%, #ffe27a 0%, transparent 60%), radial-gradient(60% 55% at 15% 85%, #7ad6ff 0%, transparent 60%), linear-gradient(150deg, #3b82f6, #7dd3fc 55%, #fde68a)',
  },
  {
    name: 'Dusk',
    value:
      'radial-gradient(60% 50% at 30% 20%, #ff9a8b 0%, transparent 60%), radial-gradient(60% 60% at 80% 80%, #5b3b8c 0%, transparent 60%), linear-gradient(160deg, #2b1b4d, #6b3f7f 55%, #f0846b)',
  },
  {
    name: 'Fjord',
    value:
      'radial-gradient(60% 50% at 70% 15%, #9ad7e8 0%, transparent 60%), radial-gradient(70% 60% at 20% 90%, #1d4e5f 0%, transparent 65%), linear-gradient(170deg, #cfe8ef, #5f93a6 50%, #17323c)',
  },
  {
    name: 'Graphite',
    value: 'radial-gradient(60% 50% at 25% 15%, #4a5168 0%, transparent 60%), linear-gradient(160deg, #14161d, #232734 60%, #0d0e13)',
  },
];

export const DEFAULT_THEME: ThemeData = {
  theme: 'auto',
  accent: null,
  useAlbumTint: true,
  autoContrast: true,
  glass: { blur: 28, saturation: 160, intensity: 45, quality: 'frosted' },
  bg: {
    kind: 'gradient',
    value: GRADIENT_PRESETS[0].value,
    fit: 'cover',
    blur: 0,
    brightness: 100,
    tint: '#000000',
    tintOpacity: 0,
    interval: 30,
  },
};

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_THEME,
  presets: [],
  closeToTray: false,
  forceMediaKeys: false,
  eqEnabled: true,
  eqGains: [0, 0, 0, 0, 0],
  volume: 0.8,
  speed: 1,
  shuffle: false,
  repeat: 'off',
};

/** Merge saved settings over the defaults so new options appear after an update. */
export function mergeSettings(saved: Partial<Settings> | null): Settings {
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    glass: { ...DEFAULT_SETTINGS.glass, ...(saved.glass ?? {}) },
    bg: { ...DEFAULT_SETTINGS.bg, ...(saved.bg ?? {}) },
    eqGains: saved.eqGains && saved.eqGains.length === 5 ? saved.eqGains : DEFAULT_SETTINGS.eqGains,
    presets: saved.presets ?? [],
  };
}

export function themeOf(s: Settings): ThemeData {
  return { theme: s.theme, accent: s.accent, useAlbumTint: s.useAlbumTint, autoContrast: s.autoContrast, glass: s.glass, bg: s.bg };
}
