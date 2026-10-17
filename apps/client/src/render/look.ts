import type { Look } from '@mutant/shared';
import { glow } from './sprites.js';

/** Paleta do corpo. "Natural" usa a cor sorteada do jogador; as outras vêm da loja. */
export interface Palette {
  base: string;
  deep: string;
  dark: string;
  light: string;
  inner: string;
  nucleus: string;
  iris: string;
}

const FIXED: Record<string, Omit<Palette, 'iris'> & { iris?: string }> = {
  'cor.neon': { base: '#ff3df2', deep: '#8a12c4', dark: '#2a0640', light: '#7ffcff', inner: '#7ffcff', nucleus: 'rgba(40,0,70,0.45)' },
  'cor.ouro': { base: '#ffcf33', deep: '#b8860b', dark: '#4a3300', light: '#fff8d0', inner: '#fff1a0', nucleus: 'rgba(90,60,0,0.4)', iris: '#7a3cff' },
  'cor.lava': { base: '#ff5a1f', deep: '#a01d00', dark: '#2b0700', light: '#ffd27a', inner: '#ffe066', nucleus: 'rgba(60,0,0,0.5)', iris: '#ffe066' },
  'cor.gelo': { base: '#9eeaff', deep: '#3b8fc4', dark: '#0d3050', light: '#ffffff', inner: '#ffffff', nucleus: 'rgba(20,70,120,0.35)', iris: '#2a6cff' },
  'cor.toxico': { base: '#b6ff1a', deep: '#4f8f00', dark: '#1c3300', light: '#f4ffb0', inner: '#f4ffb0', nucleus: 'rgba(30,60,0,0.45)', iris: '#ff2a8a' },
  'cor.galaxia': { base: '#5b2bd1', deep: '#26106b', dark: '#0b0526', light: '#c9a6ff', inner: '#ffffff', nucleus: 'rgba(10,0,40,0.5)', iris: '#ffe066' },
  'cor.sombra': { base: '#3a3f55', deep: '#1d2030', dark: '#07080f', light: '#8a90b0', inner: '#ff4d6d', nucleus: 'rgba(0,0,0,0.5)', iris: '#ff2a2a' },
  'cor.algodao': { base: '#ffb3e1', deep: '#c66fa8', dark: '#5a2049', light: '#e7fbff', inner: '#bfefff', nucleus: 'rgba(110,40,90,0.3)', iris: '#3fb4ff' },
};

export function paletteFor(hue: number, look?: Look): Palette {
  const f = look ? FIXED[look.cor] : undefined;
  if (f) return { iris: f.iris ?? `hsl(${(hue + 180) % 360} 90% 55%)`, ...f };
  return {
    base: `hsl(${hue} 80% 55%)`,
    deep: `hsl(${hue} 75% 32%)`,
    dark: `hsl(${hue} 70% 16%)`,
    light: `hsl(${hue} 100% 80%)`,
    inner: `hsl(${(hue + 25) % 360} 90% 68%)`,
    nucleus: `hsla(${hue} 70% 22% / 0.45)`,
    iris: `hsl(${(hue + 180) % 360} 90% 55%)`,
  };
}

/** Detalhes especiais da cor e o padrão da pele (desenhados uma vez, dentro do corpo, no cache). */
export function paintSkin(ctx: CanvasRenderingContext2D, r: number, look: Look | undefined, pal: Palette, seed: number) {
  if (!look) return;
  // efeitos próprios de algumas cores
  if (look.cor === 'cor.galaxia') {
    for (let i = 0; i < 22; i++) {
      const a = i * 2.39 + seed;
      const d = r * (0.15 + ((i * 37) % 80) / 100);
      ctx.fillStyle = i % 4 ? 'rgba(255,255,255,0.8)' : 'rgba(255,224,102,0.9)';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (i % 5 ? 0.025 : 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,90,200,0.18)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, -r * 0.1, r * 0.7, r * 0.25, 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.cor === 'cor.lava') {
    ctx.strokeStyle = 'rgba(255,230,120,0.8)';
    ctx.lineWidth = r * 0.05;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      let a = i * 1.26 + seed;
      let x = Math.cos(a) * r * 0.2;
      let y = Math.sin(a) * r * 0.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        a += k % 2 ? 0.5 : -0.4;
        x += Math.cos(a) * r * 0.2;
        y += Math.sin(a) * r * 0.2;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (look.cor === 'cor.gelo') {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = r * 0.03;
    for (let i = 0; i < 4; i++) {
      const cx = Math.cos(i * 1.7 + seed) * r * 0.5;
      const cy = Math.sin(i * 1.7 + seed) * r * 0.5;
      const s = r * 0.12;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI;
        ctx.moveTo(cx - Math.cos(a) * s, cy - Math.sin(a) * s);
        ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
      }
      ctx.stroke();
    }
  }

  switch (look.padrao) {
    case 'padrao.listras':
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(i * r * 0.32 - r * 0.1, 0, r * 0.09, r * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'padrao.bolinhas':
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      for (let i = 0; i < 11; i++) {
        const a = i * 2.39 + seed;
        const d = r * (0.25 + ((i * 53) % 60) / 100);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.08 + (i % 3) * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'padrao.tigre':
      ctx.fillStyle = 'rgba(10,5,0,0.55)';
      for (let i = -2; i <= 2; i++) {
        for (const s of [-1, 1]) {
          const x = i * r * 0.36 - r * 0.15;
          ctx.beginPath();
          ctx.moveTo(x - r * 0.08, s * r);
          ctx.lineTo(x + r * 0.05, s * r * 0.35);
          ctx.lineTo(x + r * 0.12, s * r);
          ctx.closePath();
          ctx.fill();
        }
      }
      break;
    case 'padrao.escamas': {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = r * 0.035;
      const s = r * 0.24;
      for (let gy = -r; gy <= r; gy += s * 0.7) {
        const off = (Math.round(gy / (s * 0.7)) % 2) * s * 0.5;
        for (let gx = -r - s; gx <= r; gx += s) {
          ctx.beginPath();
          ctx.arc(gx + off, gy, s * 0.5, 0, Math.PI);
          ctx.stroke();
        }
      }
      break;
    }
    case 'padrao.circuito': {
      ctx.strokeStyle = 'rgba(125,255,106,0.85)';
      ctx.fillStyle = '#d9ffd0';
      ctx.lineWidth = r * 0.04;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05 + seed * 0.3;
        const x0 = Math.cos(a) * r * 0.25;
        const y0 = Math.sin(a) * r * 0.25;
        const x1 = Math.cos(a) * r * 0.6;
        const y1 = Math.sin(a) * r * 0.6;
        const x2 = x1 + Math.cos(a + 0.9) * r * 0.25;
        const y2 = y1 + Math.sin(a + 0.9) * r * 0.25;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x2, y2, r * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  void pal;
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.6);
  ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.5, y - s * 0.9, x, y - s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 1.2, y - s * 0.1, x, y + s * 0.6);
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 ? s * 0.45 : s;
    if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Desenha um olho no estilo escolhido (espaço local já girado: frente em +x).
 * `slit` = pupila em fenda (nível 4+), `angry` = testa franzida (investida/mordida).
 */
export function drawEye(
  ctx: CanvasRenderingContext2D,
  style: string,
  ex: number,
  ey: number,
  er: number,
  blink: boolean,
  slit: boolean,
  angry: boolean,
  pal: Palette,
  r: number,
  time: number,
) {
  // robótico: visor escuro com LED
  if (style === 'olhos.robo') {
    ctx.fillStyle = '#10131f';
    ctx.strokeStyle = '#6b7390';
    ctx.lineWidth = Math.max(1.2, r * 0.04);
    ctx.beginPath();
    ctx.roundRect?.(ex - er, ey - er * 0.75, er * 2, er * 1.5, er * 0.35);
    ctx.fill();
    ctx.stroke();
    const p = 0.7 + 0.3 * Math.sin(time * 6);
    ctx.globalAlpha *= p;
    ctx.drawImage(glow('#ff2a2a', 32), ex - er, ey - er, er * 2, er * 2);
    ctx.globalAlpha /= p;
    ctx.fillStyle = '#ff4040';
    ctx.fillRect(ex - er * 0.2, ey - er * 0.55, er * 0.75, er * 1.1);
    return;
  }
  const sleepy = style === 'olhos.sonolento';
  ctx.fillStyle = '#fbfdff';
  ctx.strokeStyle = pal.dark;
  ctx.lineWidth = Math.max(1.2, r * 0.035);
  ctx.beginPath();
  ctx.ellipse(ex, ey, er, blink ? er * 0.12 : er, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (!blink) {
    if (style === 'olhos.coracao') {
      ctx.fillStyle = '#ff3d7a';
      heart(ctx, ex + er * 0.25, ey, er * 0.62 * (1 + 0.08 * Math.sin(time * 8)));
    } else if (style === 'olhos.estrela') {
      ctx.fillStyle = '#ffcf33';
      star(ctx, ex + er * 0.25, ey, er * 0.7);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + er * 0.45, ey - er * 0.3, er * 0.14, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = style === 'olhos.raivoso' ? '#ff3d3d' : pal.iris;
      ctx.beginPath();
      ctx.arc(ex + er * 0.3, ey, er * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#05060c';
      ctx.beginPath();
      if (slit || style === 'olhos.raivoso') ctx.ellipse(ex + er * 0.35, ey, er * 0.14, er * 0.48, 0, 0, Math.PI * 2);
      else ctx.arc(ex + er * 0.35, ey, er * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + er * 0.48, ey - er * 0.28, er * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (sleepy) {
      // pálpebra pesada cobrindo metade do olho (lado de fora)
      const s = Math.sign(ey) || -1;
      ctx.fillStyle = pal.deep;
      ctx.beginPath();
      ctx.ellipse(ex, ey, er * 1.02, er * 1.02, 0, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pal.dark;
      ctx.beginPath();
      ctx.moveTo(ex - er, ey);
      ctx.lineTo(ex + er, ey);
      ctx.stroke();
    }
  }
  if (angry || style === 'olhos.raivoso') {
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.beginPath();
    const s = Math.sign(ey) || 1;
    ctx.moveTo(ex - er * 0.9, ey - s * er * 1.2);
    ctx.lineTo(ex + er * 0.9, ey - s * er * 0.6);
    ctx.stroke();
  }
}

/** Acessório visto de cima, sobre o corpo (espaço girado: frente em +x). */
export function drawAccessory(ctx: CanvasRenderingContext2D, id: string, r: number, time: number) {
  switch (id) {
    case 'acessorio.coroa': {
      const cx = -r * 0.32;
      ctx.fillStyle = '#ffcf33';
      ctx.strokeStyle = '#8a6200';
      ctx.lineWidth = Math.max(1.5, r * 0.04);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const rr = k % 2 ? r * 0.22 : r * 0.38;
        if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(cx + Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff3d7a';
      ctx.beginPath();
      ctx.arc(cx, 0, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ctx.fillStyle = k % 2 ? '#5ce1ff' : '#7dff6a';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, r * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'acessorio.cartola': {
      const cx = -r * 0.38;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(cx + r * 0.05, r * 0.05, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c1f30';
      ctx.beginPath();
      ctx.arc(cx, 0, r * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c4204a';
      ctx.beginPath();
      ctx.arc(cx, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2f45';
      ctx.beginPath();
      ctx.arc(cx, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = r * 0.04;
      ctx.beginPath();
      ctx.arc(cx, 0, r * 0.23, -2.4, -1.2);
      ctx.stroke();
      break;
    }
    case 'acessorio.bone': {
      const cx = -r * 0.42;
      ctx.fillStyle = '#2459d6';
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.36, 0, r * 0.2, r * 0.34, 0, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      ctx.fillStyle = '#3d7bff';
      ctx.strokeStyle = '#173a8c';
      ctx.lineWidth = Math.max(1.5, r * 0.04);
      ctx.beginPath();
      ctx.arc(cx, 0, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5;
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx + Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38);
      }
      ctx.stroke();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(cx, 0, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'acessorio.flor': {
      const cx = -r * 0.25;
      const cy = -r * 0.5;
      const rot = Math.sin(time * 1.5) * 0.2;
      ctx.fillStyle = '#ff7ab8';
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + rot;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r * 0.17, cy + Math.sin(a) * r * 0.17, r * 0.15, r * 0.09, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'acessorio.antena': {
      const sway = Math.sin(time * 3) * r * 0.12;
      const bx = -r * 0.85 + sway * 0.3;
      const by = sway;
      ctx.strokeStyle = '#2a4f1d';
      ctx.lineWidth = Math.max(2, r * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, 0);
      ctx.quadraticCurveTo(-r * 0.6, sway * 0.5 - r * 0.2, bx, by);
      ctx.stroke();
      ctx.drawImage(glow('#7dff6a', 32), bx - r * 0.35, by - r * 0.35, r * 0.7, r * 0.7);
      ctx.fillStyle = '#c8ffb8';
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** Auréola flutuando acima da criatura (espaço de tela, sem girar). */
export function drawHalo(ctx: CanvasRenderingContext2D, r: number, time: number) {
  const y = -r * 1.25 + Math.sin(time * 2) * r * 0.06;
  ctx.drawImage(glow('#fff6b0', 48), -r * 0.9, y - r * 0.5, r * 1.8, r);
  ctx.strokeStyle = '#fff3a0';
  ctx.lineWidth = Math.max(2.5, r * 0.09);
  ctx.beginPath();
  ctx.ellipse(0, y, r * 0.55, r * 0.17, 0, 0, Math.PI * 2);
  ctx.stroke();
}
