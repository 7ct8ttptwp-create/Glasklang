// Playback engine.
//
// Two <audio> elements ("slots") are used like a relay race: while one plays, the next track is
// preloaded in the other one, and playback hops over a few milliseconds before the first one ends.
// Both feed one shared Web Audio chain: 5-band equalizer -> master volume -> speakers.
//
// Note: this is "near-gapless". Browsers do not trim encoder padding from MP3s, so a very short
// (tens of ms) silence can remain on albums that were mixed to flow seamlessly.
//
// Extension point: add an AnalyserNode between `master` and `ctx.destination` for a visualizer.

import { fileUrl, Track } from './api';

export const EQ_FREQS = [60, 230, 910, 3600, 14000];
export const EQ_LABELS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];

interface Slot {
  el: HTMLAudioElement;
  trackId: number | null;
  ready: boolean;
}

export interface EngineEvents {
  /** Called ~4x per second while playing. */
  onTime: (position: number, duration: number) => void;
  /** The engine already switched to the preloaded track (gapless hop) - the queue should advance. */
  onAdvanced: () => void;
  /** Current track ended and no track was preloaded. */
  onEndedNoNext: () => void;
  /** Playback of this track failed (corrupt / missing file). */
  onError: (trackId: number | null) => void;
  onPlayState: (playing: boolean) => void;
}

const HOP_LEAD_SECONDS = 0.09;

export class Engine {
  private ctx: AudioContext;
  private master: GainNode;
  private filters: BiquadFilterNode[] = [];
  private slots: Slot[];
  private cur = 0;
  private timer: number | null = null;
  private pendingSeek: number | null = null;
  private eqEnabled = true;
  private eqGains = [0, 0, 0, 0, 0];
  private speed = 1;

  constructor(private ev: EngineEvents) {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.master = this.ctx.createGain();

    const types: BiquadFilterType[] = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];
    this.filters = EQ_FREQS.map((f, i) => {
      const b = this.ctx.createBiquadFilter();
      b.type = types[i];
      b.frequency.value = f;
      b.Q.value = 1;
      b.gain.value = 0;
      return b;
    });
    // chain: filters[0] -> ... -> filters[4] -> master -> destination
    for (let i = 0; i < this.filters.length - 1; i++) this.filters[i].connect(this.filters[i + 1]);
    this.filters[this.filters.length - 1].connect(this.master);
    this.master.connect(this.ctx.destination);

    this.slots = [this.makeSlot(), this.makeSlot()];
  }

  private makeSlot(): Slot {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const slot: Slot = { el, trackId: null, ready: false };
    const src = this.ctx.createMediaElementSource(el);
    src.connect(this.filters[0]);

    el.addEventListener('canplaythrough', () => (slot.ready = true));
    el.addEventListener('loadedmetadata', () => {
      if (slot === this.slots[this.cur] && this.pendingSeek !== null) {
        el.currentTime = Math.min(this.pendingSeek, Math.max(0, (el.duration || 0) - 0.5));
        this.pendingSeek = null;
      }
    });
    el.addEventListener('timeupdate', () => {
      if (slot === this.slots[this.cur]) this.ev.onTime(el.currentTime, el.duration || 0);
    });
    el.addEventListener('error', () => {
      if (!slot.el.src) return;
      if (slot === this.slots[this.cur]) this.ev.onError(slot.trackId);
      else slot.trackId = null; // the preloaded track is broken: forget it, it will be skipped later
    });
    el.addEventListener('play', () => {
      if (slot === this.slots[this.cur]) this.ev.onPlayState(true);
    });
    el.addEventListener('pause', () => {
      if (slot === this.slots[this.cur] && !el.ended) this.ev.onPlayState(false);
    });
    el.addEventListener('ended', () => {
      if (slot !== this.slots[this.cur]) return;
      // The hop timer normally switches earlier. If it did not (e.g. nothing preloaded) we land here.
      if (!this.hopIfPossible()) {
        this.stopTimer();
        this.ev.onPlayState(false);
        this.ev.onEndedNoNext();
      }
    });
    return slot;
  }

  private get current(): Slot {
    return this.slots[this.cur];
  }

  private get other(): Slot {
    return this.slots[1 - this.cur];
  }

  private applySpeed(el: HTMLAudioElement) {
    el.playbackRate = this.speed;
    el.preservesPitch = true;
  }

  /** Load a track in the current slot. Optionally start playing and/or jump to a position. */
  async load(track: Track, opts: { autoplay: boolean; startAt?: number }): Promise<void> {
    // Instant switch if the track was already preloaded in the other slot.
    if (this.other.trackId === track.id && this.other.el.src) {
      this.current.el.pause();
      this.cur = 1 - this.cur;
    } else {
      const s = this.current;
      s.el.pause();
      s.ready = false;
      s.trackId = track.id;
      s.el.src = fileUrl(track.path);
      this.applySpeed(s.el);
    }
    this.current.trackId = track.id;
    this.pendingSeek = opts.startAt && opts.startAt > 0 ? opts.startAt : null;
    if (this.pendingSeek !== null && this.current.el.readyState >= 1) {
      this.current.el.currentTime = this.pendingSeek;
      this.pendingSeek = null;
    } else if (this.pendingSeek === null) {
      this.current.el.currentTime = 0;
    }
    this.applySpeed(this.current.el);
    if (opts.autoplay) await this.play();
  }

  /** Preload the track that should play after the current one (or clear it with null). */
  setNext(track: Track | null) {
    const o = this.other;
    if (!track) {
      if (o.trackId !== null) {
        o.el.removeAttribute('src');
        o.el.load();
        o.trackId = null;
        o.ready = false;
      }
      return;
    }
    if (o.trackId === track.id) return;
    o.trackId = track.id;
    o.ready = false;
    o.el.src = fileUrl(track.path);
    this.applySpeed(o.el);
  }

  async play(): Promise<void> {
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      await this.current.el.play();
      this.startTimer();
    } catch {
      // Autoplay refusal or a broken file; the 'error' event reports broken files.
    }
  }

  pause() {
    this.current.el.pause();
    this.stopTimer();
  }

  toggle() {
    if (this.current.el.paused) void this.play();
    else this.pause();
  }

  get isPlaying(): boolean {
    return !this.current.el.paused;
  }

  seek(seconds: number) {
    const el = this.current.el;
    if (Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds);
  }

  get position(): number {
    return this.current.el.currentTime || 0;
  }

  setVolume(v: number) {
    // perceptual curve: slider 0..1 -> gain 0..1
    this.master.gain.value = Math.pow(Math.min(1, Math.max(0, v)), 2);
  }

  setSpeed(s: number) {
    this.speed = s;
    this.slots.forEach((sl) => this.applySpeed(sl.el));
  }

  setEq(enabled: boolean, gains: number[]) {
    this.eqEnabled = enabled;
    this.eqGains = gains.slice();
    this.filters.forEach((f, i) => (f.gain.value = enabled ? gains[i] ?? 0 : 0));
  }

  // ---- gapless hop ----

  private startTimer() {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  private stopTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const el = this.current.el;
    const d = el.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const remaining = (d - el.currentTime) / this.speed;
    if (remaining <= HOP_LEAD_SECONDS) this.hopIfPossible();
  }

  /** Switch to the preloaded slot if it is ready. Returns true on success. */
  private hopIfPossible(): boolean {
    const next = this.other;
    if (next.trackId === null || !next.el.src || next.el.readyState < 3) return false;
    const old = this.current;
    this.cur = 1 - this.cur;
    this.applySpeed(next.el);
    next.el.currentTime = 0;
    void next.el.play().catch(() => undefined);
    old.trackId = null;
    window.setTimeout(() => {
      old.el.pause();
      old.el.removeAttribute('src');
      old.el.load();
    }, 400);
    this.ev.onAdvanced();
    return true;
  }

  dispose() {
    this.stopTimer();
    this.slots.forEach((s) => {
      s.el.pause();
      s.el.removeAttribute('src');
    });
    void this.ctx.close();
  }
}
