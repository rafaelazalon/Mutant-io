/**
 * Sprites pré-renderizados em canvas fora da tela. Gradientes radiais por quadro são caros
 * em celulares; desenhar uma imagem pronta é barato. Tudo é procedural (sem arquivos externos),
 * e cada função pode ser trocada por uma spritesheet no futuro.
 */
type Cnv = HTMLCanvasElement;

const cache = new Map<string, Cnv>();

function make(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Cnv {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx);
  return c;
}

/** Halo suave de uma cor (para brilho aditivo). */
export function glow(color: string, size = 64): Cnv {
  const key = `g|${color}|${size}`;
  let c = cache.get(key);
  if (!c) {
    c = make(size, size, (x) => {
      const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, color);
      g.addColorStop(0.35, withAlpha(color, 0.45));
      g.addColorStop(1, withAlpha(color, 0));
      x.fillStyle = g;
      x.fillRect(0, 0, size, size);
    });
    cache.set(key, c);
  }
  return c;
}

/** Converte #rrggbb / hsl(...) em rgba com alfa (aceita os formatos usados no jogo). */
export function withAlpha(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (color.startsWith('hsl(') && !color.includes('/')) return color.replace('hsl(', 'hsla(').replace(')', ` / ${a})`);
  return color;
}

/** Partículas de biomassa: 0 célula verde, 1 cristal dourado, 2 pedaço de carne derrubado. */
export function pelletSprite(kind: number): Cnv {
  const key = `p|${kind}`;
  let c = cache.get(key);
  if (c) return c;
  const S = 64;
  c = make(S, S, (x) => {
    const m = S / 2;
    // halo embutido (evita um segundo desenho por partícula)
    x.globalAlpha = kind === 1 ? 0.7 : kind === 3 ? 0.95 : 0.45;
    x.drawImage(glow(kind === 1 || kind === 3 ? '#ffd23f' : kind === 2 ? '#ff7a4d' : '#6dff5a', 64), 0, 0, S, S);
    x.globalAlpha = 1;
    if (kind === 3) {
      // célula dourada: núcleo brilhante com membrana e organelas
      x.translate(m, m);
      const g = x.createRadialGradient(-5, -6, 2, 0, 0, 19);
      g.addColorStop(0, '#fffbe0');
      g.addColorStop(0.35, '#ffe066');
      g.addColorStop(0.8, '#f0a500');
      g.addColorStop(1, '#a86400');
      x.fillStyle = g;
      x.beginPath();
      x.arc(0, 0, 18, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#fff6c2';
      x.lineWidth = 2.5;
      x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.75)';
      for (const [ox, oy, r] of [[-6, -5, 4], [6, 3, 3], [-2, 8, 2.5], [8, -7, 2]] as const) {
        x.beginPath();
        x.arc(ox, oy, r, 0, Math.PI * 2);
        x.fill();
      }
    } else if (kind === 1) {
      // cristal dourado facetado
      x.translate(m, m);
      const pts: [number, number][] = [
        [0, -20],
        [13, -4],
        [8, 18],
        [-8, 18],
        [-13, -4],
      ];
      x.beginPath();
      pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.closePath();
      const g = x.createLinearGradient(-13, -20, 13, 18);
      g.addColorStop(0, '#fff6c2');
      g.addColorStop(0.45, '#ffd23f');
      g.addColorStop(1, '#c98a00');
      x.fillStyle = g;
      x.fill();
      x.strokeStyle = '#fff3a8';
      x.lineWidth = 2;
      x.stroke();
      x.beginPath();
      x.moveTo(0, -20);
      x.lineTo(0, 18);
      x.moveTo(-13, -4);
      x.lineTo(13, -4);
      x.strokeStyle = 'rgba(255,255,255,0.55)';
      x.lineWidth = 1.5;
      x.stroke();
    } else if (kind === 2) {
      // pedaço orgânico (biomassa de criatura eliminada)
      x.translate(m, m);
      x.beginPath();
      for (let i = 0; i <= 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = 15 + Math.sin(i * 2.7) * 4;
        if (i === 0) x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath();
      const g = x.createRadialGradient(-4, -5, 2, 0, 0, 18);
      g.addColorStop(0, '#ffc3a0');
      g.addColorStop(0.5, '#ff7a4d');
      g.addColorStop(1, '#a8321f');
      x.fillStyle = g;
      x.fill();
      x.strokeStyle = '#5e1810';
      x.lineWidth = 2;
      x.stroke();
      x.fillStyle = 'rgba(255,240,220,0.8)';
      x.beginPath();
      x.arc(-5, -5, 3.5, 0, Math.PI * 2);
      x.fill();
    } else {
      // célula verde com núcleo
      const g = x.createRadialGradient(m - 4, m - 5, 1, m, m, 16);
      g.addColorStop(0, '#eaffd8');
      g.addColorStop(0.45, '#8dff6a');
      g.addColorStop(1, '#249a3e');
      x.fillStyle = g;
      x.beginPath();
      x.arc(m, m, 15, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#0f5a22';
      x.lineWidth = 2;
      x.stroke();
      x.fillStyle = 'rgba(20,90,40,0.55)';
      x.beginPath();
      x.arc(m + 3, m + 3, 5, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.beginPath();
      x.arc(m - 5, m - 6, 3, 0, Math.PI * 2);
      x.fill();
    }
  });
  cache.set(key, c);
  return c;
}

/** Ladrilho de tecido hexagonal (repetido como padrão no chão da arena). */
export function hexTile(): Cnv {
  const key = 'hex';
  let c = cache.get(key);
  if (c) return c;
  const R = 46;
  const w = Math.round(R * Math.sqrt(3));
  const h = R * 3;
  c = make(w, h, (x) => {
    const hex = (cx: number, cy: number) => {
      x.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx + Math.cos(a) * (R - 3);
        const py = cy + Math.sin(a) * (R - 3);
        if (i === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.closePath();
    };
    x.strokeStyle = 'rgba(110,170,255,0.075)';
    x.lineWidth = 2;
    x.fillStyle = 'rgba(110,170,255,0.018)';
    for (const [cx, cy] of [
      [w / 2, R / 2],
      [0, R * 2],
      [w, R * 2],
      [w / 2, R * 3.5],
      [0, -R],
      [w, -R],
    ] as [number, number][]) {
      hex(cx, cy);
      x.fill();
      x.stroke();
    }
    // pontinhos de núcleo em algumas células
    x.fillStyle = 'rgba(140,200,255,0.06)';
    x.beginPath();
    x.arc(w / 2 + 6, R / 2 - 4, 5, 0, Math.PI * 2);
    x.arc(w * 0.1, R * 2 + 8, 4, 0, Math.PI * 2);
    x.fill();
  });
  cache.set(key, c);
  return c;
}
