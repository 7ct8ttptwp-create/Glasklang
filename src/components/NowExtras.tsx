import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getEngine } from '../lib/audio';
import { useFx } from '../lib/fx';
import { useStore } from '../lib/store';
import { formatTime } from '../lib/util';

/** Draws the spectrum and makes the cover "breathe" with the bass. Renders nothing visible if off. */
export function Visualizer() {
  const visualizer = useFx((s) => s.visualizer);
  const breathe = useFx((s) => s.breathe);
  const playing = useStore((s) => s.playing);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const art = document.querySelector('.np-art') as HTMLElement | null;
    const canvas = ref.current;
    let raf = 0;
    let data: Uint8Array | null = null;
    let bass = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const eng = getEngine();
      if (!eng) return;
      if (!data || data.length !== eng.binCount) data = new Uint8Array(eng.binCount);
      if (playing) eng.readFrequencies(data);
      else data.fill(0);
      let b = 0;
      for (let i = 0; i < 4; i++) b += data[i];
      const target = b / 4 / 255;
      bass += (target - bass) * 0.35;
      if (art) art.style.setProperty('--bass', breathe ? bass.toFixed(3) : '0');
      if (canvas && visualizer) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const bars = 48;
        const gap = 4;
        const bw = (w - gap * (bars - 1)) / bars;
        const usable = Math.floor(data.length * 0.75);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < bars; i++) {
          const v = data[Math.floor((i / bars) * usable)] / 255;
          const bh = Math.max(3, v * v * h);
          const x = i * (bw + gap);
          ctx.beginPath();
          ctx.roundRect(x, h - bh, bw, bh, Math.min(bw / 2, 4));
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      art?.style.setProperty('--bass', '0');
    };
  }, [visualizer, breathe, playing]);

  if (!visualizer) return null;
  return <canvas ref={ref} className="np-vis" width={720} height={64} />;
}

interface Line {
  t: number;
  text: string;
}

function parseLrc(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: body });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Shows synced lyrics from a .lrc file with the same name next to the song. */
export function Lyrics() {
  const enabled = useFx((s) => s.lyrics);
  const track = useStore((s) => s.queue[s.index]);
  const position = useStore((s) => s.position);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    let alive = true;
    setLines([]);
    if (!enabled || !track) return;
    const lrc = track.path.replace(/\.[^./\\]+$/, '.lrc');
    api
      .readTextFile(lrc)
      .then((txt) => {
        if (alive) setLines(parseLrc(txt));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [track?.path, enabled]);

  if (lines.length === 0) return null;
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].t <= position + 0.15) i = k;
    else break;
  }
  const at = (k: number) => (k >= 0 && k < lines.length ? lines[k].text : '');
  return (
    <div className="np-lyrics" aria-live="off">
      <div className="l dim">{at(i - 1) || ' '}</div>
      <div className="l cur" key={i}>{at(i) || '♪'}</div>
      <div className="l dim">{at(i + 1) || ' '}</div>
    </div>
  );
}

/** A-B loop button: first click marks A, second marks B, third clears. */
export function LoopButton() {
  const track = useStore((s) => s.queue[s.index]);
  const position = useStore((s) => s.position);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);

  useEffect(() => {
    setA(null);
    setB(null);
  }, [track?.id]);

  const click = () => {
    const eng = getEngine();
    if (!eng) return;
    if (a === null) {
      setA(eng.position);
    } else if (b === null) {
      if (eng.position <= a + 0.5) return;
      setB(eng.position);
      eng.setLoop(a, eng.position);
    } else {
      setA(null);
      setB(null);
      eng.clearLoop();
    }
  };

  const label = a === null ? 'A-B loop' : b === null ? `A ${formatTime(a)} - set B` : `${formatTime(a)}-${formatTime(b)}`;
  void position;
  return (
    <button className={`btn small${a !== null ? ' on' : ''}`} disabled={!track} onClick={click} title="Repeat a section of the song">
      {label}
    </button>
  );
}
