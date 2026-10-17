import { glow, withAlpha } from './sprites.js';

/**
 * Efeitos visuais: partículas com brilho aditivo, ondas de choque, rastros,
 * números de dano e manchas no chão. Tudo com teto de quantidade por qualidade.
 */
type Kind = 'dot' | 'glow' | 'ring' | 'text' | 'rift' | 'seek' | 'spark' | 'rise' | 'column' | 'bolt';

interface P {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  text?: string;
  r2?: number;
  target?: number;
  pts?: number[];
  drag: number;
  grav: number;
}

interface Decal {
  x: number;
  y: number;
  r: number;
  color: string;
  life: number;
  max: number;
  blobs: [number, number, number][];
}

export class Fx {
  private ps: P[] = [];
  private decals: Decal[] = [];
  cap = 350;
  hq = true;

  clear() {
    this.ps = [];
    this.decals = [];
  }

  private add(p: Omit<P, 'drag' | 'grav'> & { drag?: number; grav?: number }) {
    if (this.ps.length >= this.cap) this.ps.splice(0, 1 + Math.floor(this.cap * 0.05));
    this.ps.push({ drag: 0.92, grav: 0, ...p });
  }

  private n(count: number) {
    return this.hq ? count : Math.max(2, Math.ceil(count / 3));
  }

  /** Explosão de partículas com brilho. */
  burst(x: number, y: number, color: string, count: number, speed = 160, size = 4, life = 0.6) {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.75);
      this.add({ kind: this.hq ? 'glow' : 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.6 + Math.random()), color });
    }
  }

  /** Faíscas direcionais (mordidas). */
  sparks(x: number, y: number, dirX: number, dirY: number, color: string, count = 8) {
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < this.n(count); i++) {
      const a = base + (Math.random() - 0.5) * 1.6;
      const s = 180 + Math.random() * 260;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.28, max: 0.28, size: 2 + Math.random() * 2, color, drag: 0.86 });
    }
  }

  /** Gotas que caem e espirram (gosma). */
  goo(x: number, y: number, color: string, count = 10) {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 200;
      this.add({ kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.55, max: 0.55, size: 3 + Math.random() * 5, color, drag: 0.9, grav: 380 });
    }
  }

  ring(x: number, y: number, from: number, to: number, color: string, life = 0.4) {
    this.add({ kind: 'ring', x, y, vx: 0, vy: 0, life, max: life, size: from, r2: to, color });
  }

  text(x: number, y: number, text: string, color: string, size = 18) {
    this.add({ kind: 'text', x, y, vx: (Math.random() - 0.5) * 40, vy: -90, life: 0.95, max: 0.95, size, color, text, drag: 0.95 });
  }

  rift(x: number, y: number, r: number) {
    this.add({ kind: 'rift', x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: r, color: '#b07cff' });
  }

  seek(x: number, y: number, target: number, color: string) {
    this.add({ kind: 'seek', x, y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.32, max: 0.32, size: 6, color, target });
  }

  /** Partícula que sobe devagar (energia das zonas, vapor do ácido). */
  rise(x: number, y: number, color: string, size = 4, life = 1.4) {
    this.add({ kind: 'rise', x, y, vx: (Math.random() - 0.5) * 14, vy: -30 - Math.random() * 40, life, max: life, size, color, drag: 0.995 });
  }

  /** Rastro (investidas e corpos rápidos). */
  trail(x: number, y: number, color: string, size: number) {
    this.add({ kind: 'glow', x, y, vx: 0, vy: 0, life: 0.3, max: 0.3, size, color, drag: 1 });
  }

  /** Coluna de luz da evolução. */
  column(x: number, y: number, r: number, color: string) {
    this.add({ kind: 'column', x, y, vx: 0, vy: 0, life: 0.9, max: 0.9, size: r, color, drag: 1 });
  }

  /** Raio elétrico entre dois pontos (choque das zonas de energia). */
  bolt(x1: number, y1: number, x2: number, y2: number, color = '#c8f8ff', life = 0.28) {
    const pts: number[] = [x1, y1];
    const n = 7;
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const j = (Math.random() - 0.5) * Math.min(60, len * 0.25);
      pts.push(x1 + (x2 - x1) * f + (nx / len) * j, y1 + (y2 - y1) * f + (ny / len) * j);
    }
    pts.push(x2, y2);
    this.add({ kind: 'bolt', x: x2, y: y2, vx: 0, vy: 0, life, max: life, size: 3, color, pts, drag: 1 });
  }

  /** Mancha no chão que desbota lentamente. */
  decal(x: number, y: number, r: number, color: string, life = 9) {
    if (this.decals.length > (this.hq ? 40 : 15)) this.decals.shift();
    const blobs: [number, number, number][] = [];
    const n = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (0.3 + Math.random() * 0.9);
      blobs.push([Math.cos(a) * d, Math.sin(a) * d, r * (0.18 + Math.random() * 0.3)]);
    }
    this.decals.push({ x, y, r, color, life, max: life, blobs });
  }

  update(dt: number, pos: (id: number) => { x: number; y: number } | null) {
    for (const d of this.decals) d.life -= dt;
    this.decals = this.decals.filter((d) => d.life > 0);
    const out: P[] = [];
    const drag = (k: number) => Math.pow(k, dt * 60);
    for (const p of this.ps) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.kind === 'seek' && p.target !== undefined) {
        const t = pos(p.target);
        if (t) {
          const k = Math.min(1, dt * (6 + (1 - p.life / p.max) * 20));
          p.x += (t.x - p.x) * k;
          p.y += (t.y - p.y) * k;
        }
      } else {
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const f = drag(p.drag);
        p.vx *= f;
        p.vy *= f;
      }
      out.push(p);
    }
    this.ps = out;
  }

  drawDecals(ctx: CanvasRenderingContext2D) {
    for (const d of this.decals) {
      const a = Math.min(1, d.life / d.max * 1.5) * 0.45;
      ctx.fillStyle = withAlpha(d.color, a);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 0.55, 0, Math.PI * 2);
      for (const [bx, by, br] of d.blobs) {
        ctx.moveTo(d.x + bx + br, d.y + by);
        ctx.arc(d.x + bx, d.y + by, br, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    // camada normal
    for (const p of this.ps) {
      if (p.kind === 'glow' || p.kind === 'spark' || p.kind === 'rise' || p.kind === 'column' || p.kind === 'seek') continue;
      const k = p.life / p.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.5));
      switch (p.kind) {
        case 'dot':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'text': {
          const pop = k > 0.85 ? 1 + (k - 0.85) * 4 : 1;
          ctx.font = `700 ${Math.round(p.size * pop)}px 'Lilita One', 'Fredoka', system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeText(p.text ?? '', p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text ?? '', p.x, p.y);
          break;
        }
        case 'rift':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * (1.4 - k * 0.4), p.size * 0.55 * k + 2, (1 - k) * 2.5, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'ring':
          break;
      }
    }
    ctx.globalAlpha = 1;

    // camada aditiva (brilho)
    const prev = ctx.globalCompositeOperation;
    if (this.hq) ctx.globalCompositeOperation = 'lighter';
    for (const p of this.ps) {
      const k = p.life / p.max;
      switch (p.kind) {
        case 'glow':
        case 'seek': {
          const s = p.size * (p.kind === 'seek' ? 2.6 * (0.4 + k * 0.6) : 3 * (0.4 + k * 0.6));
          ctx.globalAlpha = Math.min(1, k * 1.3);
          ctx.drawImage(glow(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'spark':
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
          ctx.stroke();
          break;
        case 'rise': {
          const s = p.size * 2.2;
          ctx.globalAlpha = Math.min(1, k * 2) * 0.8;
          ctx.drawImage(glow(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'ring': {
          const r = p.size + ((p.r2 ?? p.size) - p.size) * (1 - Math.pow(k, 1.6));
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 + 10 * k;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          if (this.hq) {
            ctx.globalAlpha = k * 0.35;
            ctx.lineWidth = 18 * k + 4;
            ctx.stroke();
          }
          break;
        }
        case 'bolt': {
          const pts = p.pts ?? [];
          ctx.globalAlpha = Math.min(1, k * 1.6);
          ctx.strokeStyle = p.color;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const [w, a] of this.hq ? ([[9, 0.25], [3, 1]] as const) : ([[3, 1]] as const)) {
            ctx.globalAlpha = Math.min(1, k * 1.6) * a;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(pts[0]!, pts[1]!);
            for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
            ctx.stroke();
          }
          break;
        }
        case 'column': {
          // feixe de luz suave (halo esticado na vertical)
          const w = p.size * (0.7 + 0.5 * k);
          ctx.globalAlpha = k * 0.75;
          ctx.drawImage(glow(p.color), p.x - w, p.y - 460, w * 2, 520);
          ctx.globalAlpha = k * 0.5;
          ctx.drawImage(glow('#ffffff'), p.x - w * 0.35, p.y - 380, w * 0.7, 420);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
  }
}
