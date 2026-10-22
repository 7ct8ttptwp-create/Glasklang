// Playback engine.
//
// Two <audio> elements ("slots") are used like a relay race: while one plays, the next track is
// preloaded in the other one, and playback hops over a few milliseconds before the first one ends.
// Both feed one shared Web Audio chain: 5-band equalizer -> master volume -> speakers.
//
// Note: this is "near-gapless". Browsers do not trim encoder padding from MP3s, so a very short
// (tens of ms) silence can remain on albums that were mixed to flow seamlessly.
//
// An AnalyserNode sits between `master` and the speakers (visualizer / breathing cover).
// Crossfade: every slot has its own gain so two tracks can overlap for a few seconds.

import { fileUrl, Track } from './api';

export const EQ_FREQS = [60, 230, 910, 3600, 14000];
export const EQ_LABELS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];

let activeEngine: Engine | null = null;
let crossfadeSeconds = 0;
export const getEngine = (): Engine | null => activeEngine;
export const setCrossfadeSeconds = (s: number): void => {
  crossfadeSeconds = Math.max(0, Math.min(12, s));
};

interface Slot {
  gain: GainNode;
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
  private analyser: AnalyserNode;
  private loopA: number | null = null;
  private loopB: number | null = null;
  private fadeSlot: Slot | null = null;
  private deferredNext: { track: Track | null } | null = null;

  constructor(private ev: EngineEvents) {
    activeEngine = this;
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

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
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.slots = [this.makeSlot(), this.makeSlot()];
  }

  private makeSlot(): Slot {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const gain = this.ctx.createGain();
    const slot: Slot = { gain, el, trackId: null, ready: false };
    const src = this.ctx.createMediaElementSource(el);
    src.connect(gain);
    gain.connect(this.filters[0]);

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
    this.clearLoop();
    for (const sl of this.slots) {
      sl.gain.gain.cancelScheduledValues(0);
      sl.gain.gain.value = 1;
    }
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
    if (this.fadeSlot === o) {
      // the other slot is still fading out - apply this when it is free
      this.deferredNext = { track };
      return;
    }
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

  /** Frequency data (0..255) for the visualizer. */
  readFrequencies(out: Uint8Array): void {
    this.analyser.getByteFrequencyData(out as never);
  }

  get binCount(): number {
    return this.analyser.frequencyBinCount;
  }

  setLoop(a: number | null, b: number | null) {
    this.loopA = a;
    this.loopB = b;
  }

  clearLoop() {
    this.loopA = null;
    this.loopB = null;
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
    if (this.loopA !== null && this.loopB !== null && el.currentTime >= this.loopB) {
      el.currentTime = this.loopA;
      return;
    }
    const remaining = (d - el.currentTime) / this.speed;
    const xf = crossfadeSeconds > 0 && d > crossfadeSeconds * 3 ? crossfadeSeconds : 0;
    if (remaining <= (xf > 0 ? xf : HOP_LEAD_SECONDS)) this.hopIfPossible(xf);
  }

  /** Switch to the preloaded slot if it is ready. Returns true on success. */
  private hopIfPossible(fade = 0): boolean {
    const next = this.other;
    if (next.trackId === null || !next.el.src || next.el.readyState < 3) return false;
    const old = this.current;
    this.cur = 1 - this.cur;
    this.clearLoop();
    const t = this.ctx.currentTime;
    next.gain.gain.cancelScheduledValues(t);
    old.gain.gain.cancelScheduledValues(t);
    if (fade > 0) {
      next.gain.gain.setValueAtTime(0, t);
      next.gain.gain.linearRampToValueAtTime(1, t + fade);
      old.gain.gain.setValueAtTime(1, t);
      old.gain.gain.linearRampToValueAtTime(0, t + fade);
    } else {
      next.gain.gain.setValueAtTime(1, t);
    }
    this.fadeSlot = old;
    this.applySpeed(next.el);
    next.el.currentTime = 0;
    void next.el.play().catch(() => undefined);
    old.trackId = null;
    window.setTimeout(() => {
      if (old.trackId === null) {
        old.el.pause();
        old.el.removeAttribute('src');
        old.el.load();
      }
      if (this.fadeSlot === old) this.fadeSlot = null;
      const d = this.deferredNext;
      if (d) {
        this.deferredNext = null;
        this.setNext(d.track);
      }
    }, fade * 1000 + 400);
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
