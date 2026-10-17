// Verifica que o jogo ocupa exatamente a tela em vários aparelhos/orientações e que a interface não sai da tela.
// Uso: BASE_URL=http://localhost:2567 node tests/e2e/responsive.mjs [pasta]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:2567';
const OUT = process.argv[2] || 'tests/e2e/screens';
mkdirSync(OUT, { recursive: true });
const D = (d, landscape = false) => {
  const v = d.viewport;
  return landscape ? { ...d, viewport: { width: v.height, height: v.width } } : d;
};
const cases = [
  ['iphone-se', devices['iPhone SE']],
  ['iphone13', devices['iPhone 13']],
  ['iphone13-deitado', D(devices['iPhone 13'], true)],
  ['pixel7-deitado', D(devices['Pixel 7'], true)],
  ['ipad', devices['iPad (gen 7)']],
  ['ipad-deitado', D(devices['iPad (gen 7)'], true)],
  ['notebook', { viewport: { width: 1366, height: 768 } }],
  ['fullhd', { viewport: { width: 1920, height: 1080 } }],
  ['ultrawide', { viewport: { width: 2560, height: 1080 } }],
];
const b = await chromium.launch();
let fails = 0;
for (const [name, opts] of cases) {
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/?duracao=120`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-titulo.png` });
  await page.fill('#name', name);
  await page.click('#practice');
  await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 15000 });
  // mostra as cartas e alguns poderes só para conferir o layout (o servidor recusaria a escolha)
  await page.evaluate(() => {
    const g = window.__mutant.game;
    g.offer = { id: 1, opts: ['cauda_propulsora', 'carapaca_cristalina', 'pulso_bioeletrico'], expiresAt: performance.now() + 15000 };
    g.me.abilities = ['dash', 'pulse', 'shield', 'cloak'];
    g.me.muts = ['cauda_propulsora', 'pulso_bioeletrico', 'escudo_organico', 'camuflagem'];
  });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const c = document.getElementById('game').getBoundingClientRect();
    const out = [];
    for (const sel of ['.hud-tl', '.hud-tr', '.hud-tc', '.pw:not(.hidden)', '.evo-panel']) {
      for (const el of document.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect();
        if (b.width && (b.left < -1 || b.top < -1 || b.right > vw + 1 || b.bottom > vh + 1)) out.push(`${sel} fora da tela (${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)})`);
      }
    }
    const scrollW = document.documentElement.scrollWidth;
    return { vw, vh, cw: Math.round(c.width), ch: Math.round(c.height), out, scrollW, hud: getComputedStyle(document.documentElement).getPropertyValue('--hud') };
  });
  await page.screenshot({ path: `${OUT}/${name}-jogo.png` });
  const ok = r.cw === r.vw && r.ch === r.vh && !r.out.length && r.scrollW <= r.vw && !errs.length;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${name.padEnd(17)} tela ${r.vw}x${r.vh} · canvas ${r.cw}x${r.ch} · escala HUD ${r.hud}${r.out.length ? ' · ' + r.out.join('; ') : ''}${errs.length ? ' · erros: ' + errs.join(' | ') : ''}`);
  await ctx.close();
}
// redimensionar no meio da partida
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/?duracao=120`);
await page.fill('#name', 'resize');
await page.click('#practice');
await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 15000 });
await page.setViewportSize({ width: 600, height: 900 });
await page.waitForTimeout(400);
const rs = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return [Math.round(c.width), Math.round(c.height)]; });
const rsOk = rs[0] === 600 && rs[1] === 900;
if (!rsOk) fails++;
console.log(`${rsOk ? 'OK  ' : 'FALHA'} redimensionar 1280x720 → 600x900: canvas ${rs.join('x')}`);
await b.close();
console.log(fails ? `${fails} FALHA(S)` : 'RESPONSIVO OK');
process.exitCode = fails ? 1 : 0;
