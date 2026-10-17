// Capturas para revisão visual: título, arena perto de uma zona e de uma poça de ácido (desktop e celular).
// Uso: BASE_URL=http://localhost:2567 node tests/e2e/visual-tour.mjs [pasta]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:2567';
const OUT = process.argv[2] || 'tests/e2e/screens';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
const errors = [];
async function goTo(page, target) {
  const held = new Set();
  for (let i = 0; i < 90; i++) {
    const me = await page.evaluate(() => window.__mutant.game.me);
    const t = await page.evaluate(target);
    if (!me || !t) break;
    const dx = t.x - me.x, dy = t.y - me.y;
    if (Math.hypot(dx, dy) < t.stop) break;
    const want = new Set();
    if (dx > 30) want.add('KeyD'); if (dx < -30) want.add('KeyA');
    if (dy > 30) want.add('KeyS'); if (dy < -30) want.add('KeyW');
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      if (want.has(k) && !held.has(k)) { await page.keyboard.down(k); held.add(k); }
      if (!want.has(k) && held.has(k)) { await page.keyboard.up(k); held.delete(k); }
    }
    await wait(150);
  }
  for (const k of held) await page.keyboard.up(k);
}
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['celular', devices['iPhone 13']]]) {
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${BASE}/?duracao=120`);
  await wait(1200);
  await page.screenshot({ path: `${OUT}/${label}-titulo.png` });
  await page.fill('#name', label);
  await page.click('#practice');
  await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 12000 });
  await wait(800);
  await page.screenshot({ path: `${OUT}/${label}-inicio.png` });
  await goTo(page, () => { const g = window.__mutant.game; const me = g.me; let best = null; for (const z of g.zones) { const d = Math.hypot(z[1] - me.x, z[2] - me.y); if (!best || d < best.d) best = { x: z[1], y: z[2], d }; } return best && { x: best.x, y: best.y + 280, stop: 60 }; });
  await page.screenshot({ path: `${OUT}/${label}-zona.png` });
  await goTo(page, () => { const g = window.__mutant.game; const me = g.me; let best = null; for (const h of g.hazards) { const d = Math.hypot(h[0] - me.x, h[1] - me.y); if (!best || d < best.d) best = { x: h[0], y: h[1], r: h[2], d }; } return best && { x: best.x + best.r + 120, y: best.y, stop: 60 }; });
  await page.screenshot({ path: `${OUT}/${label}-acido.png` });
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round(n / 2)); }; requestAnimationFrame(f); }));
  console.log(`${label}: ~${fps} fps (headless, sem GPU)`);
  await ctx.close();
}
await b.close();
console.log(errors.length ? 'ERROS:\n' + errors.join('\n') : 'sem erros no navegador');
