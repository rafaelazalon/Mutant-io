// Mede FPS no treino offline com CPU desacelerada (simula celular intermediário).
// Uso: BASE_URL=http://localhost:2567 node tests/e2e/perf.mjs [lentidao=4]
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL || 'http://localhost:2567';
const rate = Number(process.argv[2] || 4);
const b = await chromium.launch();
for (const [label, opts] of [['celular', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 720 } }]]) {
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?duracao=300`);
  await page.fill('#name', 'perf');
  await page.click('#practice');
  await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 15000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => new Promise((res) => {
    const ts = []; let last = performance.now(); const t0 = last;
    const f = (t) => { ts.push(t - last); last = t; if (t - t0 < 5000) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); res({ fps: Math.round(1000 * ts.length / (t - t0)), p95: Math.round(ts[Math.floor(ts.length * 0.95)]), q: window.__mutant.renderer.hq, dpr: window.__mutant.renderer.dpr }); } };
    requestAnimationFrame(f);
  }));
  await page.keyboard.up('KeyD');
  console.log(`${label} (CPU ${rate}x mais lenta): ${r.fps} fps, quadro p95 ${r.p95} ms, qualidade ${r.q ? 'alta' : 'baixa'}, dpr ${r.dpr}`);
  await ctx.close();
}
await b.close();
