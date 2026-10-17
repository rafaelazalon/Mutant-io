import { HYBRIDS, MUTATIONS, type ResultRow } from '@mutant/shared';
import { drawCreature } from '../render/creature.js';

/** Desenha o cartão de resultado (1080×1350) com a criatura final e as estatísticas. */
export function drawShareCard(canvas: HTMLCanvasElement, row: ResultRow, placement: number, total: number, mutantName: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0b1a3a');
  g.addColorStop(0.6, '#0a0f22');
  g.addColorStop(1, '#2a0b2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // células decorativas
  ctx.strokeStyle = 'rgba(120,170,255,0.08)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 22; i++) {
    ctx.beginPath();
    ctx.arc((i * 397) % W, (i * 631) % H, 30 + ((i * 53) % 90), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7dff6a';
  ctx.font = '900 64px system-ui, sans-serif';
  ctx.fillText('MUTANT.IO', W / 2, 110);

  // criatura
  ctx.save();
  const hal = ctx.createRadialGradient(W / 2, 430, 40, W / 2, 430, 330);
  hal.addColorStop(0, `hsla(${row.hue}, 90%, 60%, 0.35)`);
  hal.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hal;
  ctx.fillRect(0, 100, W, 660);
  drawCreature(
    ctx,
    { x: W / 2, y: 430, r: 150, hue: row.hue, fx: 1, fy: 0.15, vx: 60, vy: 0, muts: new Set(row.muts), hyb: new Set(row.hyb), flags: 0, alpha: 1, seed: row.id, level: row.maxLevel, look: row.look },
    1.3,
    true,
  );
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 64px system-ui, sans-serif';
  ctx.fillText(mutantName, W / 2, 735);
  ctx.fillStyle = '#ffe066';
  ctx.font = '800 40px system-ui, sans-serif';
  ctx.fillText(`#${placement} de ${total} · ${row.score} pontos`, W / 2, 795);

  // estatísticas
  const stats: [string, string][] = [
    ['Abates', String(row.kills)],
    ['Mortes', String(row.deaths)],
    ['Nível máx.', String(row.maxLevel)],
    ['Biomassa', String(row.biomass)],
  ];
  stats.forEach(([k, v], i) => {
    const x = 165 + i * 250;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(ctx, x - 110, 835, 220, 120, 22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 46px system-ui';
    ctx.fillText(v, x, 900);
    ctx.fillStyle = '#8ea0c4';
    ctx.font = '700 26px system-ui';
    ctx.fillText(k, x, 937);
  });

  // mutações
  ctx.textAlign = 'left';
  ctx.font = '800 30px system-ui';
  ctx.fillStyle = '#8ea0c4';
  ctx.fillText('MUTAÇÕES', 80, 1010);
  const muts = row.muts.length ? row.muts : [];
  ctx.font = '700 30px system-ui';
  muts.forEach((m, i) => {
    const col = i % 3;
    const line = Math.floor(i / 3);
    ctx.fillStyle = MUTATIONS[m].color;
    ctx.fillText(`${MUTATIONS[m].icon} ${MUTATIONS[m].name}`, 80 + col * 320, 1055 + line * 44);
  });
  if (!muts.length) {
    ctx.fillStyle = '#fff';
    ctx.fillText('Organismo puro (nenhuma mutação)', 80, 1055);
  }
  const hy = row.hyb.map((h) => `${HYBRIDS[h].icon} ${HYBRIDS[h].name}`).join('   ');
  if (hy) {
    ctx.fillStyle = '#ffe066';
    ctx.font = '900 32px system-ui';
    ctx.fillText(`HÍBRIDOS: ${hy}`, 80, 1210);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '800 34px system-ui';
  ctx.fillText(`Build ${row.build}`, W / 2, 1290);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Nome do mutante a partir das mutações (ex.: "Hidra Cristalina Elétrica"). */
export function mutantName(row: ResultRow): string {
  const nouns = ['Ameba', 'Quimera', 'Hidra', 'Larva', 'Criatura', 'Colosso'];
  const adj: Record<string, string> = {
    pernas_elasticas: 'Saltitante', cauda_propulsora: 'Propulsora', pele_escorregadia: 'Viscosa', salto_dimensional: 'Dimensional',
    carapaca_cristalina: 'Cristalina', gel_regenerativo: 'Gelatinosa', espinhos_externos: 'Espinhosa', escudo_organico: 'Blindada',
    lingua_coletora: 'Gulosa', pulso_bioeletrico: 'Elétrica', isca_biologica: 'Ilusória', camuflagem: 'Furtiva',
  };
  const n = nouns[Math.min(nouns.length - 1, Math.floor(row.maxLevel / 2))]!;
  const parts = row.muts.slice(-2).map((m) => adj[m]);
  return [n, ...parts].join(' ');
}

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded' | 'copied' | 'failed';

export async function shareCard(canvas: HTMLCanvasElement, text: string, url: string): Promise<ShareOutcome> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (blob && nav.share && nav.canShare) {
      const file = new File([blob], 'mutant-io.png', { type: 'image/png' });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text, title: 'MUTANT.IO' });
        return 'shared';
      }
    }
    if (nav.share) {
      await nav.share({ text, url, title: 'MUTANT.IO' });
      return 'shared';
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
  }
  // alternativa: baixar a imagem e copiar o texto
  const dl = blob ? downloadBlob(blob) : false;
  const cp = await copyText(`${text} ${url}`);
  return dl ? 'downloaded' : cp ? 'copied' : 'failed';
}

export function downloadBlob(blob: Blob): boolean {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mutant-io.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}
