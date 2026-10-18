// Capturas das novidades: chuva de biomassa, célula dourada, setas fora da tela, coroa, efeitos de poderes.
// Uso: BASE_URL=http://localhost:2567 node tests/e2e/features-tour.mjs [pasta]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:2567';
const OUT = process.argv[2] || 'tests/e2e/screens';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
const errors = [];
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['celular', devices['Pixel 7']]]) {
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${BASE}/?duracao=180`);
  await wait(800);
  await page.fill('#name', label);
  await page.click('#practice');
  await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 15000 });
  await wait(600);
  // força eventos no mundo do treino offline (mesma simulação do servidor)
  await page.evaluate(() => {
    const room = window.__mutant.game.conn.room;
    const w = room.world;
    const me = [...w.players.values()].find((p) => !p.isBot);
    me.biomass = 120; // nível alto para ver o mutante crescido
    w.nextRainAt = 0;
    w.nextSuperAt = 0;
    // célula dourada perto, chuva longe (para a seta)
    window.__forceGold = () => { const c = w.pellets.get(w.superCellId); if (c) { me.x = c.x - 170; me.y = c.y + 50; } };
  });
  await wait(400);
  await page.evaluate(() => window.__forceGold());
  await wait(900);
  await page.screenshot({ path: `${OUT}/${label}-eventos.png` });
  // escolhe cartas para evoluir
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Digit1').catch(() => {}); await wait(150); }
  await wait(5500);
  await page.screenshot({ path: `${OUT}/${label}-chuva.png` });
  // poderes
  await page.evaluate(() => {
    const w = window.__mutant.game.conn.room.world;
    const me = [...w.players.values()].find((p) => !p.isBot);
    me.mutations = ['cauda_propulsora', 'salto_dimensional', 'escudo_organico', 'pulso_bioeletrico'];
    me.level = Math.max(me.level, 4);
    w.recompute(me);
  }).catch((e) => errors.push('poderes: ' + e.message));
  for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
    await page.keyboard.press(k);
    await wait(120);
  }
  await page.screenshot({ path: `${OUT}/${label}-poderes.png` });
  await wait(1500);
  await page.screenshot({ path: `${OUT}/${label}-poderes2.png` });
  await ctx.close();
}
await b.close();
console.log(errors.length ? 'ERROS:\n' + errors.join('\n') : 'sem erros no navegador');
