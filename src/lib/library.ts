import type { Track } from './api';

export interface AlbumGroup {
  key: string;
  album: string;
  artist: string;
  year: number | null;
  tracks: Track[];
}

export interface ArtistGroup {
  artist: string;
  trackCount: number;
  albumCount: number;
  sample: Track;
}

/** Group tracks into albums (tracks arrive sorted by artist, album, disc, track number). */
export function groupAlbums(tracks: Track[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>();
  for (const t of tracks) {
    const key = `${t.album}\u0000${t.album_artist}`;
    let g = map.get(key);
    if (!g) {
      g = { key, album: t.album, artist: t.album_artist, year: t.year, tracks: [] };
      map.set(key, g);
    }
    g.tracks.push(t);
    if (g.year === null && t.year !== null) g.year = t.year;
  }
  return Array.from(map.values()).sort(
    (a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }),
  );
}

export function groupArtists(tracks: Track[]): ArtistGroup[] {
  const map = new Map<string, { sample: Track; count: number; albums: Set<string> }>();
  for (const t of tracks) {
    let g = map.get(t.artist);
    if (!g) {
      g = { sample: t, count: 0, albums: new Set() };
      map.set(t.artist, g);
    }
    g.count++;
    g.albums.add(t.album);
  }
  return Array.from(map.entries())
    .map(([artist, g]) => ({ artist, trackCount: g.count, albumCount: g.albums.size, sample: g.sample }))
    .sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }));
}

const hayCache = new WeakMap<Track, string>();
function haystack(t: Track): string {
  let h = hayCache.get(t);
  if (h === undefined) {
    h = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
    hayCache.set(t, h);
  }
  return h;
}

/** Client-side search: every word must appear in title, artist or album. */
export function filterTracks(tracks: Track[], query: string): Track[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return tracks;
  return tracks.filter((t) => {
    const h = haystack(t);
    return words.every((w) => h.includes(w));
  });
}
