// Thin, typed wrappers around the Rust commands. Argument names are camelCase here;
// Tauri maps them to the snake_case Rust parameters.
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export interface Track {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  track_no: number | null;
  disc_no: number | null;
  year: number | null;
  duration_ms: number;
}

export interface Playlist {
  id: number;
  name: string;
  track_count: number;
}

export interface YtStatus {
  installed: boolean;
  version: string | null;
}

export interface YtItem {
  id: string;
  title: string;
  channel: string;
  duration: number;
}

export interface ScanStats {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  bad_tags: number;
}

/** URL the web view can use to read an allowed local file (audio, image, video). */
export const fileUrl = (path: string): string => convertFileSrc(path);

export const api = {
  listTracks: () => invoke<Track[]>('list_tracks'),
  addPaths: (paths: string[]) => invoke<ScanStats>('add_paths', { paths }),
  rescan: () => invoke<ScanStats>('rescan'),
  listFolders: () => invoke<string[]>('list_folders'),
  removeFolder: (path: string) => invoke<void>('remove_folder', { path }),
  getCover: (path: string) => invoke<ArrayBuffer>('get_cover', { path }),

  listPlaylists: () => invoke<Playlist[]>('list_playlists'),
  createPlaylist: (name: string) => invoke<number>('create_playlist', { name }),
  renamePlaylist: (id: number, name: string) => invoke<void>('rename_playlist', { id, name }),
  deletePlaylist: (id: number) => invoke<void>('delete_playlist', { id }),
  playlistTracks: (id: number) => invoke<Track[]>('playlist_tracks', { id }),
  playlistAppend: (id: number, trackIds: number[]) => invoke<void>('playlist_append', { id, trackIds }),
  playlistSet: (id: number, trackIds: number[]) => invoke<void>('playlist_set', { id, trackIds }),
  exportM3u: (id: number, dest: string) => invoke<void>('export_m3u', { id, dest }),
  importM3u: (src: string) => invoke<number>('import_m3u', { src }),

  kvGet: (key: string) => invoke<string | null>('kv_get', { key }),
  kvSet: (key: string, value: string) => invoke<void>('kv_set', { key, value }),

  importBackground: (src: string) => invoke<string>('import_background', { src }),
  importBackgroundB64: (name: string, data: string) => invoke<string>('import_background_b64', { name, data }),
  fileToBase64: (path: string) => invoke<string>('file_to_base64', { path }),
  readTextFile: (path: string) => invoke<string>('read_text_file', { path }),
  writeTextFile: (path: string, text: string) => invoke<void>('write_text_file', { path, text }),
  listImages: (folder: string) => invoke<string[]>('list_images', { folder }),
  allowAssetPath: (path: string) => invoke<void>('allow_asset_path', { path }),

  logError: (message: string) => invoke<void>('log_error', { message }).catch(() => undefined),
  dataDirPath: () => invoke<string>('data_dir_path'),
  openDataDir: () => invoke<void>('open_data_dir'),
  deleteAllData: () => invoke<void>('delete_all_data'),

  ytStatus: () => invoke<YtStatus>('yt_status'),
  ytInstall: () => invoke<void>('yt_install'),
  ytUpdate: () => invoke<string>('yt_update'),
  ytSearch: (query: string) => invoke<YtItem[]>('yt_search', { query }),
  ytFetch: (id: string, save: boolean, dest: string | null) => invoke<string>('yt_fetch', { id, save, dest }),
  ytClearCache: () => invoke<void>('yt_clear_cache'),
};

export async function getJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await api.kvGet(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setJson(key: string, value: unknown): Promise<void> {
  return api.kvSet(key, JSON.stringify(value)).catch(() => undefined);
}
