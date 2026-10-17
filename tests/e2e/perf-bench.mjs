// Mede o tempo de quadro no treino offline com CPU desacelerada (simula celular modesto).
// Uso: BASE_URL=http://localhost:2567 node tests/e2e/perf-bench.mjs [fatorCPU=4]
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL || 'http://localhost:2567';
const rate = Number(process.argv[2] || 4);
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(`${BASE}/?duracao=200`);
await page.fill('#name', 'bench');
await page.click('#practice');
await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 15000 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
// anda em círculos para ter movimento e partículas
await page.keyboard.down('KeyD');
await page.waitForTimeout(1500);
const r = await page.evaluate(() => new Promise((res) => {
  const ts = []; let last = performance.now(); const t0 = last;
  const f = (t) => { ts.push(t - last); last = t; if (t - t0 < 6000) requestAnimationFrame(f); else res(ts); };
  requestAnimationFrame(f);
}));
await page.keyboard.up('KeyD');
r.sort((a, b) => a - b);
const avg = r.reduce((a, b) => a + b, 0) / r.length;
const p95 = r[Math.floor(r.length * 0.95)];
const info = await page.evaluate(() => ({ dpr: window.devicePixelRatio, canvas: document.getElementById('game').width + 'x' + document.getElementById('game').height, q: window.__mutant.renderer.quality ?? window.__mutant.settings.quality }));
console.log(`CPU x${rate}: ${Math.round(1000 / avg)} fps médio · quadro médio ${avg.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · canvas ${info.canvas} · qualidade ${info.q}`);
await b.close();
