import { CSSProperties, useState } from 'react';
import { useStore } from '../lib/store';
import { formatTime } from '../lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';

function RangeGlass(props: {
  value: number;
  max: number;
  step?: number;
  onInput: (v: number) => void;
  onCommit?: (v: number) => void;
  label: string;
  className?: string;
}) {
  const { value, max, step = 1, onInput, onCommit, label, className } = props;
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <input
      type="range"
      className={`range ${className ?? ''}`}
      min={0}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      onChange={(e) => onInput(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
    />
  );
}

export function PlayerBar({ compact }: { compact: boolean }) {
  const track = useStore((s) => s.queue[s.index]);
  const playing = useStore((s) => s.playing);
  const position = useStore((s) => s.position);
  const duration = useStore((s) => s.duration);
  const settings = useStore((s) => s.settings);
  const view = useStore((s) => s.view);
  const togglePlay = useStore((s) => s.togglePlay);
  const next = useStore((s) => s.next);
  const prev = useStore((s) => s.prev);
  const seek = useStore((s) => s.seek);
  const update = useStore((s) => s.updateSettings);
  const setView = useStore((s) => s.setView);
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? position;
  const repeatIcon = settings.repeat === 'one' ? 'repeat1' : 'repeat';

  return (
    <footer className={`playerbar glass${compact ? ' compact' : ''}`}>
      <div className="now" style={{ cursor: compact ? undefined : 'pointer' }} title="Open full cover view" onClick={() => !compact && setView({ kind: 'now' })}>
        <Cover path={track?.path ?? null} size={compact ? 64 : 58} radius={14} />
        <div className="meta">
          <div className="t1" title={track?.title}>{track?.title ?? 'Nothing playing'}</div>
          <div className="t2" title={track?.artist}>{track ? `${track.artist} - ${track.album}` : 'Add a music folder to begin'}</div>
        </div>
      </div>

      <div className="center">
        <div className="controls">
          {!compact && (
            <button className={`icon-btn${settings.shuffle ? ' active' : ''}`} title="Shuffle" onClick={() => update({ shuffle: !settings.shuffle })}>
              <Icon name="shuffle" size={18} />
            </button>
          )}
          <button className="icon-btn big" title="Previous" onClick={prev}>
            <Icon name="prev" size={20} />
          </button>
          <button className="play-btn" title={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            <Icon name={playing ? 'pause' : 'play'} size={26} />
          </button>
          <button className="icon-btn big" title="Next" onClick={next}>
            <Icon name="next" size={20} />
          </button>
          {!compact && (
            <button
              className={`icon-btn${settings.repeat !== 'off' ? ' active' : ''}`}
              title={`Repeat: ${settings.repeat}`}
              onClick={() => update({ repeat: settings.repeat === 'off' ? 'all' : settings.repeat === 'all' ? 'one' : 'off' })}
            >
              <Icon name={repeatIcon} size={18} />
            </button>
          )}
        </div>
        <div className="seek">
          <span className="time">{formatTime(shown)}</span>
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
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      {!compact && (
        <div className="right">
          <label className="speed" title="Playback speed">
            <select value={settings.speed} onChange={(e) => update({ speed: Number(e.target.value) })}>
              {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                <option key={s} value={s}>{s}x</option>
              ))}
            </select>
          </label>
          <button
            className="icon-btn"
            title={settings.volume === 0 ? 'Unmute' : 'Mute'}
            onClick={() => update({ volume: settings.volume === 0 ? 0.8 : 0 })}
          >
            <Icon name={settings.volume === 0 ? 'mute' : 'volume'} size={18} />
          </button>
          <RangeGlass className="vol" value={settings.volume} max={1} step={0.01} label="Volume" onInput={(v) => update({ volume: v })} />
          <button className={`icon-btn${view.kind === 'queue' ? ' active' : ''}`} title="Queue" onClick={() => setView({ kind: 'queue' })}>
            <Icon name="queue" size={18} />
          </button>
        </div>
      )}
    </footer>
  );
}

export { RangeGlass };
