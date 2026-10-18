import { FLAG, HYBRIDS, MUTATIONS, createRng, type GameEvent, type HybridId, type MutationId } from '@mutant/shared';
import type { Audio } from '../audio/sfx.js';
import type { ClientGame, RemoteView } from '../net/game.js';
import { drawCreature } from './creature.js';
import { Fx } from './fx.js';
import { glow, hexTile, pelletSprite } from './sprites.js';
import { viewport } from '../ui/viewport.js';

interface Deco {
  x: number;
  y: number;
  r: number;
  kind: 0 | 1;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  ph: number;
  c: string;
}

export type Quality = 'auto' | 'alta' | 'baixa';

const EMPTY_M = new Set<MutationId>();
const EMPTY_H = new Set<HybridId>();
const ARENA = 3200;
/** resolução do chão pré-renderizado (px por unidade do mundo) */
const GROUND_RES = 0.25;
export const UI_FONT = "'Fredoka', 'Nunito', system-ui, sans-serif";
export const DISPLAY_FONT = "'Lilita One', 'Fredoka', system-ui, sans-serif";

/**
 * Renderização Canvas 2D otimizada para celulares:
 * - chão, poças de ácido, zonas, corpos das criaturas e nomes são pré-renderizados e reutilizados;
 * - só o que se move é desenhado a cada quadro;
 * - a resolução se ajusta sozinha ao desempenho do aparelho (qualidade "auto").
 */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  /** fração da resolução nativa usada (resolução adaptativa) */
  renderScale = 1;
  quality: Quality = 'auto';
  hq = true;
  cam = { x: 1600, y: 1600, scale: 1, lx: 0, ly: 0 };
  fx = new Fx();
  time = 0;
  shake = 0;
  private flash = { a: 0, color: '255,60,90' };
  private deep: Deco[] = [];
  private motes: Mote[] = [];
  private ground: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private redVignette: HTMLCanvasElement | null = null;
  private hexPattern: CanvasPattern | null = null;
  private acidCache = new Map<string, { c: HTMLCanvasElement; pad: number; bubbles: { a: number; d: number; ph: number; sp: number; s: number }[] }>();
  private zoneBase = new Map<number, HTMLCanvasElement>();
  private coreSprite: HTMLCanvasElement | null = null;
  private zoneArcs = new Map<number, { t: number; pts: number[][] }>();
  private labelCache = new Map<string, { c: HTMLCanvasElement; w: number; h: number }>();
  private setCache = new Map<number, { key: string; m: Set<MutationId>; h: Set<HybridId> }>();
  private lastViews = new Map<number, RemoteView>();
  private biteAt = new Map<number, number>();
  private wasInZone = new Map<number, boolean>();
  private trailT = 0;
  private minimapT = 0;
  // governador de desempenho
  private frameAvg = 16;
  private slowFor = 0;
  private fastFor = 0;
  onSelfEvent: (e: GameEvent) => void = () => {};
  onZoneShock: () => void = () => {};
  onSelfHit: () => void = () => {};
  onKill: (e: Extract<GameEvent, { k: 'kill' }>) => void = () => {};
  /** direções de onde veio dano recente (indicador na borda da tela) */
  private hitFrom: { a: number; t: number; back: boolean }[] = [];
  private dashGhost = new Map<number, number>();

  /** eventos do quadro (para o modo 3D desenhar os próprios efeitos) */
  onEventBatch: (evs: GameEvent[]) => void = () => {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly minimap: HTMLCanvasElement,
    /** modo 3D: este canvas vira só a camada de cima (minimapa, setas, avisos); o mundo é desenhado em 3D por baixo */
    readonly overlay = false,
  ) {
    const ctx = canvas.getContext('2d', { alpha: overlay, desynchronized: !overlay } as CanvasRenderingContext2DSettings);
    if (!ctx) throw new Error('Canvas 2D indisponível');
    this.ctx = ctx;
    this.resize();
    viewport.onChange(() => this.resize());
    this.seedDecor(1);
    // fontes carregadas depois mudam a largura dos nomes: limpa o cache de rótulos
    document.fonts?.ready.then(() => this.labelCache.clear()).catch(() => {});
  }

  setQuality(q: Quality) {
    this.quality = q;
    if (q === 'baixa') {
      this.hq = false;
      this.renderScale = 0.75;
    } else if (q === 'alta') {
      this.hq = true;
      this.renderScale = 1;
    } else {
      // começa num meio-termo e ajusta pelo desempenho medido
      const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
      this.hq = !weak;
      this.renderScale = weak ? 0.8 : 1;
    }
    this.applyFxQuality();
    this.resize();
    this.seedMotes();
  }

  private applyFxQuality() {
    this.fx.cap = this.hq ? 400 : 140;
    this.fx.hq = this.hq;
  }

  /** Ajuste automático: abaixa a resolução/efeitos se os quadros demoram, sobe se sobra folga. */
  private govern(dt: number) {
    if (this.quality !== 'auto') return;
    const ms = dt * 1000;
    this.frameAvg += (ms - this.frameAvg) * 0.05;
    if (this.frameAvg > 24) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.frameAvg < 15) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this.slowFor > 1.5) {
      this.slowFor = 0;
      if (this.hq) {
        this.hq = false;
        this.applyFxQuality();
      } else if (this.renderScale > 0.55) {
        this.renderScale = Math.max(0.55, this.renderScale - 0.15);
        this.resize();
      }
    } else if (this.fastFor > 6) {
      this.fastFor = 0;
      if (this.renderScale < 1) {
        this.renderScale = Math.min(1, this.renderScale + 0.1);
        this.resize();
      } else if (!this.hq) {
        this.hq = true;
        this.applyFxQuality();
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* recursos pré-renderizados                                        */
  /* -------------------------------------------------------------- */

  /** Pinta o chão da arena uma vez por partida (biomas, veias, células, tecido). */
  seedDecor(seed: number) {
    const rng = createRng(Math.floor(seed) * 977 + 13);
    this.deep = [];
    for (let i = 0; i < 30; i++) this.deep.push({ x: rng.range(0, 2400), y: rng.range(0, 2400), r: rng.range(60, 220), kind: rng.pick([0, 1] as const) });

    const S = Math.round(ARENA * GROUND_RES);
    const g = document.createElement('canvas');
    g.width = S;
    g.height = S;
    const x = g.getContext('2d');
    if (x) {
      x.scale(GROUND_RES, GROUND_RES);
      // base em degradê
      const bg = x.createLinearGradient(0, 0, ARENA, ARENA);
      bg.addColorStop(0, '#0b1730');
      bg.addColorStop(0.5, '#0a1428');
      bg.addColorStop(1, '#100f2c');
      x.fillStyle = bg;
      x.fillRect(0, 0, ARENA, ARENA);
      // biomas (manchas de cor suaves)
      const tints = ['rgba(40,200,180,0.22)', 'rgba(130,80,230,0.2)', 'rgba(70,180,100,0.18)', 'rgba(40,110,220,0.22)', 'rgba(220,70,150,0.12)'];
      for (let i = 0; i < 16; i++) {
        const cx = rng.range(0, ARENA);
        const cy = rng.range(0, ARENA);
        const r = rng.range(300, 760);
        const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, rng.pick(tints));
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gr;
        x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      // tecido hexagonal
      const pat = x.createPattern(hexTile(), 'repeat');
      if (pat) {
        x.fillStyle = pat;
        x.fillRect(0, 0, ARENA, ARENA);
      }
      // veias ramificadas
      x.lineCap = 'round';
      const vein = (px: number, py: number, a: number, w: number, depth: number) => {
        x.strokeStyle = `rgba(90,160,255,${0.06 + depth * 0.02})`;
        x.lineWidth = w;
        x.beginPath();
        x.moveTo(px, py);
        const steps = 14 + Math.floor(rng.next() * 10);
        for (let k = 0; k < steps; k++) {
          a += rng.range(-0.35, 0.35);
          px += Math.cos(a) * 26;
          py += Math.sin(a) * 26;
          x.lineTo(px, py);
          if (depth > 0 && rng.next() < 0.08) {
            x.stroke();
            vein(px, py, a + rng.range(-1.2, 1.2), w * 0.6, depth - 1);
            x.strokeStyle = `rgba(90,160,255,${0.06 + depth * 0.02})`;
            x.lineWidth = w;
            x.beginPath();
            x.moveTo(px, py);
          }
        }
        x.stroke();
      };
      for (let i = 0; i < 12; i++) vein(rng.range(0, ARENA), rng.range(0, ARENA), rng.range(0, 6.28), rng.range(8, 14), 2);
      // colônias de células, diatomáceas e crateras
      for (let i = 0; i < 220; i++) {
        const cx = rng.range(0, ARENA);
        const cy = rng.range(0, ARENA);
        const r = rng.range(14, 70);
        const kind = rng.int(0, 4);
        if (kind === 0) {
          x.strokeStyle = 'rgba(130,190,255,0.12)';
          x.lineWidth = 4;
          x.beginPath();
          x.ellipse(cx, cy, r, r * rng.range(0.75, 1), rng.range(0, 3), 0, Math.PI * 2);
          x.stroke();
          x.fillStyle = 'rgba(130,190,255,0.07)';
          x.beginPath();
          x.arc(cx + r * 0.25, cy - r * 0.1, r * 0.3, 0, Math.PI * 2);
          x.fill();
        } else if (kind === 1) {
          x.strokeStyle = 'rgba(180,150,255,0.1)';
          x.lineWidth = 4;
          x.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            x.moveTo(cx, cy);
            x.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
          }
          x.stroke();
          x.beginPath();
          x.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
          x.stroke();
        } else if (kind === 2) {
          x.fillStyle = 'rgba(110,230,170,0.08)';
          for (let k = 0; k < 6; k++) {
            const a = k * 1.1;
            x.beginPath();
            x.arc(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.2, 0, Math.PI * 2);
            x.fill();
          }
        } else {
          // cratera de membrana
          const cg = x.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.4);
          cg.addColorStop(0, 'rgba(0,0,10,0.25)');
          cg.addColorStop(0.7, 'rgba(0,0,10,0.08)');
          cg.addColorStop(0.85, 'rgba(120,180,255,0.1)');
          cg.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = cg;
          x.beginPath();
          x.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
          x.fill();
        }
      }
      // brilho de perigo junto às paredes
      const band = 200;
      const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
        const gr = x.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, 'rgba(255,60,130,0.22)');
        gr.addColorStop(1, 'rgba(255,60,130,0)');
        x.fillStyle = gr;
        x.fillRect(rx, ry, rw, rh);
      };
      edge(0, 0, band, 0, 0, 0, band, ARENA);
      edge(ARENA, 0, ARENA - band, 0, ARENA - band, 0, band, ARENA);
      edge(0, 0, 0, band, 0, 0, ARENA, band);
      edge(0, ARENA, 0, ARENA - band, 0, ARENA - band, ARENA, band);
    }
    this.ground = g;
    this.acidCache.clear();
  }

  private seedMotes() {
    const n = this.hq ? 36 : 0;
    const cols = ['#7dff6a', '#5ce1ff', '#b07cff', '#ffe066'];
    this.motes = [];
    for (let i = 0; i < n; i++) {
      this.motes.push({ x: Math.random() * 2000 - 1000, y: Math.random() * 2000 - 1000, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12, s: 1 + Math.random() * 2.5, ph: Math.random() * 6, c: cols[i % cols.length]! });
    }
  }

  get effDpr() {
    return Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
  }

  resize() {
    this.dpr = this.effDpr;
    this.w = viewport.size.w;
    this.h = viewport.size.h;
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    const mk = (inner: string, outer: string) => {
      const v = document.createElement('canvas');
      v.width = Math.max(1, Math.round(this.w / 3));
      v.height = Math.max(1, Math.round(this.h / 3));
      const vx = v.getContext('2d');
      if (vx) {
        const gr = vx.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.3, v.width / 2, v.height / 2, Math.hypot(v.width, v.height) / 2);
        gr.addColorStop(0, inner);
        gr.addColorStop(1, outer);
        vx.fillStyle = gr;
        vx.fillRect(0, 0, v.width, v.height);
      }
      return v;
    };
    this.vignette = mk('rgba(0,0,0,0)', 'rgba(0,0,8,0.6)');
    this.redVignette = mk('rgba(255,0,40,0)', 'rgba(255,0,40,0.55)');
    this.hexPattern = null;
    this.labelCache.clear();
  }

  private acidSprite(x: number, y: number, r: number) {
    const key = `${x}|${y}|${r}|${this.hq ? 1 : 0}`;
    let a = this.acidCache.get(key);
    if (a) return a;
    const rng = createRng(Math.round(x * 7 + y * 13 + r));
    const offs = Array.from({ length: 22 }, () => rng.range(0.9, 1.1));
    const pad = r * 0.7;
    const res = 0.75;
    const size = Math.ceil((r + pad) * 2 * res);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (g) {
      g.scale(res, res);
      const m = r + pad;
      g.drawImage(glow('#9dff2a', 96), 0, 0, m * 2, m * 2);
      g.globalAlpha = 1;
      const path = (scale: number) => {
        g.beginPath();
        offs.forEach((o, i) => {
          const an = (i / offs.length) * Math.PI * 2;
          const px = m + Math.cos(an) * r * scale * o;
          const py = m + Math.sin(an) * r * scale * o;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.closePath();
      };
      path(1);
      const gr = g.createRadialGradient(m - r * 0.2, m - r * 0.2, r * 0.1, m, m, r * 1.1);
      gr.addColorStop(0, 'rgba(225,255,100,0.92)');
      gr.addColorStop(0.55, 'rgba(120,210,20,0.85)');
      gr.addColorStop(1, 'rgba(40,90,10,0.95)');
      g.fillStyle = gr;
      g.fill();
      g.lineWidth = 9;
      g.strokeStyle = 'rgba(25,35,0,0.9)';
      g.stroke();
      // ondulações fixas na superfície
      g.save();
      path(0.95);
      g.clip();
      g.strokeStyle = 'rgba(240,255,180,0.22)';
      g.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        const yy = m - r + (i + 0.5) * (r * 2 / 5);
        g.beginPath();
        for (let k = 0; k <= 12; k++) {
          const xx = m - r + (k / 12) * r * 2;
          const o = Math.sin(k * 1.3 + i * 2) * 6;
          if (k === 0) g.moveTo(xx, yy + o);
          else g.lineTo(xx, yy + o);
        }
        g.stroke();
      }
      g.restore();
      // faixa de alerta (fixa; o brilho anima por cima)
      path(1);
      g.setLineDash([18, 12]);
      g.strokeStyle = 'rgba(230,255,70,0.95)';
      g.lineWidth = 4;
      g.stroke();
      g.setLineDash([]);
      // rótulo
      g.font = `700 22px ${DISPLAY_FONT}`;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(15,25,0,0.6)';
      const tw = g.measureText('☣ ÁCIDO').width;
      g.beginPath();
      g.roundRect?.(m - tw / 2 - 12, m - 18, tw + 24, 32, 10);
      g.fill();
      g.fillStyle = '#eaff9a';
      g.fillText('☣ ÁCIDO', m, m + 7);
    }
    const bubbles = Array.from({ length: 8 }, () => ({ a: rng.range(0, 6.28), d: rng.range(0.15, 0.8), ph: rng.range(0, 1), sp: rng.range(0.35, 0.8), s: rng.range(5, 12) }));
    a = { c, pad, bubbles };
    this.acidCache.set(key, a);
    return a;
  }

  private zoneSprite(r: number) {
    let c = this.zoneBase.get(r);
    if (c) return c;
    const res = 0.5;
    const pad = r * 0.45;
    const size = Math.ceil((r + pad) * 2 * res);
    c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (g) {
      g.scale(res, res);
      const m = r + pad;
      g.globalAlpha = 0.5;
      g.drawImage(glow('#3fd8ff', 96), 0, 0, m * 2, m * 2);
      g.globalAlpha = 1;
      const gr = g.createRadialGradient(m, m, r * 0.05, m, m, r);
      gr.addColorStop(0, 'rgba(180,252,255,0.5)');
      gr.addColorStop(0.5, 'rgba(60,200,255,0.22)');
      gr.addColorStop(1, 'rgba(30,120,255,0.08)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(m, m, r, 0, Math.PI * 2);
      g.fill();
      // runas/hexágonos no piso da zona
      g.strokeStyle = 'rgba(150,240,255,0.22)';
      g.lineWidth = 3;
      for (let k = 0; k < 2; k++) {
        const rr = r * (0.42 + k * 0.28);
        g.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI * 2 + k * 0.5;
          if (i === 0) g.moveTo(m + Math.cos(a) * rr, m + Math.sin(a) * rr);
          else g.lineTo(m + Math.cos(a) * rr, m + Math.sin(a) * rr);
        }
        g.stroke();
      }
    }
    this.zoneBase.set(r, c);
    return c;
  }

  private core() {
    if (this.coreSprite) return this.coreSprite;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    if (g) {
      g.drawImage(glow('#7ff0ff', 96), 0, 0, 96, 96);
      g.translate(48, 48);
      g.fillStyle = 'rgba(215,252,255,0.95)';
      g.strokeStyle = '#2bbbe0';
      g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const rr = k % 2 ? 12 : 22;
        if (k === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
    this.coreSprite = c;
    return c;
  }

  /** Nome + nível pré-renderizados (texto com contorno é caro por quadro). */
  private labelSprite(text: string, lv: number, color: string, badge: string) {
    const px = Math.round(13 * this.dpr * 2) / 2;
    const key = `${text}|${lv}|${color}|${badge}|${px}`;
    let l = this.labelCache.get(key);
    if (l) return l;
    const c = document.createElement('canvas');
    const g0 = c.getContext('2d')!;
    g0.font = `600 ${px}px ${UI_FONT}`;
    const tw = g0.measureText(text).width;
    const br = lv >= 0 ? px * 0.78 : 0;
    const w = Math.ceil(tw + br * 2 + px * 0.9);
    const h = Math.ceil(px * 1.7);
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.font = `700 ${px * 0.82}px ${DISPLAY_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (lv >= 0) {
      g.fillStyle = badge;
      g.beginPath();
      g.arc(br + 1, h / 2, br, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#071107';
      g.fillText(String(lv), br + 1, h / 2 + px * 0.05);
    }
    g.font = `600 ${px}px ${UI_FONT}`;
    g.textAlign = 'left';
    g.lineWidth = px * 0.28;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(text, br * 2 + px * 0.35, h / 2);
    g.fillStyle = color;
    g.fillText(text, br * 2 + px * 0.35, h / 2);
    l = { c, w, h };
    this.labelCache.set(key, l);
    if (this.labelCache.size > 120) this.labelCache.delete(this.labelCache.keys().next().value as string);
    return l;
  }

  private sets(g: ClientGame, id: number) {
    const meta = g.meta.get(id);
    if (!meta) return { m: EMPTY_M, h: EMPTY_H };
    const key = meta.muts.join(',') + '|' + meta.hyb.join(',');
    const c = this.setCache.get(id);
    if (c && c.key === key) return c;
    const n = { key, m: new Set(meta.muts), h: new Set(meta.hyb) };
    this.setCache.set(id, n);
    return n;
  }

  private posOf(g: ClientGame, id: number): { x: number; y: number } | null {
    if (id === g.myId && g.me) return g.myRenderPos();
    return this.lastViews.get(id) ?? null;
  }

  private hueOf(g: ClientGame, id: number) {
    return g.meta.get(id)?.hue ?? 200;
  }

  /* -------------------------------------------------------------- */
  /* eventos                                                          */
  /* -------------------------------------------------------------- */

  private handleEvents(g: ClientGame, evs: GameEvent[], audio: Audio) {
    if (evs.length) this.onEventBatch(evs);
    const me = g.myId;
    for (const e of evs) {
      switch (e.k) {
        case 'eat':
          this.fx.seek(e.x, e.y, e.a, '#9dff7a');
          if (e.a === me) audio.play('eat');
          break;
        case 'bite': {
          this.biteAt.set(e.a, this.time);
          const pa = this.posOf(g, e.a);
          const dx = pa ? e.x - pa.x : 1;
          const dy = pa ? e.y - pa.y : 0;
          this.fx.sparks(e.x, e.y, dx, dy, '#fff2c0', 6);
          this.fx.goo(e.x, e.y, `hsl(${this.hueOf(g, e.b)} 85% 60%)`, 6);
          if (e.back) {
            this.fx.banner(e.x, e.y - 34, `-${e.d} PELAS COSTAS!`, '#ff9f1c', e.b === me || e.a === me ? 24 : 18);
            this.fx.shards(e.x, e.y, '#ffb347', 6, 240);
            if (e.a === me || e.b === me) audio.play('crit');
          } else this.fx.text(e.x, e.y - 24, `-${e.d}`, e.b === me ? '#ff5f5f' : '#ffffff', e.b === me ? 24 : 18);
          if (e.b === me) {
            if (pa && g.me) this.hitFrom.push({ a: Math.atan2(pa.y - g.myRenderPos().y, pa.x - g.myRenderPos().x), t: 1, back: !!e.back });
            this.onSelfHit();
            audio.play('hurt');
            this.shake = Math.min(14, this.shake + 7);
            this.flash = { a: 0.3, color: '255,40,70' };
          } else if (e.a === me) {
            audio.play('bite');
            this.shake = Math.min(6, this.shake + 2);
          }
          break;
        }
        case 'blocked': {
          const p = this.posOf(g, e.b);
          if (p) {
            this.fx.hex(p.x, p.y, 30, 60, '#ffe066', 0.3);
            this.fx.shards(p.x, p.y, '#fff3a8', 5, 200);
          }
          if (e.b === me) audio.play('blocked');
          break;
        }
        case 'thorns': {
          const p = this.posOf(g, e.b);
          if (p) {
            this.fx.text(p.x, p.y - 26, `-${e.d}`, '#ff8fb0', 16);
            this.fx.burst(p.x, p.y, '#ff5f8f', 6, 140, 3, 0.35);
          }
          break;
        }
        case 'pulse':
          this.fx.ring(e.x, e.y, 10, e.r, '#5ce1ff', 0.5);
          this.fx.ring(e.x, e.y, 6, e.r * 0.7, '#ffffff', 0.3);
          this.fx.burst(e.x, e.y, '#5ce1ff', 14, e.r * 1.6, 3, 0.45);
          for (let i = 0; i < (this.hq ? 7 : 4); i++) {
            const a = (i / (this.hq ? 7 : 4)) * Math.PI * 2 + Math.random() * 0.6;
            this.fx.bolt(e.x, e.y, e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, i % 2 ? '#9af4ff' : '#e6fdff', 0.24);
          }
          audio.play('pulse');
          if (e.a === me) this.shake = Math.min(10, this.shake + 5);
          break;
        case 'dash': {
          const p = this.posOf(g, e.a);
          if (p) {
            const v = this.lastViews.get(e.a === me ? -1 : e.a);
            const fx = v?.fx ?? 1;
            const fy = v?.fy ?? 0;
            const r = v?.r ?? 24;
            this.fx.ring(p.x, p.y, 10, 60, '#ffb547', 0.25);
            this.fx.speedLines(p.x, p.y, fx, fy, r, '#ffd08a', 9);
            this.fx.burst(p.x - fx * r, p.y - fy * r, '#ff9f1c', 8, 140, 3, 0.35);
            this.dashGhost.set(e.a, this.time);
          }
          if (e.a === me) audio.play('dash');
          break;
        }
        case 'blink':
          this.fx.rift(e.fx, e.fy, 38);
          this.fx.rift(e.tx, e.ty, 38);
          this.fx.portal(e.fx, e.fy, 44, '#b07cff', 0.6);
          this.fx.portal(e.tx, e.ty, 44, '#e2d0ff', 0.6);
          this.fx.beam(e.fx, e.fy, e.tx, e.ty, '#c9a8ff', 0.3);
          this.fx.burst(e.tx, e.ty, '#d4b8ff', 14, 160, 4, 0.5);
          this.fx.burst(e.fx, e.fy, '#7a4dff', 8, 90, 3, 0.4);
          audio.play('blink');
          break;
        case 'shield': {
          const p = this.posOf(g, e.a);
          if (p) {
            this.fx.hex(p.x, p.y, 80, 34, '#ffe066', 0.4);
            this.fx.hex(p.x, p.y, 20, 70, '#fff6c2', 0.35);
            this.fx.burst(p.x, p.y, '#ffe066', 10, 120, 3, 0.4);
          }
          if (e.a === me) audio.play('shield');
          break;
        }
        case 'cloak': {
          const p = this.posOf(g, e.a);
          if (p) {
            this.fx.ripple(p.x, p.y, 20, 90, '#c8ffb0', 0.6);
            this.fx.ripple(p.x, p.y, 10, 60, '#9be564', 0.45);
            this.fx.burst(p.x, p.y, '#9be564', 10, 70, 3, 0.6);
          }
          if (e.a === me) audio.play('cloak');
          break;
        }
        case 'decoy': {
          const d = this.posOf(g, e.a);
          if (d) {
            this.fx.ring(d.x, d.y, 8, 50, '#ffa3a3', 0.3);
            this.fx.goo(d.x, d.y, `hsl(${this.hueOf(g, e.a)} 80% 62%)`, 8);
          }
          if (e.a === me) audio.play('pop');
          break;
        }
        case 'pop':
          this.fx.burst(e.x, e.y, '#ffa3a3', 12, 150, 3, 0.45);
          this.fx.ripple(e.x, e.y, 10, 70, '#ffd0d0', 0.4);
          this.fx.goo(e.x, e.y, '#ff8f8f', 8);
          audio.play('pop');
          break;
        case 'evo': {
          const p = this.posOf(g, e.a);
          const col = MUTATIONS[e.m].color;
          if (p) {
            this.fx.column(p.x, p.y, 70, col);
            this.fx.ring(p.x, p.y, 20, 160, col, 0.7);
            this.fx.burst(p.x, p.y, col, 24, 240, 4, 0.9);
          }
          if (e.a === me) {
            audio.play('evolve');
            this.flash = { a: 0.22, color: '220,255,220' };
            this.onSelfEvent(e);
          }
          break;
        }
        case 'hybrid': {
          const p = this.posOf(g, e.a);
          const col = HYBRIDS[e.h].color;
          if (p) {
            this.fx.column(p.x, p.y, 120, col);
            this.fx.ring(p.x, p.y, 30, 280, '#ffffff', 0.9);
            this.fx.burst(p.x, p.y, '#ffe066', 36, 320, 5, 1.1);
          }
          if (e.a === me) {
            audio.play('hybrid');
            this.shake = 12;
            this.flash = { a: 0.4, color: '255,240,180' };
            this.onSelfEvent(e);
          }
          break;
        }
        case 'kill': {
          const col = `hsl(${this.hueOf(g, e.b)} 85% 58%)`;
          this.fx.goo(e.x, e.y, col, 18);
          this.fx.burst(e.x, e.y, col, 24, 280, 5, 0.9);
          this.fx.ring(e.x, e.y, 10, 140, col, 0.55);
          this.fx.decal(e.x, e.y, 70, col);
          if (e.b === me) {
            audio.play('death');
            this.shake = 16;
            this.flash = { a: 0.5, color: '255,30,60' };
          } else if (e.a === me) {
            audio.play('kill');
            this.fx.banner(e.x, e.y - 40, e.back ? 'ABATE PELAS COSTAS!' : 'ABATE!', '#ffe066', 30);
          }
          this.onSelfEvent(e);
          this.onKill(e);
          break;
        }
        case 'streak': {
          const p = this.posOf(g, e.a);
          const label = e.n >= 8 ? 'LENDÁRIO' : e.n >= 5 ? 'IMPARÁVEL' : e.n >= 3 ? 'EM FÚRIA' : 'DUPLO';
          if (p) {
            this.fx.banner(p.x, p.y - 80, `${label} ×${e.n}`, e.n >= 5 ? '#ff5fd2' : '#ff9f1c', e.a === me ? 34 : 24);
            this.fx.ring(p.x, p.y, 20, 120, '#ff9f1c', 0.45);
          }
          if (e.a === me) {
            audio.play('streak');
            this.onSelfEvent(e);
          }
          break;
        }
        case 'rain': {
          for (let i = 0; i < (this.hq ? 22 : 10); i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * e.r;
            this.fx.meteor(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, Math.random() * 0.6, i % 3 ? '#ffd23f' : '#9dff7a');
          }
          this.fx.ring(e.x, e.y, 20, e.r * 1.2, '#ffd23f', 0.9);
          if (g.me && Math.hypot(e.x - g.myRenderPos().x, e.y - g.myRenderPos().y) < 1400) {
            audio.play('meteor');
            this.shake = Math.min(10, this.shake + 4);
          }
          break;
        }
        case 'superSpawn':
          this.fx.column(e.x, e.y, 60, '#ffd23f');
          this.fx.ring(e.x, e.y, 10, 120, '#ffe066', 0.6);
          audio.play('golden');
          break;
        case 'acid':
          break;
      }
    }
  }

  private trailClock = new Map<number, number>();
  /** Rastro comprado na loja (só visual), com frequência limitada pela qualidade. */
  private cosmeticTrail(id: number, kind: string, x: number, y: number, r: number, dt: number) {
    const t = (this.trailClock.get(id) ?? 0) + dt;
    const every = this.hq ? 0.05 : 0.12;
    if (t < every) {
      this.trailClock.set(id, t);
      return;
    }
    this.trailClock.set(id, 0);
    const jx = (Math.random() - 0.5) * r * 0.5;
    const jy = (Math.random() - 0.5) * r * 0.5;
    switch (kind) {
      case 'rastro.fogo':
        this.fx.trail(x + jx, y + jy, Math.random() < 0.5 ? '#ff7a1a' : '#ffcf33', r * 0.45);
        break;
      case 'rastro.arcoiris':
        this.fx.trail(x + jx * 0.4, y + jy * 0.4, `hsl(${Math.round(this.time * 360) % 360} 100% 60%)`, r * 0.4);
        break;
      case 'rastro.bolhas':
        this.fx.rise(x + jx, y + jy, '#bff3ff', r * 0.14, 0.8);
        break;
      case 'rastro.estrelas':
        this.fx.trail(x + jx, y + jy, '#ffe066', r * 0.22);
        if (Math.random() < 0.3) this.fx.sparks(x, y, jx, jy, '#fff6c2', 2);
        break;
      case 'rastro.raios':
        if (Math.random() < 0.5) this.fx.bolt(x, y, x + jx * 2.5, y + jy * 2.5, '#9af4ff', 0.18);
        break;
    }
  }

  /** Choque ao entrar numa zona energizada: raio do nó mais próximo até a criatura. */
  private zoneShock(g: ClientGame, id: number, x: number, y: number, r: number, audio: Audio) {
    let best: [number, number, number, number] | null = null;
    let bd = Infinity;
    for (const [, zx, zy, zr] of g.zones) {
      const d = Math.hypot(zx - x, zy - y);
      if (d < bd) {
        bd = d;
        best = [zx, zy, zr, d];
      }
    }
    if (!best) return;
    const [zx, zy] = best;
    this.fx.bolt(zx, zy, x, y, '#c8f8ff', 0.32);
    const a = Math.random() * Math.PI * 2;
    this.fx.bolt(x + Math.cos(a) * r * 3, y + Math.sin(a) * r * 3, x, y, '#7ff0ff', 0.25);
    this.fx.sparks(x, y, Math.random() - 0.5, -1, '#c8f8ff', 10);
    this.fx.ring(x, y, r, r * 2.6, '#7ff0ff', 0.35);
    if (id === g.myId) {
      audio.play('zap');
      this.shake = Math.min(10, this.shake + 6);
      this.flash = { a: 0.18, color: '150,240,255' };
      this.onZoneShock();
    }
  }

  /* -------------------------------------------------------------- */
  /* quadro                                                           */
  /* -------------------------------------------------------------- */

  private beginWorld(sx: number, sy: number) {
    const s = this.cam.scale;
    this.ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.w / 2 - this.cam.x * s + sx), this.dpr * (this.h / 2 - this.cam.y * s + sy));
  }

  /**
   * Zoom que se adapta ao formato da tela: o lado menor sempre mostra ~760 unidades (+ o tamanho da criatura)
   * e o lado maior nunca passa do raio de visão do servidor, para não aparecer área vazia em telas largas.
   */
  zoomFor(r: number) {
    const short = Math.min(this.w, this.h);
    const long = Math.max(this.w, this.h);
    return Math.max(short / (760 + r * 3), long / 2200);
  }

  private viewRect() {
    const s = this.cam.scale;
    return {
      x0: this.cam.x - this.w / 2 / s - 60,
      y0: this.cam.y - this.h / 2 / s - 60,
      x1: this.cam.x + this.w / 2 / s + 60,
      y1: this.cam.y + this.h / 2 / s + 60,
    };
  }

  /** Fundo animado da tela de título. */
  backdrop(dt: number) {
    this.time += dt;
    this.govern(dt);
    this.cam.scale = this.zoomFor(30);
    this.cam.x = 1600 + Math.cos(this.time * 0.05) * 700;
    this.cam.y = 1600 + Math.sin(this.time * 0.04) * 600;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#04060d';
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawDeep(ctx);
    this.beginWorld(0, 0);
    this.drawArena(ctx, ARENA, ARENA, this.viewRect());
    this.drawMotes(ctx, dt);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, this.w, this.h);
  }

  frame(g: ClientGame, dt: number, audio: Audio) {
    this.time += dt;
    this.govern(dt);
    const ctx = this.ctx;
    const me = g.me;
    const views = g.remoteViews();
    this.lastViews.clear();
    for (const v of views) this.lastViews.set(v.id, v);

    this.handleEvents(g, g.takeEvents(), audio);
    this.fx.update(dt, (id) => this.posOf(g, id));

    const mp = g.myRenderPos();
    const myR = me?.r ?? 22;
    const target = this.zoomFor(myR);
    this.cam.scale += (target - this.cam.scale) * Math.min(1, dt * 2);
    const look = me?.alive ? 0.18 : 0;
    this.cam.lx += (g.body.vx * look - this.cam.lx) * Math.min(1, dt * 3);
    this.cam.ly += (g.body.vy * look - this.cam.ly) * Math.min(1, dt * 3);
    if (me) {
      const k = me.alive ? 1 : Math.min(1, dt * 2);
      this.cam.x += (mp.x + this.cam.lx - this.cam.x) * k;
      this.cam.y += (mp.y + this.cam.ly - this.cam.y) * k;
    }
    this.shake = Math.max(0, this.shake - dt * 32);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;

    if (this.overlay) {
      this.overlayLogic(g, dt, audio, views, mp);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      this.screenLayer(g, dt, mp);
      return;
    }

    if (this.hq) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#04060d';
      ctx.fillRect(0, 0, this.w, this.h);
      this.drawDeep(ctx);
    }
    this.beginWorld(sx, sy);
    const s = this.cam.scale;
    const view = this.viewRect();
    const inView = (x: number, y: number, r = 0) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;
    const W = g.welcome?.arena.w ?? ARENA;
    const H = g.welcome?.arena.h ?? ARENA;

    this.drawArena(ctx, W, H, view);
    this.fx.drawDecals(ctx);
    for (const [x, y, r] of g.hazards) if (inView(x, y, r * 1.7)) this.drawAcid(ctx, x, y, r, dt);
    for (const [id, x, y, r, life] of g.zones) if (inView(x, y, r * 1.5)) this.drawZone(ctx, id, x, y, r, life, s, dt);

    for (const [kind, x, y, secs] of g.worldMarks) if (kind === 0 && inView(x, y, 260)) this.drawRainTarget(ctx, x, y, secs);

    // biomassa (sprites com halo embutido)
    const now = performance.now();
    const k12 = Math.min(1, dt * 12);
    for (const p of g.pellets.values()) {
      if (p.x !== p.tx || p.y !== p.ty) {
        p.x += (p.tx - p.x) * k12;
        p.y += (p.ty - p.y) * k12;
      }
      if (!inView(p.x, p.y, 14)) continue;
      const age = now - p.born < 280 ? (now - p.born) / 280 : 1;
      const pop = age < 1 ? age * (1 + Math.sin(age * Math.PI) * 0.4) : 1;
      const bob = Math.sin(this.time * 3 + p.id) * 1.6;
      if (p.kind === 3) {
        this.drawGolden(ctx, p.x, p.y + bob, pop, dt);
        continue;
      }
      const base = p.kind === 1 ? 11 : p.kind === 2 ? 7 + Math.min(6, p.v) : 7;
      const r = base * pop;
      ctx.drawImage(pelletSprite(p.kind), p.x - r * 2.2, p.y + bob - r * 2.2, r * 4.4, r * 4.4);
    }

    const res = s * this.dpr;

    // iscas
    for (const d of g.decoys.values()) {
      const meta = g.meta.get(d.owner);
      const sets = this.sets(g, d.owner);
      const ownerR = this.lastViews.get(d.owner)?.r ?? (d.owner === g.myId ? myR : 26);
      const lvl = d.owner === g.myId ? me?.lv ?? 0 : this.lastViews.get(d.owner)?.lv ?? 0;
      drawCreature(ctx, { x: d.x, y: d.y, r: ownerR, hue: meta?.hue ?? 0, fx: d.fx, fy: d.fy, vx: d.fx * 200, vy: d.fy * 200, muts: sets.m, hyb: sets.h, flags: 0, alpha: 0.92, seed: d.owner, level: lvl, look: meta?.look }, this.time, this.hq, res);
      this.label(ctx, d.x, d.y, ownerR, meta?.name ?? '?', lvl, s, -1, false, meta?.bot ?? false);
    }

    const list: { id: number; x: number; y: number; r: number; flags: number; fx: number; fy: number; vx: number; vy: number; hp: number; lv: number; self: boolean }[] = views.map((v) => ({ ...v, self: false }));
    if (me && me.alive) list.push({ id: me.id, x: mp.x, y: mp.y, r: me.r, flags: me.flags, fx: 0, fy: 0, vx: g.body.vx, vy: g.body.vy, hp: Math.round((me.hp / me.mhp) * 100), lv: me.lv, self: true });
    list.sort((a, b) => a.r - b.r);

    this.trailT += dt;
    const emitTrail = this.trailT > (this.hq ? 0.04 : 0.1);
    if (emitTrail) this.trailT = 0;

    const leaderId = g.phase === 'playing' && (g.leaderboard[0]?.[2] ?? 0) > 0 ? g.leaderboard[0]![0] : -99;
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      // choque ao entrar na zona energizada
      const inZone = (p.flags & FLAG.inZone) !== 0;
      const was = this.wasInZone.get(p.id);
      if (inZone && was === false && inView(p.x, p.y, 200)) this.zoneShock(g, p.id, p.x, p.y, p.r, audio);
      this.wasInZone.set(p.id, inZone);

      if (!inView(p.x, p.y, p.r * 2.5)) continue;
      const meta = g.meta.get(p.id);
      const sets = this.sets(g, p.id);
      let fx = p.fx;
      let fy = p.fy;
      if (p.self) {
        const sp = Math.hypot(p.vx, p.vy);
        const prev = this.lastViews.get(-1);
        if (sp > 20) {
          fx = p.vx / sp;
          fy = p.vy / sp;
        } else if (prev) {
          fx = prev.fx;
          fy = prev.fy;
        } else fx = 1;
        this.lastViews.set(-1, { ...p, fx, fy });
      }
      if (p.self) this.drawBiteCone(ctx, p.x, p.y, p.r, fx, fy);
      const cloaked = (p.flags & FLAG.cloak) !== 0;
      if (emitTrail && !cloaked && p.flags & FLAG.dashing) {
        this.fx.trail(p.x - fx * p.r, p.y - fy * p.r, '#ffb547', p.r * 0.7);
        this.fx.ghost(p.x, p.y, p.r, Math.atan2(fy, fx), `hsl(${meta?.hue ?? 30} 90% 62%)`);
        if (this.hq) this.fx.speedLines(p.x, p.y, fx, fy, p.r, '#ffe2b8', 2);
      }
      const tr = meta?.look?.rastro;
      if (tr && tr !== 'rastro.nenhum' && !cloaked && Math.hypot(p.vx, p.vy) > 60) this.cosmeticTrail(p.id, tr, p.x - fx * p.r * 0.95, p.y - fy * p.r * 0.95, p.r, dt);
      let alpha = 1;
      if (cloaked) alpha = p.self ? 0.45 : 0.18;
      if (p.flags & FLAG.protected) alpha *= 0.6 + 0.4 * Math.abs(Math.sin(this.time * 10));
      if (p.flags & FLAG.disconnected) alpha *= 0.5;
      const bt = this.time - (this.biteAt.get(p.id) ?? -9);
      const bite = bt < 0.25 ? Math.sin((bt / 0.25) * Math.PI) : 0;
      drawCreature(ctx, { x: p.x, y: p.y, r: p.r, hue: meta?.hue ?? 200, fx, fy, vx: p.vx, vy: p.vy, muts: sets.m, hyb: sets.h, flags: p.flags, alpha, seed: p.id, level: p.lv, bite, look: meta?.look, hp: p.hp }, this.time, this.hq, res);
      if (!(cloaked && !p.self)) {
        this.label(ctx, p.x, p.y, p.r, meta?.name ?? '', p.lv, s, p.self ? -1 : p.hp, p.self, meta?.bot ?? false, (p.flags & FLAG.disconnected) !== 0);
        if (p.id === leaderId) this.drawCrown(ctx, p.x, p.y - p.r * 1.7 - 30 / s, s);
      }
    }
    for (const id of this.wasInZone.keys()) if (!seen.has(id)) this.wasInZone.delete(id);

    this.fx.draw(ctx);
    this.drawMotes(ctx, dt);

    // camada de tela
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.screenLayer(g, dt, mp);
  }

  /** Direção para onde o próprio jogador olha (usada também pelo modo 3D). */
  selfFacing: { x: number; y: number } = { x: 1, y: 0 };

  /** Modo 3D: só a lógica do quadro (biomassa suavizada, choque das zonas, direção do jogador). */
  private overlayLogic(g: ClientGame, dt: number, audio: Audio, views: RemoteView[], mp: { x: number; y: number }) {
    const k12 = Math.min(1, dt * 12);
    for (const p of g.pellets.values()) {
      if (p.x !== p.tx || p.y !== p.ty) {
        p.x += (p.tx - p.x) * k12;
        p.y += (p.ty - p.y) * k12;
      }
    }
    const me = g.me;
    const list = views.map((v) => ({ id: v.id, x: v.x, y: v.y, r: v.r, flags: v.flags }));
    if (me?.alive) {
      list.push({ id: me.id, x: mp.x, y: mp.y, r: me.r, flags: me.flags });
      const sp = Math.hypot(g.body.vx, g.body.vy);
      if (sp > 20) this.selfFacing = { x: g.body.vx / sp, y: g.body.vy / sp };
    }
    for (const p of list) {
      const inZone = (p.flags & FLAG.inZone) !== 0;
      const was = this.wasInZone.get(p.id);
      if (inZone && was === false && Math.hypot(p.x - this.cam.x, p.y - this.cam.y) < 1400) this.zoneShock(g, p.id, p.x, p.y, p.r, audio);
      this.wasInZone.set(p.id, inZone);
    }
  }

  get groundCanvas() {
    return this.ground;
  }
  get shakeAmount() {
    return this.shake;
  }
  get clock() {
    return this.time;
  }

  private screenLayer(g: ClientGame, dt: number, mp: { x: number; y: number }) {
    const ctx = this.ctx;
    const me = g.me;
    const W = g.welcome?.arena.w ?? ARENA;
    const H = g.welcome?.arena.h ?? ARENA;
    if (this.hq && this.vignette) ctx.drawImage(this.vignette, 0, 0, this.w, this.h);
    if (me?.alive && me.hp / me.mhp < 0.3 && this.redVignette) {
      ctx.globalAlpha = 0.45 + 0.3 * Math.sin(this.time * 6);
      ctx.drawImage(this.redVignette, 0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    this.drawHitIndicators(ctx, dt);
    if (me?.alive) this.drawPointers(ctx, g, mp);
    if (this.flash.a > 0.01) {
      ctx.fillStyle = `rgba(${this.flash.color},${this.flash.a})`;
      ctx.fillRect(0, 0, this.w, this.h);
      this.flash.a *= Math.pow(0.02, dt);
    }
    this.minimapT -= dt;
    if (this.minimapT <= 0) {
      this.minimapT = 0.12;
      this.drawMinimap(g, W, H, mp);
    }
  }

  /* -------------------------------------------------------------- */
  /* mapa                                                             */
  /* -------------------------------------------------------------- */

  private drawDeep(ctx: CanvasRenderingContext2D) {
    if (!this.hq) return;
    const s = this.cam.scale * 0.55;
    const T = 2400;
    const ox = -this.cam.x * s * 0.6;
    const oy = -this.cam.y * s * 0.6;
    ctx.strokeStyle = 'rgba(80,150,255,0.07)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const d of this.deep) {
      const sx = ((((d.x * s + ox) % (T * s)) + T * s) % (T * s)) - T * s * 0.25;
      const sy = ((((d.y * s + oy) % (T * s)) + T * s) % (T * s)) - T * s * 0.25;
      const r = d.r * s;
      if (sx < -r || sy < -r || sx > this.w + r || sy > this.h + r) continue;
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  private drawArena(ctx: CanvasRenderingContext2D, W: number, H: number, v: { x0: number; y0: number; x1: number; y1: number }) {
    // fora da arena (só quando a visão passa do limite)
    if (v.x0 < 0 || v.y0 < 0 || v.x1 > W || v.y1 > H) {
      ctx.fillStyle = '#03040a';
      ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    }
    // chão pré-renderizado: copia só o recorte visível
    if (this.ground) {
      const x0 = Math.max(0, v.x0);
      const y0 = Math.max(0, v.y0);
      const x1 = Math.min(W, v.x1);
      const y1 = Math.min(H, v.y1);
      if (x1 > x0 && y1 > y0) {
        const k = this.ground.width / W;
        ctx.drawImage(this.ground, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, x0, y0, x1 - x0, y1 - y0);
      }
    }
    // membrana da borda
    const edges: [number, number, number, number, number, number][] = [
      [0, 0, W, 0, 0, -1],
      [W, 0, W, H, 1, 0],
      [W, H, 0, H, 0, 1],
      [0, H, 0, 0, -1, 0],
    ];
    const visible = edges.filter(([ax, ay, bx, by]) => Math.max(ax, bx) > v.x0 && Math.min(ax, bx) < v.x1 && Math.max(ay, by) > v.y0 && Math.min(ay, by) < v.y1);
    if (!visible.length) return;
    ctx.beginPath();
    for (const [ax, ay, bx, by, nx, ny] of visible) {
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.ceil(len / 70);
      let started = false;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        if (px < v.x0 - 80 || px > v.x1 + 80 || py < v.y0 - 80 || py > v.y1 + 80) {
          started = false;
          continue;
        }
        const o = Math.sin(t * 40 + this.time * 2) * 6 + Math.sin(t * 13 - this.time) * 4;
        if (!started) {
          ctx.moveTo(px + nx * o, py + ny * o);
          started = true;
        } else ctx.lineTo(px + nx * o, py + ny * o);
      }
    }
    ctx.lineJoin = 'round';
    if (this.hq) {
      ctx.strokeStyle = 'rgba(255,70,140,0.22)';
      ctx.lineWidth = 30;
      ctx.stroke();
    }
    ctx.strokeStyle = '#ff4f8f';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,205,228,0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  private drawAcid(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dt: number) {
    const a = this.acidSprite(x, y, r);
    const m = r + a.pad;
    const pulse = 1 + Math.sin(this.time * 1.4 + x) * 0.012;
    ctx.drawImage(a.c, x - m * pulse, y - m * pulse, m * 2 * pulse, m * 2 * pulse);
    // bolhas
    const n = this.hq ? 8 : 4;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < n; i++) {
      const b = a.bubbles[i]!;
      const k = (this.time * b.sp + b.ph) % 1;
      const bx = x + Math.cos(b.a) * r * b.d;
      const by = y + Math.sin(b.a) * r * b.d;
      if (k < 0.85) {
        const br = b.s * (k / 0.85);
        ctx.fillStyle = 'rgba(235,255,160,0.35)';
        ctx.strokeStyle = 'rgba(245,255,200,0.85)';
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        const pk = (k - 0.85) / 0.15;
        ctx.strokeStyle = `rgba(245,255,200,${1 - pk})`;
        ctx.beginPath();
        ctx.arc(bx, by, b.s * (1 + pk), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.hq && Math.random() < dt * 2.5) {
      const an = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.7;
      this.fx.rise(x + Math.cos(an) * d, y + Math.sin(an) * d, '#b8ff3a', 5, 1.5);
    }
  }

  private drawZone(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, r: number, life: number, s: number, dt: number) {
    const t = this.time;
    const unstable = life < 22;
    const flick = unstable ? 0.6 + 0.4 * Math.abs(Math.sin(t * 14)) : 1;
    const base = this.zoneSprite(r);
    const m = r * 1.45;
    ctx.globalAlpha = (0.85 + 0.15 * Math.sin(t * 2.2)) * flick;
    ctx.drawImage(base, x - m, y - m, m * 2, m * 2);
    ctx.globalAlpha = 1;
    // ondas concêntricas
    ctx.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.45 + i / 2) % 1;
      ctx.strokeStyle = `rgba(150,240,255,${(1 - k) * 0.5 * flick})`;
      ctx.beginPath();
      ctx.arc(x, y, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // anel tracejado girando
    ctx.strokeStyle = `rgba(120,235,255,${0.85 * flick})`;
    ctx.lineWidth = 3.5;
    ctx.setLineDash([26, 16]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // nós e raios entre eles
    const nodes = 6;
    const rot = t * 0.5;
    const nodePts: number[] = [];
    for (let i = 0; i < nodes; i++) {
      const an = rot + (i / nodes) * Math.PI * 2;
      nodePts.push(x + Math.cos(an) * r, y + Math.sin(an) * r);
    }
    let arcs = this.zoneArcs.get(id);
    if (!arcs || t - arcs.t > 0.09) {
      const pts: number[][] = [];
      for (let i = 0; i < nodes; i++) {
        if (Math.random() > (this.hq ? 0.5 : 0.25)) continue;
        const ax = nodePts[i * 2]!;
        const ay = nodePts[i * 2 + 1]!;
        const toCenter = Math.random() < 0.5;
        const bx = toCenter ? x : nodePts[((i + 1) % nodes) * 2]!;
        const by = toCenter ? y : nodePts[((i + 1) % nodes) * 2 + 1]!;
        const seg = [ax, ay];
        for (let k = 1; k < 6; k++) {
          const f = k / 6;
          seg.push(ax + (bx - ax) * f + (Math.random() - 0.5) * 28, ay + (by - ay) * f + (Math.random() - 0.5) * 28);
        }
        seg.push(bx, by);
        pts.push(seg);
      }
      arcs = { t, pts };
      this.zoneArcs.set(id, arcs);
    }
    ctx.strokeStyle = `rgba(205,250,255,${0.9 * flick})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const seg of arcs.pts) {
      ctx.moveTo(seg[0]!, seg[1]!);
      for (let i = 2; i < seg.length; i += 2) ctx.lineTo(seg[i]!, seg[i + 1]!);
    }
    ctx.stroke();
    ctx.fillStyle = '#e8fdff';
    ctx.beginPath();
    for (let i = 0; i < nodes; i++) {
      ctx.moveTo(nodePts[i * 2]! + 6, nodePts[i * 2 + 1]!);
      ctx.arc(nodePts[i * 2]!, nodePts[i * 2 + 1]!, 6, 0, Math.PI * 2);
    }
    ctx.fill();
    // núcleo
    const cr = 46 + Math.sin(t * 3) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.8);
    ctx.drawImage(this.core(), -cr, -cr, cr * 2, cr * 2);
    ctx.restore();
    if (Math.random() < dt * (this.hq ? 7 : 2)) {
      const an = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.9;
      this.fx.rise(x + Math.cos(an) * d, y + Math.sin(an) * d, '#7ff0ff', 4, 1.3);
    }
    // tempo de vida + rótulo
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * flick})`;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r + 14, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * life) / 100);
    ctx.stroke();
    ctx.lineCap = 'butt';
    const lab = this.labelSprite(unstable ? '⚡ ZONA INSTÁVEL' : '⚡ ZONA DE ENERGIA', -1, unstable ? '#ffe066' : '#b4faff', '#5ce1ff');
    const lw = lab.w / this.dpr / s;
    const lh = lab.h / this.dpr / s;
    ctx.drawImage(lab.c, x - lw / 2, y - r - 22 / s - lh / 2, lw, lh);
  }

  private drawMotes(ctx: CanvasRenderingContext2D, dt: number) {
    if (!this.hq || !this.motes.length) return;
    const span = 2000;
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const wx = this.cam.x + ((((m.x - this.cam.x) % span) + span * 1.5) % span) - span / 2;
      const wy = this.cam.y + ((((m.y - this.cam.y) % span) + span * 1.5) % span) - span / 2;
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(this.time * 1.5 + m.ph);
      const gs = m.s * 4;
      ctx.drawImage(glow(m.c, 32), wx - gs, wy - gs, gs * 2, gs * 2);
    }
    ctx.globalAlpha = 1;
  }

  /** Cone sutil à frente do jogador: mostra onde a mordida alcança. */
  private drawBiteCone(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fx: number, fy: number) {
    const a = Math.atan2(fy, fx);
    const half = Math.acos(0.17);
    const R = r * 2 + 34;
    const g = ctx.createRadialGradient(x, y, r * 0.9, x, y, R);
    g.addColorStop(0, 'rgba(255,240,200,0.13)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, R, a - half, a + half);
    ctx.closePath();
    ctx.fill();
  }

  /** Célula dourada: gira, pulsa e solta brilhos. */
  private goldT = 0;
  private drawGolden(ctx: CanvasRenderingContext2D, x: number, y: number, pop: number, dt: number) {
    const pulse = 1 + Math.sin(this.time * 5) * 0.08;
    const r = 17 * pop * pulse;
    ctx.globalAlpha = 0.5 + 0.25 * Math.sin(this.time * 3);
    const gr = r * 5;
    ctx.drawImage(glow('#ffd23f'), x - gr, y - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    // raios girando
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.time * 0.8);
    ctx.fillStyle = 'rgba(255,230,120,0.22)';
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 3.2, -r * 0.35);
      ctx.lineTo(r * 3.2, r * 0.35);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.drawImage(pelletSprite(3), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
    this.goldT += dt;
    if (this.goldT > (this.hq ? 0.12 : 0.35)) {
      this.goldT = 0;
      this.fx.rise(x + (Math.random() - 0.5) * r * 2, y + (Math.random() - 0.5) * r, '#ffe066', 3, 1);
    }
  }

  /** Alvo da chuva de biomassa: anel pulsante com contagem regressiva. */
  private drawRainTarget(ctx: CanvasRenderingContext2D, x: number, y: number, secs: number) {
    const R = 210;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    ctx.fillStyle = `rgba(255,210,63,${0.06 + pulse * 0.06})`;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,210,63,${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 5;
    ctx.setLineDash([22, 16]);
    ctx.lineDashOffset = -this.time * 40;
    ctx.stroke();
    ctx.setLineDash([]);
    // anel que se fecha até a queda
    const k = Math.max(0, Math.min(1, secs / 6));
    ctx.strokeStyle = 'rgba(255,240,170,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, R * (0.15 + 0.85 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `64px 'Lilita One', 'Fredoka', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(20,12,0,0.75)';
    const t = `☄ ${Math.ceil(secs)}`;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(t, x, y);
    ctx.textBaseline = 'alphabetic';
  }

  /** Coroa sobre o líder do placar. */
  private drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    const w = 15 / s;
    const h = 11 / s;
    const bob = Math.sin(this.time * 3) * 2 / s;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.globalAlpha = 0.6;
    const gr = w * 2.2;
    ctx.drawImage(glow('#ffd23f'), -gr, -gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(-w, h * 0.6);
    ctx.lineTo(-w, -h * 0.4);
    ctx.lineTo(-w * 0.5, h * 0.05);
    ctx.lineTo(0, -h * 0.75);
    ctx.lineTo(w * 0.5, h * 0.05);
    ctx.lineTo(w, -h * 0.4);
    ctx.lineTo(w, h * 0.6);
    ctx.closePath();
    const gd = ctx.createLinearGradient(0, -h, 0, h);
    gd.addColorStop(0, '#fff3a8');
    gd.addColorStop(1, '#e09a00');
    ctx.fillStyle = gd;
    ctx.fill();
    ctx.lineWidth = 2 / s;
    ctx.strokeStyle = '#7a4a00';
    ctx.stroke();
    ctx.fillStyle = '#ff4d8d';
    ctx.beginPath();
    ctx.arc(0, h * 0.25, 2.4 / s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Marcas vermelhas na borda da tela apontando de onde veio o dano. */
  private drawHitIndicators(ctx: CanvasRenderingContext2D, dt: number) {
    if (!this.hitFrom.length) return;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.36;
    for (const h of this.hitFrom) {
      h.t -= dt * 1.1;
      if (h.t <= 0) continue;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(h.a);
      ctx.globalAlpha = Math.min(1, h.t * 1.6);
      const g = ctx.createRadialGradient(R, 0, 4, R, 0, 70);
      g.addColorStop(0, h.back ? 'rgba(255,160,40,0.9)' : 'rgba(255,50,70,0.85)');
      g.addColorStop(1, 'rgba(255,40,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R + 40, -0.42, 0.42);
      ctx.arc(0, 0, R - 26, 0.42, -0.42, true);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = h.back ? '#ffb347' : '#ff4d6d';
      ctx.beginPath();
      ctx.moveTo(R + 34, 0);
      ctx.lineTo(R + 12, -13);
      ctx.lineTo(R + 12, 13);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    this.hitFrom = this.hitFrom.filter((h) => h.t > 0);
  }

  /** Setas na borda da tela para zonas de energia, chuva de biomassa e célula dourada fora de vista. */
  private drawPointers(ctx: CanvasRenderingContext2D, g: ClientGame, mp: { x: number; y: number }) {
    const s = this.cam.scale;
    const hw = this.w / 2;
    const hh = this.h / 2;
    const items: { x: number; y: number; color: string; icon: string; r: number }[] = [];
    for (const [, x, y, r] of g.zones) items.push({ x, y, color: '#5ce1ff', icon: '⚡', r });
    for (const [kind, x, y] of g.worldMarks) items.push({ x, y, color: '#ffd23f', icon: kind === 0 ? '☄' : '✨', r: kind === 0 ? 200 : 20 });
    // fica longe do HUD: placar/vida em cima, poderes embaixo
    const hud = viewport.size.hud || 1;
    const padX = 40;
    const padTop = Math.min(hh * 0.6, (this.h > this.w ? 300 : 130) * hud);
    const padBot = Math.min(hh * 0.6, (this.h > this.w ? 260 : 120) * hud);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed: [number, number][] = [];
    for (const it of items) {
      const sx = (it.x - this.cam.x) * s;
      const sy = (it.y - this.cam.y) * s;
      const rr = it.r * s;
      if (Math.abs(sx) < hw + rr * 0.3 && Math.abs(sy) < hh + rr * 0.3) continue; // já aparece na tela
      const a = Math.atan2(sy, sx);
      const ex = Math.cos(a);
      const ey = Math.sin(a);
      const lim = ey < 0 ? hh - padTop : hh - padBot;
      const t = Math.min((hw - padX) / Math.max(1e-6, Math.abs(ex)), lim / Math.max(1e-6, Math.abs(ey)));
      let px = hw + ex * t;
      let py = hh + ey * t;
      // não empilha setas: desliza ao longo da borda
      for (let tries = 0; tries < 4 && placed.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < 56); tries++) {
        if (Math.abs(Math.abs(px - hw) - (hw - padX)) < 1) py += py > hh ? -58 : 58;
        else px += px > hw ? -58 : 58;
      }
      placed.push([px, py]);
      const dist = Math.hypot(it.x - mp.x, it.y - mp.y);
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 5);
      ctx.save();
      ctx.translate(px, py);
      ctx.globalAlpha = 0.9 * pulse;
      ctx.fillStyle = 'rgba(5,10,20,0.6)';
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.rotate(a);
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.moveTo(27, 0);
      ctx.lineTo(18, -7);
      ctx.lineTo(18, 7);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-a);
      ctx.globalAlpha = 1;
      ctx.font = `15px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(it.icon, 0, 1);
      ctx.font = `600 11px 'Fredoka', system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const dtxt = `${Math.round(dist / 100) * 10} m`;
      const ty = ey > 0.5 ? -29 : 31;
      ctx.strokeText(dtxt, 0, ty);
      ctx.fillStyle = it.color;
      ctx.fillText(dtxt, 0, ty);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
  }

  private label(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, name: string, lv: number, s: number, hp: number, self: boolean, bot: boolean, dc = false) {
    const txt = `${name}${bot ? ' · BOT' : ''}${dc ? ' (reconectando)' : ''}`;
    const l = this.labelSprite(txt, lv, self ? '#ffe066' : bot ? '#c9d6f2' : '#ffffff', self ? '#ffe066' : '#7dff6a');
    const lw = l.w / this.dpr / s;
    const lh = l.h / this.dpr / s;
    ctx.drawImage(l.c, x - lw / 2, y - r * 1.7 - 6 / s - lh / 2, lw, lh);
    if (hp >= 0 && hp < 100) {
      const w = Math.max(r * 1.6, 42 / s);
      const hh = 6 / s;
      const by2 = y + r * 1.5;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2 - 1 / s, by2 - 1 / s, w + 2 / s, hh + 2 / s);
      ctx.fillStyle = hp > 50 ? '#7dff6a' : hp > 25 ? '#ffd23f' : '#ff4d6d';
      ctx.fillRect(x - w / 2, by2, (w * hp) / 100, hh);
    }
  }

  private drawMinimap(g: ClientGame, W: number, H: number, mp: { x: number; y: number }) {
    const c = this.minimap;
    const size = c.clientWidth || 100;
    if (!size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(size * dpr)) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    const m = c.getContext('2d');
    if (!m) return;
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.clearRect(0, 0, size, size);
    if (this.ground) {
      m.globalAlpha = 0.85;
      m.drawImage(this.ground, 0, 0, size, size);
      m.globalAlpha = 1;
    }
    const k = size / Math.max(W, H);
    m.fillStyle = 'rgba(170,255,40,0.6)';
    for (const [x, y, r] of g.hazards) {
      m.beginPath();
      m.arc(x * k, y * k, Math.max(2, r * k), 0, Math.PI * 2);
      m.fill();
    }
    m.fillStyle = 'rgba(80,230,255,0.3)';
    m.strokeStyle = 'rgba(140,245,255,0.95)';
    m.lineWidth = 1.5;
    for (const [, x, y, r] of g.zones) {
      m.beginPath();
      m.arc(x * k, y * k, Math.max(3, r * k), 0, Math.PI * 2);
      m.fill();
      m.stroke();
    }
    m.fillStyle = '#ff5f8f';
    for (const [x, y] of g.minimap) {
      m.beginPath();
      m.arc(x * k, y * k, 2.5, 0, Math.PI * 2);
      m.fill();
    }
    const blink = Math.sin(this.time * 8) > 0;
    for (const [kind, x, y] of g.worldMarks) {
      if (kind === 0) {
        m.strokeStyle = blink ? '#ffd23f' : 'rgba(255,210,63,0.4)';
        m.lineWidth = 2;
        m.beginPath();
        m.arc(x * k, y * k, 7, 0, Math.PI * 2);
        m.stroke();
      } else {
        m.fillStyle = '#ffd23f';
        m.beginPath();
        m.arc(x * k, y * k, blink ? 4.5 : 3.5, 0, Math.PI * 2);
        m.fill();
      }
    }
    m.fillStyle = '#ffe066';
    m.strokeStyle = '#000';
    m.lineWidth = 1;
    m.beginPath();
    m.arc(mp.x * k, mp.y * k, 3.5, 0, Math.PI * 2);
    m.fill();
    m.stroke();
    m.strokeStyle = 'rgba(255,255,255,0.4)';
    const vw = (this.w / this.cam.scale) * k;
    const vh = (this.h / this.cam.scale) * k;
    m.strokeRect(this.cam.x * k - vw / 2, this.cam.y * k - vh / 2, vw, vh);
  }
}
