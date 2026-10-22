import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, Track } from '../lib/api';
import { AlbumGroup, ArtistGroup, filterTracks, groupAlbums, groupArtists } from '../lib/library';
import { useStore } from '../lib/store';
import { formatTime } from '../lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { TrackList } from './TrackList';

function Header(props: { title: string; sub?: string; cover?: string | null; actions?: ReactNode }) {
  return (
    <div className="view-header">
      {props.cover !== undefined && <Cover path={props.cover} size={96} radius={18} />}
      <div className="vh-text">
        <h1>{props.title}</h1>
        {props.sub && <div className="sub">{props.sub}</div>}
      </div>
      <div className="vh-actions">{props.actions}</div>
    </div>
  );
}

function PlayActions({ tracks, onShuffleExtra }: { tracks: Track[]; onShuffleExtra?: () => void }) {
  const playList = useStore((s) => s.playList);
  const update = useStore((s) => s.updateSettings);
  const enqueueEnd = useStore((s) => s.enqueueEnd);
  return (
    <>
      <button className="btn primary" disabled={tracks.length === 0} onClick={() => playList(tracks, 0)}>
        <Icon name="play" size={16} /> Play
      </button>
      <button
        className="btn"
        disabled={tracks.length === 0}
        onClick={() => {
          update({ shuffle: true });
          playList(tracks, Math.floor(Math.random() * tracks.length));
          onShuffleExtra?.();
        }}
      >
        <Icon name="shuffle" size={16} /> Shuffle
      </button>
      <button className="btn" disabled={tracks.length === 0} onClick={() => enqueueEnd(tracks)}>
        <Icon name="plus" size={16} /> Queue
      </button>
    </>
  );
}

function EmptyLibrary() {
  const addFolderDialog = useStore((s) => s.addFolderDialog);
  const addFilesDialog = useStore((s) => s.addFilesDialog);
  return (
    <div className="empty big">
      <Icon name="music" size={44} />
      <h2>Your library is empty</h2>
      <p>Drag music files or folders into this window, or pick a folder.</p>
      <div className="row">
        <button className="btn primary" onClick={() => void addFolderDialog()}>
          <Icon name="folderPlus" size={16} /> Add music folder
        </button>
        <button className="btn" onClick={() => void addFilesDialog()}>Add files</button>
      </div>
    </div>
  );
}

// ---------------- Songs ----------------

export function SongsView() {
  const tracks = useStore((s) => s.tracks);
  const search = useStore((s) => s.search);
  const playList = useStore((s) => s.playList);
  const scanning = useStore((s) => s.scanning);
  const scanCount = useStore((s) => s.scanCount);
  const rescan = useStore((s) => s.rescan);
  const list = useMemo(() => filterTracks(tracks, search), [tracks, search]);

  if (tracks.length === 0 && !scanning) return <EmptyLibrary />;
  return (
    <>
      <Header
        title="Songs"
        sub={scanning ? `Scanning... ${scanCount} files looked at` : `${list.length.toLocaleString()} ${list.length === 1 ? 'song' : 'songs'}${search ? ' found' : ''}`}
        actions={
          <>
            <PlayActions tracks={list} />
            <button className="icon-btn" title="Rescan folders" disabled={scanning} onClick={() => void rescan()}>
              <Icon name="refresh" size={18} />
            </button>
          </>
        }
      />
      <TrackList tracks={list} onPlay={(i) => playList(list, i)} empty="No songs match your search." />
    </>
  );
}

// ---------------- Albums ----------------

function AlbumCard({ g, onOpen }: { g: AlbumGroup; onOpen: () => void }) {
  return (
    <button className="card" onClick={onOpen}>
      <Cover path={g.tracks[0].path} size={160} radius={18} />
      <div className="c1" title={g.album}>{g.album}</div>
      <div className="c2" title={g.artist}>{g.artist}{g.year ? ` - ${g.year}` : ''}</div>
    </button>
  );
}

function ArtistCard({ g, onOpen }: { g: ArtistGroup; onOpen: () => void }) {
  return (
    <button className="card" onClick={onOpen}>
      <div className="avatar">{g.artist.trim().charAt(0).toUpperCase() || '?'}</div>
      <div className="c1" title={g.artist}>{g.artist}</div>
      <div className="c2">{g.albumCount} {g.albumCount === 1 ? 'album' : 'albums'} - {g.trackCount} songs</div>
    </button>
  );
}

/** Virtualized grid: rows are built from the container width. */
function CardGrid<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor((width - 8) / 192));
  const rows = Math.ceil(items.length / cols);
  const virt = useVirtualizer({ count: rows, getScrollElement: () => ref.current, estimateSize: () => 232, overscan: 3 });

  return (
    <div className="grid-scroll" ref={ref}>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((v) => (
          <div
            key={v.index}
            className="grid-row"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 232, transform: `translateY(${v.start}px)`, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {items.slice(v.index * cols, v.index * cols + cols).map((it, i) => (
              <div key={i}>{render(it)}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AlbumsView() {
  const tracks = useStore((s) => s.tracks);
  const search = useStore((s) => s.search);
  const setView = useStore((s) => s.setView);
  const groups = useMemo(() => groupAlbums(tracks), [tracks]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? groups.filter((g) => `${g.album} ${g.artist}`.toLowerCase().includes(q)) : groups;
  }, [groups, search]);
  if (tracks.length === 0) return <EmptyLibrary />;
  return (
    <>
      <Header title="Albums" sub={`${shown.length.toLocaleString()} albums`} />
      {shown.length === 0 ? (
        <div className="empty">No albums match your search.</div>
      ) : (
        <CardGrid items={shown} render={(g) => <AlbumCard g={g} onOpen={() => setView({ kind: 'album', key: g.key })} />} />
      )}
    </>
  );
}

export function AlbumDetail({ albumKey }: { albumKey: string }) {
  const tracks = useStore((s) => s.tracks);
  const playList = useStore((s) => s.playList);
  const setView = useStore((s) => s.setView);
  const group = useMemo(() => groupAlbums(tracks).find((g) => g.key === albumKey), [tracks, albumKey]);
  if (!group) return <div className="empty">That album is no longer in your library.</div>;
  const total = group.tracks.reduce((a, t) => a + t.duration_ms, 0) / 1000;
  return (
    <>
      <Header
        title={group.album}
        cover={group.tracks[0].path}
        sub={`${group.artist}${group.year ? ` - ${group.year}` : ''} - ${group.tracks.length} songs - ${formatTime(total)}`}
        actions={
          <>
            <button className="btn" onClick={() => setView({ kind: 'albums' })}>All albums</button>
            <PlayActions tracks={group.tracks} />
          </>
        }
      />
      <TrackList tracks={group.tracks} onPlay={(i) => playList(group.tracks, i)} />
    </>
  );
}

// ---------------- Artists ----------------

export function ArtistsView() {
  const tracks = useStore((s) => s.tracks);
  const search = useStore((s) => s.search);
  const setView = useStore((s) => s.setView);
  const groups = useMemo(() => groupArtists(tracks), [tracks]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? groups.filter((g) => g.artist.toLowerCase().includes(q)) : groups;
  }, [groups, search]);
  if (tracks.length === 0) return <EmptyLibrary />;
  return (
    <>
      <Header title="Artists" sub={`${shown.length.toLocaleString()} artists`} />
      {shown.length === 0 ? (
        <div className="empty">No artists match your search.</div>
      ) : (
        <CardGrid items={shown} render={(g) => <ArtistCard g={g} onOpen={() => setView({ kind: 'artist', artist: g.artist })} />} />
      )}
    </>
  );
}

export function ArtistDetail({ artist }: { artist: string }) {
  const tracks = useStore((s) => s.tracks);
  const search = useStore((s) => s.search);
  const playList = useStore((s) => s.playList);
  const setView = useStore((s) => s.setView);
  const list = useMemo(() => filterTracks(tracks.filter((t) => t.artist === artist), search), [tracks, artist, search]);
  return (
    <>
      <Header
        title={artist}
        sub={`${list.length} songs`}
        actions={
          <>
            <button className="btn" onClick={() => setView({ kind: 'artists' })}>All artists</button>
            <PlayActions tracks={list} />
          </>
        }
      />
      <TrackList tracks={list} onPlay={(i) => playList(list, i)} empty="No songs match your search." />
    </>
  );
}

// ---------------- Playlists ----------------

export function PlaylistView({ id }: { id: number }) {
  const playlist = useStore((s) => s.playlists.find((p) => p.id === id));
  const playList = useStore((s) => s.playList);
  const refresh = useStore((s) => s.refreshPlaylists);
  const deletePlaylist = useStore((s) => s.deletePlaylist);
  const renamePlaylist = useStore((s) => s.renamePlaylist);
  const exportM3uDialog = useStore((s) => s.exportM3uDialog);
  const toast = useStore((s) => s.toast);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    try {
      setTracks(await api.playlistTracks(id));
    } catch (e) {
      toast(`Could not load the playlist: ${String(e)}`, 'error');
    }
  };

  useEffect(() => {
    setConfirmDelete(false);
    setRenaming(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, playlist?.track_count]);

  const commit = async (next: Track[]) => {
    setTracks(next);
    await api.playlistSet(id, next.map((t) => t.id));
    await refresh();
  };

  if (!playlist) return <div className="empty">This playlist no longer exists.</div>;

  return (
    <>
      <Header
        title={playlist.name}
        sub={`${tracks.length} songs`}
        actions={
          <>
            <PlayActions tracks={tracks} />
            <button className="icon-btn" title="Rename" onClick={() => { setName(playlist.name); setRenaming(true); }}>
              <Icon name="edit" size={18} />
            </button>
            <button className="icon-btn" title="Export as .m3u8" onClick={() => void exportM3uDialog(id, playlist.name)}>
              <Icon name="upload" size={18} />
            </button>
            <button className={`icon-btn${confirmDelete ? ' danger' : ''}`} title={confirmDelete ? 'Click again to delete' : 'Delete playlist'} onClick={() => (confirmDelete ? void deletePlaylist(id) : setConfirmDelete(true))}>
              <Icon name="trash" size={18} />
            </button>
          </>
        }
      />
      {renaming && (
        <form
          className="rename"
          onSubmit={(e) => {
            e.preventDefault();
            void renamePlaylist(id, name.trim() || playlist.name);
            setRenaming(false);
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" type="submit">Save</button>
        </form>
      )}
      <TrackList
        tracks={tracks}
        mode="playlist"
        onPlay={(i) => playList(tracks, i)}
        onMove={(i, d) => {
          const j = i + d;
          if (j < 0 || j >= tracks.length) return;
          const next = tracks.slice();
          [next[i], next[j]] = [next[j], next[i]];
          void commit(next);
        }}
        onRemove={(i) => void commit(tracks.filter((_, k) => k !== i))}
        empty="This playlist is empty. Use the list-plus button on a song to add it."
      />
    </>
  );
}

// ---------------- Queue ----------------

export function QueueView() {
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  const playQueueIndex = useStore((s) => s.playQueueIndex);
  const moveInQueue = useStore((s) => s.moveInQueue);
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const clearQueue = useStore((s) => s.clearQueue);
  return (
    <>
      <Header
        title="Queue"
        sub={queue.length ? `${queue.length} songs - playing #${index + 1}` : 'Nothing queued'}
        actions={
          <button className="btn" disabled={queue.length === 0} onClick={clearQueue}>
            <Icon name="trash" size={16} /> Clear
          </button>
        }
      />
      <TrackList
        tracks={queue}
        mode="queue"
        onPlay={playQueueIndex}
        onMove={moveInQueue}
        onRemove={removeFromQueue}
        empty="The queue is empty. Play something from Songs, Albums or a playlist."
      />
    </>
  );
}
