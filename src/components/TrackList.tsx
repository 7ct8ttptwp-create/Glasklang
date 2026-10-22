import { ReactNode, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Track } from '../lib/api';
import { useStore } from '../lib/store';
import { formatDuration } from '../lib/util';
import { Icon } from './Icon';

interface Props {
  tracks: Track[];
  mode?: 'library' | 'playlist' | 'queue';
  onPlay: (index: number) => void;
  onMove?: (index: number, delta: number) => void;
  onRemove?: (index: number) => void;
  empty?: ReactNode;
}

const ROW_HEIGHT = 52;

/** Virtualized track list: only the rows on screen exist in the DOM, so 50,000+ tracks stay smooth. */
export function TrackList({ tracks, mode = 'library', onPlay, onMove, onRemove, empty }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const currentId = useStore((s) => s.queue[s.index]?.id);
  const playing = useStore((s) => s.playing);
  const enqueueNext = useStore((s) => s.enqueueNext);
  const [menu, setMenu] = useState<{ x: number; y: number; track: Track } | null>(null);

  const virt = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (tracks.length === 0) return <div className="empty">{empty ?? 'Nothing here yet.'}</div>;

  return (
    <div className="tracklist" ref={parentRef}>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((v) => {
          const t = tracks[v.index];
          const isCurrent = t.id === currentId;
          return (
            <div
              key={`${t.id}-${v.index}`}
              className={`trow${isCurrent ? ' current' : ''}`}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${v.start}px)` }}
              onDoubleClick={() => onPlay(v.index)}
            >
              <button className="tnum" onClick={() => onPlay(v.index)} aria-label={`Play ${t.title}`}>
                {isCurrent && playing ? <span className="eq-bars" aria-hidden="true"><i /><i /><i /></span> : <span className="n">{v.index + 1}</span>}
                <span className="p"><Icon name="play" size={14} /></span>
              </button>
              <div className="ttitle">
                <div className="t1">{t.title}</div>
                <div className="t2">{t.artist}</div>
              </div>
              <div className="talbum">{t.album}</div>
              <div className="tdur">{formatDuration(t.duration_ms)}</div>
              <div className="tactions">
                {mode === 'library' && (
                  <>
                    <button className="icon-btn" title="Play next" onClick={() => enqueueNext(t)}>
                      <Icon name="plus" size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Add to playlist"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenu({ x: r.left, y: r.bottom, track: t });
                      }}
                    >
                      <Icon name="listPlus" size={16} />
                    </button>
                  </>
                )}
                {mode !== 'library' && (
                  <>
                    <button className="icon-btn" title="Move up" disabled={v.index === 0} onClick={() => onMove?.(v.index, -1)}>
                      <Icon name="up" size={16} />
                    </button>
                    <button className="icon-btn" title="Move down" disabled={v.index === tracks.length - 1} onClick={() => onMove?.(v.index, 1)}>
                      <Icon name="down" size={16} />
                    </button>
                    <button className="icon-btn" title="Remove" disabled={mode === 'queue' && isCurrent} onClick={() => onRemove?.(v.index)}>
                      <Icon name="x" size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {menu && <PlaylistMenu x={menu.x} y={menu.y} track={menu.track} onClose={() => setMenu(null)} />}
    </div>
  );
}

function PlaylistMenu({ x, y, track, onClose }: { x: number; y: number; track: Track; onClose: () => void }) {
  const playlists = useStore((s) => s.playlists);
  const addToPlaylist = useStore((s) => s.addToPlaylist);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const [name, setName] = useState('');

  const left = Math.max(8, Math.min(x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(y + 4, window.innerHeight - 280));

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="menu glass" style={{ left, top }} role="menu">
        <div className="menu-title">Add to playlist</div>
        <div className="menu-list">
          {playlists.length === 0 && <div className="menu-empty">No playlists yet</div>}
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                void addToPlaylist(p.id, [track]);
                onClose();
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <form
          className="menu-new"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const id = await createPlaylist(name.trim() || 'New playlist');
              await addToPlaylist(id, [track]);
              onClose();
            })();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist..." />
          <button type="submit" className="icon-btn" title="Create">
            <Icon name="plus" size={16} />
          </button>
        </form>
      </div>
    </>
  );
}
