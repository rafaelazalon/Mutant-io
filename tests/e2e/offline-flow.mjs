// Fluxo completo no navegador (treino offline curto): coleta → evolução → habilidade → resultados → compartilhar.
// Uso: BASE_URL=http://localhost:2600 node tests/e2e/offline-flow.mjs [pasta-de-capturas]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:2567';
const OUT = process.argv[2] || 'tests/e2e/screens';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FALHOU:', m); process.exitCode = 1; };

const browser = await chromium.launch();
const errors = [];
async function run(label, ctxOpts) {
  const ctx = await browser.newContext({ ...ctxOpts, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${BASE}/?duracao=60`);
  await page.fill('#name', label);
  await page.click('#practice');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
  await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 10000 });

  // persegue biomassa até receber uma oferta de evolução
  const held = new Set();
  const press = async (want) => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      if (want.has(k) && !held.has(k)) { await page.keyboard.down(k); held.add(k); }
      if (!want.has(k) && held.has(k)) { await page.keyboard.up(k); held.delete(k); }
    }
  };
  let offered = false;
  for (let i = 0; i < 200 && !offered; i++) {
    const t = await page.evaluate(() => {
      const g = window.__mutant.game;
      const me = g.me;
      let best = null, bd = 1e12;
      for (const p of g.pellets.values()) {
        let acid = false;
        for (const [hx, hy, hr] of g.hazards) if (Math.hypot(hx - p.x, hy - p.y) < hr + 40) acid = true;
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (!acid && d < bd) { bd = d; best = p; }
      }
      return { me, best, offer: !!g.offer };
    });
    offered = t.offer;
    const want = new Set();
    if (t.best) {
      const dx = t.best.x - t.me.x, dy = t.best.y - t.me.y;
      if (dx > 12) want.add('KeyD'); if (dx < -12) want.add('KeyA');
      if (dy > 12) want.add('KeyS'); if (dy < -12) want.add('KeyW');
    }
    await press(want);
    await wait(120);
  }
  await press(new Set());
  if (!offered) return fail(`${label}: nenhuma oferta de evolução`);
  await page.waitForSelector('.evo-panel:not(.hidden) .card');
  await page.screenshot({ path: `${OUT}/${label}-evolucao.png` });
  const opts = await page.evaluate(() => window.__mutant.game.offer.opts);
  await page.click('.evo-panel .card >> nth=0');
  await page.waitForFunction((m) => window.__mutant.game.me.muts.includes(m), opts[0], { timeout: 3000 }).catch(() => fail(`${label}: mutação escolhida não foi aplicada`));
  console.log(`${label}: escolheu ${opts[0]} entre ${opts.join(', ')}`);
  const abil = await page.evaluate(() => window.__mutant.game.me.abilities);
  if (abil.length) {
    await page.click('.pw.main');
    await page.waitForFunction(() => Object.keys(window.__mutant.game.me.cds).length > 0, null, { timeout: 2000 })
      .then(() => console.log(`${label}: habilidade ${abil[0]} usada (recarga ativa)`))
      .catch(() => fail(`${label}: habilidade não entrou em recarga`));
  }
  await wait(600);
  await page.screenshot({ path: `${OUT}/${label}-arena.png` });

  // espera o fim da partida curta
  await page.waitForSelector('#results:not(.hidden)', { timeout: 75000 });
  await wait(400);
  await page.screenshot({ path: `${OUT}/${label}-resultados.png` });
  const dl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  await page.click('#share');
  const got = await dl;
  const status = await page.textContent('.share-status');
  console.log(`${label}: compartilhar → "${status}"${got ? ' (download: ' + got.suggestedFilename() + ')' : ''}`);
  if (!status) fail(`${label}: sem retorno do compartilhamento`);
  await ctx.close();
}

await run('Desktop', { viewport: { width: 1280, height: 720 } });
await run('Celular', { ...devices['Pixel 7'] });
if (errors.length) fail('erros no navegador:\n' + errors.join('\n'));
await browser.close();
console.log(process.exitCode ? 'E2E OFFLINE COM FALHAS' : 'E2E OFFLINE OK');
