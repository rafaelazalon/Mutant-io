// Gera as imagens da ficha da Play Store em store/: ícone 512, imagem de destaque 1024x500 e capturas 1080x1920.
// Uso: BASE_URL=http://localhost:2567 node tests/e2e/store-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync, copyFileSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:2567';
const OUT = 'store';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
const phone = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

async function startPractice(page, name) {
  await page.goto(`${BASE}/?duracao=300`);
  await wait(900);
  await page.fill('#name', name);
  await page.click('#practice');
  await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 15000 });
  await page.addStyleTag({ content: '.mode-tag { display: none !important; }' });
  await wait(500);
}
const W = () => window.__mutant.game.conn.room.world;

// 1) título
{
  const ctx = await b.newContext(phone);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await wait(1500);
  await page.fill('#name', 'Rafa');
  await page.screenshot({ path: `${OUT}/1-titulo.png` });
  await ctx.close();
}
// 2) arena com eventos, 3) evolução, 4) poderes, 5) combate
{
  const ctx = await b.newContext(phone);
  const page = await ctx.newPage();
  await startPractice(page, 'Rafa');
  await page.evaluate(() => {
    const w = window.__mutant.game.conn.room.world;
    const me = [...w.players.values()].find((p) => !p.isBot);
    w.gainBiomass(me, 30, false);
    w.nextSuperAt = 0;
  });
  await wait(300);
  await page.evaluate(() => {
    const w = window.__mutant.game.conn.room.world;
    const me = [...w.players.values()].find((p) => !p.isBot);
    const c = w.pellets.get(w.superCellId);
    if (c) { me.x = c.x - 150; me.y = c.y + 120; }
  });
  await wait(1200);
  if (await page.isVisible('.evo-pill')) await page.click('.evo-pill');
  await wait(400);
  await page.screenshot({ path: `${OUT}/3-evolucao.png` });
  for (let i = 0; i < 6; i++) { await page.evaluate(() => { const o = window.__mutant.game.offer; if (o) window.__mutant.game.pick?.(0); }); await page.keyboard.press('Digit1'); await wait(250); }
  await page.evaluate(() => {
    const w = window.__mutant.game.conn.room.world;
    const me = [...w.players.values()].find((p) => !p.isBot);
    me.mutations = ['cauda_propulsora', 'escudo_organico', 'pulso_bioeletrico', 'espinhos_externos', 'carapaca_cristalina'];
    me.level = Math.max(me.level, 6);
    w.recompute(me);
    me.hp = me.stats.maxHp;
    // rivais por perto
    let k = 0;
    for (const o of w.players.values()) {
      if (o === me || k >= 3) continue;
      o.x = me.x + 140 + k * 70; o.y = me.y + (k - 1) * 110; k++;
    }
    w.nextRainAt = 0;
  });
  await wait(700);
  await page.keyboard.press('Digit3');
  await wait(180);
  await page.screenshot({ path: `${OUT}/2-combate.png` });
  await wait(6500);
  await page.keyboard.press('Digit2');
  await wait(150);
  await page.screenshot({ path: `${OUT}/4-poderes.png` });
  await ctx.close();
}
// imagem de destaque 1024x500: fundo animado do título + logo
{
  const ctx = await b.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await wait(1800);
  await page.addStyleTag({ content: `
    #title .title-wrap > *:not(.logo):not(#preview):not(.tagline) { display: none !important; }
    #title .title-wrap { zoom: 1.45 !important; }
    .footer, .status, footer { display: none !important; }` });
  await wait(600);
  await page.screenshot({ path: `${OUT}/destaque-1024x500.png` });
  await ctx.close();
}
await b.close();
copyFileSync('apps/client/public/icons/icon-512.png', `${OUT}/icone-512.png`);
console.log('ok');
