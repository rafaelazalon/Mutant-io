import { FLAG, type HybridId, type Look, type MutationId } from '@mutant/shared';
import { drawAccessory, drawEye, drawHalo, paintSkin, paletteFor, type Palette } from './look.js';
import { glow } from './sprites.js';

export interface CreatureDraw {
  x: number;
  y: number;
  r: number;
  hue: number;
  fx: number;
  fy: number;
  vx: number;
  vy: number;
  muts: ReadonlySet<MutationId>;
  hyb: ReadonlySet<HybridId>;
  flags: number;
  alpha: number;
  seed: number;
  level: number;
  /** 0–1: abertura da boca (animação de mordida) */
  bite?: number;
  /** aparência comprada/equipada (só visual) */
  look?: Look;
}

const HYBRID_COLORS: Record<HybridId, string> = {
  investida_blindada: '#7ef0d8',
  coletor_furtivo: '#ff8fd0',
  cacador_aproximacao: '#5ce1ff',
  mutante_resistencia: '#7dff6a',
};

const FONT = "'Fredoka', 'Nunito', system-ui, sans-serif";

/** Contorno orgânico. */
function blobPath(ctx: CanvasRenderingContext2D, r: number, n: number, t: number, seed: number, amp: number) {
  ctx.beginPath();
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + amp * Math.sin(t * 2.6 + i * 1.9 + seed) + amp * 0.5 * Math.sin(t * 4.1 + i * 0.7));
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  for (let i = 0; i <= n; i++) {
    const p0 = pts[i % n]!;
    const p1 = pts[(i + 1) % n]!;
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
  }
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Cache do corpo                                                      */
/* ------------------------------------------------------------------ */

/**
 * As partes estáticas (membrana, interior, placas, espinhos, chifres…) são desenhadas
 * uma única vez num canvas fora da tela e reutilizadas a cada quadro. Só as partes
 * animadas (patas, cauda, olhos, boca, efeitos) são desenhadas ao vivo.
 */
interface BodyCache {
  c: HTMLCanvasElement;
  half: number;
}
const bodyCache = new Map<string, BodyCache>();
const BODY_EXTENT = 1.75;

function bodyKey(c: CreatureDraw, rBucket: number, res: number, hq: boolean) {
  return `${c.hue}|${c.level}|${[...c.muts].sort().join(',')}|${rBucket}|${res}|${hq ? 1 : 0}|${c.seed % 7}|${c.look?.cor ?? ''}|${c.look?.padrao ?? ''}`;
}

function getBody(c: CreatureDraw, hq: boolean, res: number): BodyCache {
  const rB = Math.round(c.r);
  const key = bodyKey(c, rB, res, hq);
  let b = bodyCache.get(key);
  if (b) {
    // LRU: renova a posição
    bodyCache.delete(key);
    bodyCache.set(key, b);
    return b;
  }
  const half = rB * BODY_EXTENT;
  const size = Math.max(8, Math.ceil(half * 2 * res));
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const x = cv.getContext('2d');
  if (x) {
    x.translate(size / 2, size / 2);
    x.scale(res, res);
    paintBody(x, rB, paletteFor(c.hue, c.look), c.look, c.muts, c.level, c.seed % 7, hq);
  }
  b = { c: cv, half };
  bodyCache.set(key, b);
  while (bodyCache.size > 90) bodyCache.delete(bodyCache.keys().next().value as string);
  return b;
}

function paintBody(ctx: CanvasRenderingContext2D, r: number, pal: Palette, look: Look | undefined, muts: ReadonlySet<MutationId>, lv: number, seed: number, hq: boolean) {
  const { base, deep, dark, light, inner } = pal;

  if (muts.has('gel_regenerativo')) {
    blobPath(ctx, r * 1.24, 12, 0.7, seed + 3, 0.07);
    ctx.fillStyle = 'rgba(125,255,106,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,255,150,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,255,200,0.55)';
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1, r * 0.05 + (i % 2) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (muts.has('espinhos_externos')) {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.32 + (i / (n - 1)) * Math.PI * 1.36;
      const w = 0.15;
      const len = r * (1.42 + (i % 2) * 0.12);
      const tipX = Math.cos(a) * len;
      const tipY = Math.sin(a) * len;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - w) * r * 0.88, Math.sin(a - w) * r * 0.88);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(Math.cos(a + w) * r * 0.88, Math.sin(a + w) * r * 0.88);
      ctx.closePath();
      const g = ctx.createLinearGradient(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, tipX, tipY);
      g.addColorStop(0, '#ff5f8f');
      g.addColorStop(1, '#fff0f4');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#7a1233';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  if (lv >= 2) {
    const ridges = Math.min(5, 1 + Math.floor(lv / 2));
    ctx.fillStyle = dark;
    for (let i = 0; i < ridges; i++) {
      const px = -r * (0.15 + i * 0.22);
      ctx.beginPath();
      ctx.moveTo(px + r * 0.1, 0);
      ctx.lineTo(px, -r * (0.92 + (lv >= 7 ? 0.35 : 0.18)));
      ctx.lineTo(px - r * 0.12, 0);
      ctx.closePath();
      ctx.fill();
    }
  }

  // corpo
  blobPath(ctx, r, 14, 0, seed, 0.035);
  const g = ctx.createRadialGradient(r * 0.3, -r * 0.35, r * 0.05, 0, 0, r * 1.05);
  g.addColorStop(0, light);
  g.addColorStop(0.45, base);
  g.addColorStop(0.88, deep);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, r * 0.09);
  ctx.strokeStyle = dark;
  ctx.stroke();

  ctx.save();
  blobPath(ctx, r * 0.94, 14, 0, seed, 0.035);
  ctx.clip();
  paintSkin(ctx, r, look, pal, seed);
  ctx.fillStyle = pal.nucleus;
  ctx.beginPath();
  ctx.ellipse(-r * 0.25, r * 0.15, r * 0.32, r * 0.26, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.light;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(-r * 0.19, r * 0.11, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const org = 2 + Math.min(4, Math.floor(lv / 2));
  ctx.fillStyle = inner;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < org; i++) {
    const a = i * 2.4 + seed;
    const d = r * (0.48 + 0.1 * Math.sin(i * 1.7));
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d - r * 0.1, Math.sin(a) * d, r * (0.06 + (i % 3) * 0.025), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (muts.has('camuflagem')) {
    ctx.fillStyle = 'rgba(155,229,100,0.42)';
    for (let i = 0; i < 7; i++) {
      const a = seed * 1.3 + i * 2.1;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * (0.14 + (i % 3) * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (muts.has('carapaca_cristalina')) {
    const hexes: [number, number, number][] = [
      [-r * 0.32, 0, 0.3],
      [-r * 0.02, -r * 0.46, 0.25],
      [-r * 0.02, r * 0.46, 0.25],
      [-r * 0.72, -r * 0.36, 0.26],
      [-r * 0.72, r * 0.36, 0.26],
      [-r * 0.95, 0, 0.2],
    ];
    for (const [hx, hy, s] of hexes) {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const px = hx + Math.cos(a) * r * s;
        const py = hy + Math.sin(a) * r * s;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const gg = ctx.createLinearGradient(hx - r * s, hy - r * s, hx + r * s, hy + r * s);
      gg.addColorStop(0, 'rgba(230,255,250,0.85)');
      gg.addColorStop(0.5, 'rgba(126,240,216,0.6)');
      gg.addColorStop(1, 'rgba(40,140,130,0.7)');
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  if (muts.has('pele_escorregadia')) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.74, -2.5, -1.5);
    ctx.stroke();
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, -2.25, -1.8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(180,240,255,0.7)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(-r * (0.3 + i * 0.25), r * (0.55 - i * 0.12), r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // luz de borda
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1.5, r * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, -2.3, -0.6);
  ctx.stroke();

  if (muts.has('escudo_organico')) {
    ctx.strokeStyle = '#7a5a00';
    ctx.lineWidth = Math.max(4, r * 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.92, Math.PI * 0.62, Math.PI * 1.38);
    ctx.stroke();
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.stroke();
  }

  if (muts.has('isca_biologica')) {
    ctx.fillStyle = '#ffa3a3';
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-r * 0.35, r * 0.84, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(-r * 0.42, r * 0.78, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  if (lv >= 4) {
    const hl = r * (0.38 + Math.min(0.3, (lv - 4) * 0.06));
    for (const s of [-1, 1]) {
      const bx0 = r * 0.32;
      const by0 = s * r * 0.62;
      const tx = -r * 0.05 - hl * 0.55;
      const ty = s * (r * 0.95 + hl);
      ctx.beginPath();
      ctx.moveTo(bx0, by0);
      ctx.quadraticCurveTo(r * 0.38, s * (r * 0.95 + hl * 0.5), tx, ty);
      ctx.quadraticCurveTo(r * 0.12, s * (r * 0.9 + hl * 0.2), r * 0.02, s * r * 0.8);
      ctx.closePath();
      const hg = ctx.createLinearGradient(bx0, by0, tx, ty);
      hg.addColorStop(0, '#6b5a48');
      hg.addColorStop(1, '#f3ead8');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  void hq;
}

/* ------------------------------------------------------------------ */
/* Desenho por quadro                                                  */
/* ------------------------------------------------------------------ */

/**
 * Desenha uma criatura: corpo vindo do cache + partes animadas ao vivo.
 * `res` = pixels de tela por unidade do mundo (escolhe a nitidez do cache).
 */
export function drawCreature(ctx: CanvasRenderingContext2D, c: CreatureDraw, time: number, hq: boolean, res = 1.5) {
  const { r, muts, flags } = c;
  const pal = paletteFor(c.hue, c.look);
  const { base, deep, dark, light } = pal;
  const speed = Math.hypot(c.vx, c.vy);
  const angle = Math.atan2(c.fy, c.fx);
  const tt = time + c.seed * 0.37;
  const walk = time * (3 + speed / 35);
  const dashing = (flags & FLAG.dashing) !== 0;
  const bite = c.bite ?? 0;
  const lv = c.level;
  const resB = Math.max(0.5, Math.min(2.5, Math.ceil(res * 2) / 2));

  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.globalAlpha = c.alpha;

  // brilho e sombra (baratos: imagem pronta + elipse)
  if (hq) {
    const g = r * 2.8;
    ctx.globalAlpha = c.alpha * (0.32 + (dashing ? 0.3 : 0));
    ctx.drawImage(glow(base, 64), -g, -g, g * 2, g * 2);
    ctx.globalAlpha = c.alpha;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(r * 0.15, r * 0.35, r * 1.02, r * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();

  // auras dos híbridos
  let ai = 0;
  for (const hy of c.hyb) {
    const rr = r * (1.62 + ai * 0.16);
    const rot = tt * (ai % 2 ? -0.9 : 0.9);
    ctx.strokeStyle = HYBRID_COLORS[hy];
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, rr, rot + (k * Math.PI * 2) / 3, rot + (k * Math.PI * 2) / 3 + 1.3);
      ctx.stroke();
    }
    ai++;
  }

  if (muts.has('salto_dimensional')) {
    ctx.fillStyle = '#d4b8ff';
    for (let i = 0; i < 3; i++) {
      const a = tt * 1.8 + (i * Math.PI * 2) / 3;
      const px = Math.cos(a) * r * 1.42;
      const py = Math.sin(a) * r * 1.42;
      const s = r * 0.14;
      ctx.beginPath();
      ctx.moveTo(px, py - s);
      ctx.lineTo(px + s * 0.6, py);
      ctx.lineTo(px, py + s);
      ctx.lineTo(px - s * 0.6, py);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.rotate(angle);
  const stretch = 1 + Math.min(0.18, speed / 1500) + (dashing ? 0.18 : 0);
  const hurt = (flags & FLAG.hurt) !== 0;
  const breathe = 1 + Math.sin(tt * 2.4) * 0.025;
  ctx.scale(stretch * (hurt ? 0.92 : 1) * breathe, (1 / Math.sqrt(stretch)) * (hurt ? 1.06 : 1) * (2 - breathe));

  // cauda
  if (muts.has('cauda_propulsora')) {
    const segs = hq ? 6 : 4;
    let px = -r * 0.7;
    let py = 0;
    ctx.lineCap = 'round';
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const x = -r * (0.7 + f * 1.05);
      const y = Math.sin(walk * 0.9 - f * 2.6) * r * 0.26 * f;
      ctx.strokeStyle = i % 2 ? deep : base;
      ctx.lineWidth = r * (0.5 - f * 0.32);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      px = x;
      py = y;
    }
    ctx.fillStyle = dashing ? '#ffb547' : light;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - r * 0.45, py - r * 0.42);
    ctx.lineTo(px - r * 0.28, py);
    ctx.lineTo(px - r * 0.45, py + r * 0.42);
    ctx.closePath();
    ctx.fill();
    if (dashing) {
      const fl = r * 1.3;
      ctx.drawImage(glow('#ff9a3c', 64), px - fl * 1.6, py - fl * 0.6, fl * 1.6, fl * 1.2);
    }
  }

  // patas
  if (muts.has('pernas_elasticas')) {
    ctx.lineCap = 'round';
    const legs = [0.8, 2.15, -0.8, -2.15];
    for (let i = 0; i < 4; i++) {
      const a = legs[i]!;
      const ph = Math.sin(walk + i * Math.PI * 0.5) * (speed > 15 ? 0.38 : 0.05);
      const hx = Math.cos(a) * r * 0.7;
      const hy = Math.sin(a) * r * 0.7;
      const fa = a + ph;
      const side = Math.sign(Math.sin(a));
      const kx = Math.cos(fa) * r * 1.25 + Math.cos(a) * r * 0.1;
      const ky = Math.sin(fa) * r * 1.25 + side * r * 0.12;
      const fx = Math.cos(fa) * r * 1.55;
      const fy = Math.sin(fa) * r * 1.55;
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(4, r * 0.2);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      if (hq) {
        ctx.strokeStyle = deep;
        ctx.lineWidth = Math.max(2, r * 0.11);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffb547';
      ctx.beginPath();
      ctx.arc(fx, fy, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // corpo pronto
  const body = getBody(c, hq, resB);
  ctx.drawImage(body.c, -body.half, -body.half, body.half * 2, body.half * 2);

  // antenas
  if (muts.has('pulso_bioeletrico')) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(2, r * 0.07);
    for (const s of [-1, 1]) {
      const tx = r * 1.12;
      const ty = s * r * 0.8 + Math.sin(tt * 3 + s) * r * 0.05;
      ctx.beginPath();
      ctx.moveTo(r * 0.45, s * r * 0.45);
      ctx.quadraticCurveTo(r * 1.0, s * r * 0.4, tx, ty);
      ctx.stroke();
      if (hq) {
        const gs = r * 0.5;
        ctx.drawImage(glow('#5ce1ff', 32), tx - gs, ty - gs, gs * 2, gs * 2);
      }
      ctx.fillStyle = '#c8f6ff';
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // boca com dentes
  const mouthX = r * 0.66;
  const open = Math.max(bite, 0.12);
  const mh = r * (0.08 + open * 0.3);
  ctx.fillStyle = '#1a0510';
  ctx.beginPath();
  ctx.ellipse(mouthX, 0, r * (0.16 + open * 0.14), mh, 0, 0, Math.PI * 2);
  ctx.fill();
  if (bite > 0.1 || lv >= 3) {
    ctx.fillStyle = '#fff8ec';
    const teeth = 3 + Math.min(2, Math.floor(lv / 3));
    const tl = r * (0.07 + open * 0.08);
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const tx = mouthX - r * 0.12 + (i / (teeth - 1)) * r * 0.24;
      ctx.moveTo(tx - r * 0.035, -mh * 0.9);
      ctx.lineTo(tx, -mh * 0.9 + tl);
      ctx.lineTo(tx + r * 0.035, -mh * 0.9);
      ctx.moveTo(tx - r * 0.035, mh * 0.9);
      ctx.lineTo(tx, mh * 0.9 - tl);
      ctx.lineTo(tx + r * 0.035, mh * 0.9);
    }
    ctx.fill();
  }

  // língua
  if (muts.has('lingua_coletora')) {
    const cyc = (tt * 0.7) % 1;
    const ext = cyc < 0.2 ? Math.sin((cyc / 0.2) * Math.PI) : 0;
    if (ext > 0) {
      ctx.strokeStyle = '#ff6fbf';
      ctx.lineWidth = Math.max(2.5, r * 0.11);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mouthX, 0);
      ctx.quadraticCurveTo(r * 1.35, r * 0.25 * ext, r * (0.9 + ext * 1.3), 0);
      ctx.stroke();
      ctx.fillStyle = '#ff3fa6';
      ctx.beginPath();
      ctx.arc(r * (0.9 + ext * 1.3), 0, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // olhos (estilo da loja)
  const blink = tt % 3.7 < 0.12;
  const eyes = lv >= 6 ? EYES3 : EYES2;
  const eyeStyle = c.look?.olhos ?? 'olhos.padrao';
  for (const [exf, eyf, es] of eyes) {
    drawEye(ctx, eyeStyle, exf * r, eyf * r, r * es, blink, lv >= 4, dashing || bite > 0.3, pal, r, time);
  }

  // acessório por cima de tudo
  const acc = c.look?.acessorio;
  if (acc && acc !== 'acessorio.nenhum' && acc !== 'acessorio.aureola') drawAccessory(ctx, acc, r, time);

  if (hurt) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (flags & FLAG.armored) {
    ctx.strokeStyle = 'rgba(126,240,216,0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  if (c.look?.acessorio === 'acessorio.aureola') {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.globalAlpha = c.alpha;
    drawHalo(ctx, r, time);
    ctx.restore();
  }

  // efeitos sem rotação
  if (!(flags & (FLAG.shield | FLAG.cloak | FLAG.slow | FLAG.healing | FLAG.protected | FLAG.inZone))) return;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.globalAlpha = c.alpha;
  if (flags & FLAG.inZone) {
    // choque elétrico enquanto está na zona energizada
    ctx.strokeStyle = 'rgba(170,245,255,0.95)';
    ctx.lineWidth = 2;
    const n = hq ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(time * 12 + i * 3.3) * 2.399 + c.seed;
      let px = Math.cos(a) * r * 0.6;
      let py = Math.sin(a) * r * 0.6;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let k = 0; k < 4; k++) {
        const j = Math.sin(a * 7 + k * 5.1 + Math.floor(time * 20)) * r * 0.35;
        px += Math.cos(a) * r * 0.22 - Math.sin(a) * j * 0.6;
        py += Math.sin(a) * r * 0.22 + Math.cos(a) * j * 0.6;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  if (flags & FLAG.shield) {
    const p = 0.8 + 0.2 * Math.sin(time * 12);
    const R = r * 1.55;
    ctx.fillStyle = `rgba(255,224,102,${0.14 * p})`;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,224,102,${0.9 * p})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,230,0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, R, time * 4, time * 4 + 0.7);
    ctx.stroke();
  }
  if (flags & FLAG.cloak) {
    ctx.strokeStyle = 'rgba(155,229,100,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (flags & FLAG.slow) {
    ctx.strokeStyle = 'rgba(92,225,255,0.95)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = time * 6 + i * 2.1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
      ctx.lineTo(Math.cos(a + 0.25) * r * 1.4, Math.sin(a + 0.25) * r * 1.4);
      ctx.lineTo(Math.cos(a + 0.45) * r * 1.12, Math.sin(a + 0.45) * r * 1.12);
      ctx.stroke();
    }
  }
  if (flags & FLAG.healing) {
    ctx.fillStyle = 'rgba(125,255,106,0.95)';
    ctx.font = `700 ${Math.round(r * 0.55)}px ${FONT}`;
    ctx.textAlign = 'center';
    const k = (time * 1.5) % 1;
    ctx.globalAlpha = c.alpha * (1 - k);
    ctx.fillText('+', r * 0.7, -r * (0.8 + k * 0.8));
  }
  if (flags & FLAG.protected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.3, time * 2, time * 2 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

const EYES2: [number, number, number][] = [
  [0.4, -0.32, 0.24],
  [0.4, 0.32, 0.24],
];
const EYES3: [number, number, number][] = [
  [0.4, -0.36, 0.2],
  [0.4, 0.36, 0.2],
  [0.12, 0, 0.15],
];
