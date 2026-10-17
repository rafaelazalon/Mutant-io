/**
 * Trilhas sonoras procedurais (WebAudio, sem arquivos):
 * - "title": ambiente lento de placa de Petri (pads + arpejo com eco);
 * - "game": groove eletrônico de 112 BPM (bumbo, chimbal, palmas, baixo e arpejo),
 *   que ganha mais energia nos 30 segundos finais.
 * Agendamento com antecedência, para não depender do ritmo dos quadros.
 */
type Track = 'title' | 'game' | null;

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// progressões (notas MIDI da fundamental)
const TITLE_CHORDS = [
  [57, 60, 64], // Lá menor
  [53, 57, 60], // Fá
  [48, 55, 60], // Dó
  [55, 59, 62], // Sol
];
const GAME_CHORDS = [
  [50, 53, 57], // Ré menor
  [46, 50, 53], // Si bemol
  [48, 52, 55], // Dó
  [45, 48, 52], // Lá menor
];

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private delay: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: Track = null;
  private want: Track = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private volume = 0.5;
  intense = false;

  attach(ctx: AudioContext, destination: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    // eco simples para arpejos
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.32;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.out);
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.want) this.play(this.want);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out && this.ctx && this.track) this.out.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.2);
    if (v <= 0) this.stop();
    else if (this.want && !this.track) this.play(this.want);
  }

  play(t: Track) {
    this.want = t;
    if (!this.ctx || !this.out || this.volume <= 0) return;
    if (t === this.track) return;
    const c = this.ctx;
    // troca suave: abaixa, troca a trilha, sobe
    this.out.gain.setTargetAtTime(0, c.currentTime, 0.15);
    this.track = t;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!t) return;
    this.step = 0;
    this.nextTime = c.currentTime + 0.35;
    this.out.gain.setTargetAtTime(this.volume * 0.55, c.currentTime + 0.3, 0.6);
    this.timer = window.setInterval(() => this.schedule(), 30);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.track = null;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  private schedule() {
    const c = this.ctx;
    if (!c || !this.track) return;
    if (c.state !== 'running') return;
    const bpm = this.track === 'title' ? 84 : 112;
    const stepDur = 60 / bpm / 4;
    // evita rajada de notas depois de a aba ficar oculta
    if (this.nextTime < c.currentTime - 0.5) this.nextTime = c.currentTime + 0.05;
    while (this.nextTime < c.currentTime + 0.15) {
      if (this.track === 'title') this.titleStep(this.step, this.nextTime, stepDur);
      else this.gameStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  /* ----------------------------- instrumentos ----------------------------- */

  private osc(type: OscillatorType, freq: number, t: number, dur: number, gain: number, attack = 0.01, toDelay = false, detune = 0) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    if (toDelay && this.delay) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(notes: number[], t: number, dur: number) {
    for (const n of notes) {
      this.osc('triangle', NOTE(n), t, dur, 0.035, dur * 0.35, false, -6);
      this.osc('sine', NOTE(n + 12), t, dur, 0.02, dur * 0.4, false, 7);
    }
  }

  private kick(t: number, g = 0.9) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const gn = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    gn.gain.setValueAtTime(g, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(gn).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hit(t: number, freq: number, q: number, dur: number, g: number, type: BiquadFilterType = 'highpass') {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const gn = c.createGain();
    gn.gain.setValueAtTime(g, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(gn).connect(this.out!);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  private bass(freq: number, t: number, dur: number, g: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const f = c.createBiquadFilter();
    const gn = c.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    f.Q.value = 6;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(gn).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* -------------------------------- trilhas ------------------------------- */

  private titleStep(step: number, t: number, sd: number) {
    const bar = Math.floor(step / 16);
    const chord = TITLE_CHORDS[bar % 4]!;
    const s = step % 16;
    if (s === 0) {
      this.pad(chord, t, sd * 16 * 1.1);
      this.osc('sine', NOTE(chord[0]! - 24), t, sd * 15, 0.09, 0.4);
    }
    // arpejo pontilhado com eco
    if (s % 3 === 0) {
      const n = chord[(s / 3) % 3]! + 12 + (s >= 9 ? 12 : 0);
      this.osc('triangle', NOTE(n), t, sd * 2.5, 0.05, 0.005, true);
    }
    // gotinhas aleatórias (bolhas)
    if (Math.random() < 0.06) this.osc('sine', NOTE(84 + Math.floor(Math.random() * 12)), t, 0.18, 0.025, 0.005, true);
  }

  private gameStep(step: number, t: number, sd: number) {
    const bar = Math.floor(step / 16);
    const chord = GAME_CHORDS[bar % 4]!;
    const s = step % 16;
    // bateria
    if (s === 0 || s === 8 || s === 10 || (this.intense && s === 4) || (s === 14 && bar % 2 === 1)) this.kick(t, s === 0 ? 0.95 : 0.75);
    if (s === 4 || s === 12) this.hit(t, 1500, 0.8, 0.16, 0.32, 'bandpass');
    if (s % 2 === 0) this.hit(t, 7000, 0.7, 0.04, s % 4 === 2 ? 0.12 : 0.07);
    if (this.intense && s % 2 === 1) this.hit(t, 8000, 0.7, 0.03, 0.06);
    // baixo sincopado
    const bassPattern = [0, -1, 0, 0, -1, 0, 12, -1, 0, -1, 0, 7, -1, 0, 12, -1];
    const bp = bassPattern[s]!;
    if (bp >= 0) this.bass(NOTE(chord[0]! - 12 + bp), t, sd * 1.6, 0.14);
    // pad na virada do compasso
    if (s === 0) this.pad(chord, t, sd * 16);
    // arpejo
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    if (s % 2 === 0 && (bar % 4 !== 3 || s < 8)) {
      const n = chord[arp[(s / 2) % 8]!]! + 24;
      this.osc('square', NOTE(n), t, sd * 1.2, this.intense ? 0.032 : 0.022, 0.003, true);
    }
  }
}
