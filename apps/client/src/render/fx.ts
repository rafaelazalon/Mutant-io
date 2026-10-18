import { glow, withAlpha } from './sprites.js';

/**
 * Efeitos visuais: partículas com brilho aditivo, ondas de choque, rastros,
 * números de dano e manchas no chão. Tudo com teto de quantidade por qualidade.
 */
type Kind = 'dot' | 'glow' | 'ring' | 'text' | 'rift' | 'seek' | 'spark' | 'rise' | 'column' | 'bolt' | 'ghost' | 'streak' | 'hex' | 'shard' | 'beam' | 'portal' | 'ripple' | 'meteor' | 'banner';

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
  /** ângulo (fantasmas, estilhaços, portais) */
  ang?: number;
  /** espera antes de aparecer (meteoros escalonados) */
  delay?: number;
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

  /** Imagem residual da investida: silhueta alongada na direção do movimento. */
  ghost(x: number, y: number, r: number, ang: number, color: string) {
    this.add({ kind: 'ghost', x, y, vx: 0, vy: 0, life: 0.32, max: 0.32, size: r, color, ang, drag: 1 });
  }

  /** Linhas de velocidade atrás de quem avança. */
  speedLines(x: number, y: number, dirX: number, dirY: number, r: number, color: string, count = 6) {
    for (let i = 0; i < this.n(count); i++) {
      const off = (Math.random() - 0.5) * r * 2.2;
      const px = x - dirY * off - dirX * r * (0.4 + Math.random());
      const py = y + dirX * off - dirY * r * (0.4 + Math.random());
      this.add({ kind: 'streak', x: px, y: py, vx: -dirX * 260, vy: -dirY * 260, life: 0.22, max: 0.22, size: r * (0.6 + Math.random() * 0.8), color, ang: Math.atan2(dirY, dirX), drag: 0.9 });
    }
  }

  /** Favo hexagonal que se expande (escudo). */
  hex(x: number, y: number, from: number, to: number, color: string, life = 0.45) {
    this.add({ kind: 'hex', x, y, vx: 0, vy: 0, life, max: life, size: from, r2: to, color, ang: Math.random() * Math.PI, drag: 1 });
  }

  /** Estilhaços (escudo rachando, impacto forte). */
  shards(x: number, y: number, color: string, count = 8, speed = 220) {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.add({ kind: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, size: 4 + Math.random() * 5, color, ang: a, drag: 0.9, grav: 120 });
    }
  }

  /** Feixe reto entre dois pontos (rastro do salto). */
  beam(x1: number, y1: number, x2: number, y2: number, color: string, life = 0.35) {
    this.add({ kind: 'beam', x: x2, y: y2, vx: 0, vy: 0, life, max: life, size: 10, color, pts: [x1, y1, x2, y2], drag: 1 });
  }

  /** Portal em espiral. */
  portal(x: number, y: number, r: number, color: string, life = 0.55) {
    this.add({ kind: 'portal', x, y, vx: 0, vy: 0, life, max: life, size: r, color, ang: Math.random() * 6, drag: 1 });
  }

  /** Ondulação tracejada (camuflagem). */
  ripple(x: number, y: number, from: number, to: number, color: string, life = 0.6) {
    this.add({ kind: 'ripple', x, y, vx: 0, vy: 0, life, max: life, size: from, r2: to, color, ang: Math.random() * 6, drag: 1 });
  }

  /** Meteoro de biomassa caindo do céu até (x, y), depois de `delay` segundos. */
  meteor(x: number, y: number, delay: number, color = '#ffd23f') {
    const life = 0.55;
    this.add({ kind: 'meteor', x, y, vx: 0, vy: 0, life, max: life, size: 9 + Math.random() * 6, color, delay, drag: 1 });
  }

  /** Texto grande que sobe devagar (sequência de abates, pelas costas). */
  banner(x: number, y: number, text: string, color: string, size = 30) {
    this.add({ kind: 'banner', x, y, vx: 0, vy: -40, life: 1.3, max: 1.3, size, color, text, drag: 0.97 });
  }

  update(dt: number, pos: (id: number) => { x: number; y: number } | null) {
    for (const d of this.decals) d.life -= dt;
    this.decals = this.decals.filter((d) => d.life > 0);
    const out: P[] = [];
    const drag = (k: number) => Math.pow(k, dt * 60);
    const landed: P[] = [];
    for (const p of this.ps) {
      if (p.delay !== undefined && p.delay > 0) {
        p.delay -= dt;
        out.push(p);
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === 'meteor') landed.push(p);
        continue;
      }
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
    for (const m of landed) {
      this.ring(m.x, m.y, 6, 46, m.color, 0.35);
      this.burst(m.x, m.y, m.color, 5, 130, 3, 0.4);
    }
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
      if (p.delay !== undefined && p.delay > 0) continue;
      if (p.kind === 'glow' || p.kind === 'spark' || p.kind === 'rise' || p.kind === 'column' || p.kind === 'seek' || p.kind === 'streak' || p.kind === 'hex' || p.kind === 'beam' || p.kind === 'portal' || p.kind === 'meteor') continue;
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
        case 'banner': {
          const pop = k > 0.88 ? 1 + (k - 0.88) * 5 : 1;
          ctx.font = `${Math.round(p.size * pop)}px 'Lilita One', 'Fredoka', system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 7;
          ctx.strokeStyle = 'rgba(10,6,20,0.85)';
          ctx.strokeText(p.text ?? '', p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text ?? '', p.x, p.y);
          break;
        }
        case 'ghost': {
          ctx.globalAlpha = k * 0.42;
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.ang ?? 0);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * (1.15 + (1 - k) * 0.4), p.size * (0.92 - (1 - k) * 0.2), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'shard': {
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.ang ?? 0) + (1 - k) * 8);
          ctx.beginPath();
          ctx.moveTo(p.size, 0);
          ctx.lineTo(-p.size * 0.6, p.size * 0.5);
          ctx.lineTo(-p.size * 0.4, -p.size * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'ripple': {
          const rr = p.size + ((p.r2 ?? p.size) - p.size) * (1 - k);
          ctx.globalAlpha = k * 0.8;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([10, 9]);
          ctx.lineDashOffset = (p.ang ?? 0) * 20 + (1 - k) * 40;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case 'ring':
          break;
      }
    }
    ctx.globalAlpha = 1;

    // camada aditiva (brilho)
    const prev = ctx.globalCompositeOperation;
    if (this.hq) ctx.globalCompositeOperation = 'lighter';
    for (const p of this.ps) {
      if (p.delay !== undefined && p.delay > 0) continue;
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
        case 'streak': {
          const a = p.ang ?? 0;
          ctx.globalAlpha = k * 0.8;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(a) * p.size * k, p.y - Math.sin(a) * p.size * k);
          ctx.stroke();
          break;
        }
        case 'hex': {
          const rr = p.size + ((p.r2 ?? p.size) - p.size) * (1 - Math.pow(k, 1.4));
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 + 6 * k;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (let i = 0; i <= 6; i++) {
            const a = (p.ang ?? 0) + (i / 6) * Math.PI * 2;
            const px = p.x + Math.cos(a) * rr;
            const py = p.y + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          if (this.hq) {
            // células internas do favo
            ctx.globalAlpha = k * 0.45;
            ctx.lineWidth = 1.5;
            const cr = rr * 0.32;
            for (let j = 0; j < 6; j++) {
              const ca = (p.ang ?? 0) + (j / 6) * Math.PI * 2 + Math.PI / 6;
              const cx = p.x + Math.cos(ca) * rr * 0.55;
              const cy = p.y + Math.sin(ca) * rr * 0.55;
              ctx.beginPath();
              for (let i = 0; i <= 6; i++) {
                const a = (p.ang ?? 0) + (i / 6) * Math.PI * 2;
                if (i === 0) ctx.moveTo(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr);
                else ctx.lineTo(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr);
              }
              ctx.stroke();
            }
          }
          break;
        }
        case 'beam': {
          const pts = p.pts ?? [0, 0, 0, 0];
          ctx.lineCap = 'round';
          for (const [w, a] of this.hq ? ([[p.size * 2.2 * k, 0.25], [p.size * 0.6 * k + 1, 0.9]] as const) : ([[p.size * 0.6 * k + 1, 0.9]] as const)) {
            ctx.globalAlpha = k * a;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(pts[0]!, pts[1]!);
            ctx.lineTo(pts[2]!, pts[3]!);
            ctx.stroke();
          }
          break;
        }
        case 'portal': {
          const spin = (p.ang ?? 0) + (1 - k) * 9;
          const rr = p.size * (0.5 + 0.7 * Math.sin(k * Math.PI));
          ctx.strokeStyle = p.color;
          ctx.lineCap = 'round';
          for (let i = 0; i < 3; i++) {
            ctx.globalAlpha = k * (0.9 - i * 0.22);
            ctx.lineWidth = 4 - i;
            ctx.beginPath();
            ctx.arc(p.x, p.y, rr * (1 - i * 0.28), spin + i * 2.1, spin + i * 2.1 + Math.PI * 1.2);
            ctx.stroke();
          }
          ctx.globalAlpha = k * 0.7;
          const g = rr * 1.4;
          ctx.drawImage(glow(p.color), p.x - g, p.y - g, g * 2, g * 2);
          break;
        }
        case 'meteor': {
          // cai na diagonal: posição interpolada do céu até o alvo
          const f = 1 - k;
          const hx = p.x - 260 * (1 - f);
          const hy = p.y - 520 * (1 - f);
          ctx.globalAlpha = Math.min(1, f * 3);
          ctx.strokeStyle = p.color;
          ctx.lineCap = 'round';
          ctx.lineWidth = p.size * 0.9;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx - 70, hy - 140);
          ctx.globalAlpha = Math.min(1, f * 3) * 0.35;
          ctx.stroke();
          ctx.globalAlpha = Math.min(1, f * 3);
          const g = p.size * 2.6;
          ctx.drawImage(glow(p.color), hx - g, hy - g, g * 2, g * 2);
          ctx.drawImage(glow('#ffffff'), hx - g * 0.4, hy - g * 0.4, g * 0.8, g * 0.8);
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
