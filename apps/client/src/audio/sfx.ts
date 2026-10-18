import { Music } from './music.js';
/** Efeitos sonoros sintetizados com WebAudio — sem arquivos externos. */
export type Sfx =
  | 'eat'
  | 'bite'
  | 'hurt'
  | 'pulse'
  | 'dash'
  | 'blink'
  | 'shield'
  | 'blocked'
  | 'evolve'
  | 'hybrid'
  | 'kill'
  | 'death'
  | 'tick'
  | 'click'
  | 'cloak'
  | 'pop'
  | 'zap'
  | 'crit'
  | 'streak'
  | 'alarm'
  | 'meteor'
  | 'golden';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;
  private last = new Map<Sfx, number>();
  private noiseBuf: AudioBuffer | null = null;
  readonly music = new Music();

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v * 0.5;
  }

  /** Precisa ser chamado num gesto do usuário (política dos navegadores). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.4;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.music.attach(this.ctx, this.ctx.destination);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0) {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, freq: number, q = 1) {
    const c = this.ctx;
    if (!c || !this.master || !this.noiseBuf) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur);
  }

  play(s: Sfx) {
    if (!this.ctx || this.volume <= 0) return;
    // limita repetição do mesmo som
    const now = performance.now();
    const min = s === 'eat' ? 45 : 60;
    if (now - (this.last.get(s) ?? 0) < min) return;
    this.last.set(s, now);
    switch (s) {
      case 'eat':
        this.tone(700 + Math.random() * 300, 0.07, 'sine', 0.15, 1300);
        break;
      case 'bite':
        this.noise(0.08, 0.5, 400, 2);
        this.tone(160, 0.08, 'square', 0.12, 80);
        break;
      case 'hurt':
        this.tone(220, 0.15, 'sawtooth', 0.15, 90);
        break;
      case 'pulse':
        this.tone(1200, 0.25, 'sawtooth', 0.12, 120);
        this.noise(0.2, 0.25, 3000, 4);
        break;
      case 'dash':
        this.noise(0.22, 0.35, 900, 0.7);
        break;
      case 'blink':
        this.tone(300, 0.2, 'sine', 0.18, 1800);
        break;
      case 'shield':
        this.tone(880, 0.35, 'triangle', 0.15);
        this.tone(1320, 0.35, 'triangle', 0.1, undefined, 0.05);
        break;
      case 'blocked':
        this.tone(1500, 0.08, 'triangle', 0.12);
        break;
      case 'cloak':
        this.tone(600, 0.3, 'sine', 0.1, 200);
        break;
      case 'pop':
        this.tone(500, 0.1, 'sine', 0.15, 900);
        break;
      case 'evolve':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, undefined, i * 0.07));
        break;
      case 'hybrid':
        [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.35, 'sawtooth', 0.08, undefined, i * 0.05));
        break;
      case 'kill':
        this.tone(880, 0.12, 'square', 0.12, 1760);
        this.noise(0.15, 0.3, 1500, 1);
        break;
      case 'death':
        this.tone(400, 0.6, 'sawtooth', 0.18, 60);
        break;
      case 'tick':
        this.tone(1000, 0.05, 'square', 0.08);
        break;
      case 'zap':
        this.noise(0.18, 0.45, 2600, 3);
        this.tone(1800, 0.16, 'sawtooth', 0.1, 300);
        break;
      case 'click':
        this.tone(660, 0.05, 'triangle', 0.1);
        break;
      case 'crit':
        this.noise(0.12, 0.6, 600, 1.5);
        this.tone(260, 0.16, 'square', 0.14, 70);
        this.tone(1400, 0.08, 'triangle', 0.1, undefined, 0.02);
        break;
      case 'streak':
        [660, 880, 1175].forEach((f, i) => this.tone(f, 0.14, 'square', 0.09, undefined, i * 0.06));
        break;
      case 'alarm':
        [0, 0.22, 0.44].forEach((d) => this.tone(740, 0.14, 'triangle', 0.12, 980, d));
        break;
      case 'meteor':
        this.noise(0.5, 0.5, 220, 0.6);
        this.tone(140, 0.5, 'sine', 0.2, 45);
        break;
      case 'golden':
        [784, 988, 1319, 1568].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.12, undefined, i * 0.08));
        break;
    }
  }
}
