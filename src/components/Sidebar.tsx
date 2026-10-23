import { useState } from 'react';
import { useYt } from '../lib/yt';
import { useStore, View } from '../lib/store';
import { Icon } from './Icon';

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const playlists = useStore((s) => s.playlists);
  const trackCount = useStore((s) => s.tracks.length);
  const queueCount = useStore((s) => s.queue.length);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const addFolderDialog = useStore((s) => s.addFolderDialog);
  const importM3uDialog = useStore((s) => s.importM3uDialog);
  const ytOn = useYt((s) => s.enabled);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const item = (v: View, icon: string, label: string, badge?: number) => {
    const active =
      view.kind === v.kind &&
      (v.kind !== 'playlist' || (view.kind === 'playlist' && view.id === v.id)) &&
      true;
    const isGroup =
      (v.kind === 'albums' && view.kind === 'album') || (v.kind === 'artists' && view.kind === 'artist');
    return (
      <button key={`${v.kind}-${'id' in v ? v.id : ''}`} className={`nav${active || isGroup ? ' active' : ''}`} onClick={() => setView(v)}>
        <Icon name={icon} size={18} />
        <span className="label">{label}</span>
        {badge !== undefined && badge > 0 && <span className="badge">{badge}</span>}
      </button>
    );
  };

  return (
    <nav className="sidebar glass">
      <div className="nav-group">
        {item({ kind: 'now' }, 'play', 'Now playing')}
        {item({ kind: 'songs' }, 'music', 'Songs', trackCount)}
        {item({ kind: 'albums' }, 'disc', 'Albums')}
        {item({ kind: 'artists' }, 'user', 'Artists')}
        {item({ kind: 'queue' }, 'queue', 'Queue', queueCount)}
        {item({ kind: 'favorites' }, 'heart', 'Favorites')}
        {item({ kind: 'recent' }, 'clock', 'Recently played')}
        {item({ kind: 'top' }, 'chart', 'Most played')}
        {item({ kind: 'browse' }, 'list', 'Browse')}
        {ytOn && item({ kind: 'youtube' }, 'download', 'YouTube')}
        {item({ kind: 'stats' }, 'disc', 'Stats')}
      </div>

      <div className="nav-heading">
        <span>Playlists</span>
        <span>
          <button className="icon-btn" title="Import .m3u playlist" onClick={() => void importM3uDialog()}>
            <Icon name="download" size={15} />
          </button>
          <button className="icon-btn" title="New playlist" onClick={() => setNaming(true)}>
            <Icon name="plus" size={16} />
          </button>
        </span>
      </div>

      {naming && (
        <form
          className="new-playlist"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const id = await createPlaylist(name.trim() || 'New playlist');
              setName('');
              setNaming(false);
              setView({ kind: 'playlist', id });
            })();
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" onBlur={() => !name && setNaming(false)} />
        </form>
      )}

      <div className="nav-group scroll">
        {playlists.map((p) => item({ kind: 'playlist', id: p.id }, 'list', p.name, p.track_count))}
        {playlists.length === 0 && !naming && <div className="nav-hint">Create a playlist with +</div>}
      </div>

      <button className="nav add-folder" onClick={() => void addFolderDialog()}>
        <Icon name="folderPlus" size={18} />
        <span className="label">Add music folder</span>
      </button>
    </nav>
  );
}
