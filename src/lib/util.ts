import { api, fileUrl } from './api';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  return formatTime(ms / 1000);
}

export function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// ---------- covers ----------

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

const coverCache = new Map<string, string | null>();
const coverInflight = new Map<string, Promise<string | null>>();
const COVER_CACHE_MAX = 400;

// Covers the user picked themselves: track path -> image file inside the app data folder.
let customCovers: Record<string, string> = {};
export function setCustomCovers(map: Record<string, string>): void {
  customCovers = map;
}
export function hasCustomCover(path: string): boolean {
  return !!customCovers[path];
}

/** Blob URL for the cover of a track file, or null. Cached; the oldest entries are released. */
export function loadCover(path: string): Promise<string | null> {
  const mine = customCovers[path];
  if (mine) return Promise.resolve(fileUrl(mine));
  if (coverCache.has(path)) return Promise.resolve(coverCache.get(path) ?? null);
  const pending = coverInflight.get(path);
  if (pending) return pending;
  const p = api
    .getCover(path)
    .then((buf) => {
      let url: string | null = null;
      if (buf.byteLength > 0) {
        const bytes = new Uint8Array(buf);
        url = URL.createObjectURL(new Blob([buf], { type: sniffMime(bytes) }));
      }
      coverCache.set(path, url);
      if (coverCache.size > COVER_CACHE_MAX) {
        const oldest = coverCache.keys().next().value as string | undefined;
        if (oldest !== undefined) {
          const u = coverCache.get(oldest);
          if (u) URL.revokeObjectURL(u);
          coverCache.delete(oldest);
        }
      }
      return url;
    })
    .catch(() => null)
    .finally(() => coverInflight.delete(path));
  coverInflight.set(path, p);
  return p;
}

// ---------- colors ----------

/** Average color of the more saturated pixels of an image URL, as #rrggbb. */
export async function dominantColor(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 24, 24);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      const sat = max === 0 ? 0 : (max - min) / max;
      const w = 0.05 + sat * sat * (max / 255);
      r += data[i] * w;
      g += data[i + 1] * w;
      b += data[i + 2] * w;
      wsum += w;
    }
    if (wsum === 0) return null;
    const hex = (v: number) => Math.round(v / wsum).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}

/** Perceived brightness 0..1 of a #hex color. */
export function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.4;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Average brightness 0..1 of an image or video frame source. */
export async function imageLuminance(url: string): Promise<number | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  } catch {
    return null;
  }
}

/** Rough brightness of a CSS gradient by averaging the #hex colors it mentions. */
export function gradientLuminance(css: string): number {
  const hexes = css.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length === 0) return 0.4;
  return hexes.reduce((a, h) => a + hexLuminance(h), 0) / hexes.length;
}
