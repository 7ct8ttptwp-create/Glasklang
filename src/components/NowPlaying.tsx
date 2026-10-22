import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStore } from '../lib/store';
import { formatTime, hasCustomCover } from '../lib/util';
import { SleepButton } from './Extras';
import { Lyrics, LoopButton, Visualizer } from './NowExtras';
import { HeartButton } from './Heart';
import { Icon } from './Icon';
import { RangeGlass } from './PlayerBar';

/** Big "now playing" page: the cover fills the page and fades into the controls. */
export function NowPlaying() {
  const track = useStore((s) => s.queue[s.index]);
  const tracks = useStore((s) => s.tracks);
  const coverUrl = useStore((s) => s.coverUrl);
  const coverVersion = useStore((s) => s.coverVersion);
  const playing = useStore((s) => s.playing);
  const position = useStore((s) => s.position);
  const duration = useStore((s) => s.duration);
  const settings = useStore((s) => s.settings);
  const togglePlay = useStore((s) => s.togglePlay);
  const next = useStore((s) => s.next);
  const prev = useStore((s) => s.prev);
  const seek = useStore((s) => s.seek);
  const update = useStore((s) => s.updateSettings);
  const setView = useStore((s) => s.setView);
  const setCustomCover = useStore((s) => s.setCustomCover);
  const [drag, setDrag] = useState<number | null>(null);
  const [wholeAlbum, setWholeAlbum] = useState(true);

  const shown = drag ?? position;
  const custom = !!track && coverVersion >= 0 && hasCustomCover(track.path);

  // Tracks that share this song's album (or just the song if it has no album tag).
  const targets = () => {
    if (!track) return [];
    if (!wholeAlbum || !track.album) return [track];
    const same = tracks.filter((t) => t.album === track.album && (t.album_artist || t.artist) === (track.album_artist || track.artist));
    return same.length > 0 ? same : [track];
  };

  const choose = async () => {
    const f = await open({
      multiple: false,
      title: 'Choose a cover image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    });
    if (typeof f === 'string') await setCustomCover(targets(), f);
  };

  return (
    <div className="nowview">
      <div className="np-art">
        {coverUrl ? <img key={coverUrl} src={coverUrl} alt="" draggable={false} /> : <div className="np-empty"><Icon name="music" size={96} /></div>}
      </div>
      <div className="np-top">
        <button className="icon-btn" title="Back" onClick={() => setView({ kind: 'songs' })}>
          <Icon name="down" size={20} />
        </button>
      </div>

      <div className="np-bottom">
        <Visualizer />
        <Lyrics />
        <div className="np-title">
          <div className="np-t1">{track?.title ?? 'Nothing playing'}</div>
          <div className="np-t2">{track ? `${track.artist}${track.album ? ' - ' + track.album : ''}` : 'Add a music folder to begin'}</div>
        </div>

        <div className="np-seek">
          <RangeGlass
            value={shown}
            max={Math.max(1, duration)}
            step={0.5}
            label="Seek"
            onInput={(v) => setDrag(v)}
            onCommit={(v) => {
              seek(v);
              setDrag(null);
            }}
          />
          <div className="np-times">
            <span>{formatTime(shown)}</span>
            <span>-{formatTime(Math.max(0, duration - shown))}</span>
          </div>
        </div>

        <div className="np-controls">
          <button className={`icon-btn${settings.shuffle ? ' active' : ''}`} title="Shuffle" onClick={() => update({ shuffle: !settings.shuffle })}>
            <Icon name="shuffle" size={20} />
          </button>
          <button className="icon-btn big" title="Previous" onClick={prev}>
            <Icon name="prev" size={26} />
          </button>
          <button className="play-btn" title={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            <Icon name={playing ? 'pause' : 'play'} size={30} />
          </button>
          <button className="icon-btn big" title="Next" onClick={next}>
            <Icon name="next" size={26} />
          </button>
          <button
            className={`icon-btn${settings.repeat !== 'off' ? ' active' : ''}`}
            title={`Repeat: ${settings.repeat}`}
            onClick={() => update({ repeat: settings.repeat === 'off' ? 'all' : settings.repeat === 'all' ? 'one' : 'off' })}
          >
            <Icon name={settings.repeat === 'one' ? 'repeat1' : 'repeat'} size={20} />
          </button>
        </div>

        <div className="np-cover-tools">
          <HeartButton path={track?.path} size={18} />
          <SleepButton />
          <LoopButton />
          <button className="btn small" disabled={!track} onClick={() => void choose()}>
            <Icon name="upload" size={15} /> Set own cover
          </button>
          {custom && (
            <button className="btn small" onClick={() => void setCustomCover(targets(), null)}>
              <Icon name="refresh" size={15} /> Reset
            </button>
          )}
          <label className="np-check">
            <input type="checkbox" checked={wholeAlbum} onChange={(e) => setWholeAlbum(e.target.checked)} /> Whole album
          </label>
        </div>
      </div>
    </div>
  );
}
