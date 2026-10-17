// Teste de ponta a ponta: dois navegadores reais (desktop + celular com toque)
// conectados ao mesmo servidor e à mesma sala.
// Uso: BASE_URL=http://localhost:2600 node tests/e2e/two-clients.mjs [pasta-de-capturas]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:2567';
const OUT = process.argv[2] || 'tests/e2e/screens';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FALHOU:', m); process.exitCode = 1; };

const browser = await chromium.launch();
const errors = [];
const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const mob = await browser.newContext({ ...devices['iPhone 13'] });
const a = await desk.newPage();
const b = await mob.newPage();
for (const [n, p] of [['desktop', a], ['celular', b]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`${n} console: ${m.text()}`));
}

await a.goto(BASE);
await a.waitForSelector('#status.ok', { timeout: 5000 });
await a.screenshot({ path: `${OUT}/01-titulo-desktop.png` });
await a.fill('#name', 'Alice');
await a.click('#create');
await a.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
const code = await a.evaluate(() => window.__mutant.game.welcome.room.code);
console.log('sala privada criada:', code);

// celular entra pelo link de convite
await b.goto(`${BASE}/?sala=${code}`);
await b.waitForSelector('#status.ok', { timeout: 5000 });
await b.screenshot({ path: `${OUT}/02-titulo-celular.png` });
await b.fill('#name', 'Bruno');
await b.tap('#join-code');
await b.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
const roomB = await b.evaluate(() => window.__mutant.game.welcome.room.code);
if (roomB !== code) fail(`celular entrou em outra sala (${roomB})`);

// desktop anda com o teclado
await wait(5500); // preparação
const p0 = await a.evaluate(() => ({ ...window.__mutant.game.me }));
await a.keyboard.down('KeyD');
await wait(900);
await a.keyboard.up('KeyD');
await wait(400);
const p1 = await a.evaluate(() => ({ ...window.__mutant.game.me }));
console.log('desktop moveu (servidor):', Math.round(p1.x - p0.x), 'px em x');
if (p1.x - p0.x < 100) fail('movimento por teclado não refletiu no servidor');

// celular usa o joystick virtual (toque arrastando no lado esquerdo)
const q0 = await b.evaluate(() => ({ ...window.__mutant.game.me }));
const cdp = await mob.newCDPSession(b);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
await touch('touchStart', 90, 600);
for (let i = 1; i <= 6; i++) { await touch('touchMove', 90, 600 - i * 12); await wait(30); }
await wait(900);
await b.screenshot({ path: `${OUT}/03-joystick-celular.png` });
await touch('touchEnd', 0, 0);
await wait(400);
const q1 = await b.evaluate(() => ({ ...window.__mutant.game.me }));
console.log('celular moveu (servidor):', Math.round(q1.y - q0.y), 'px em y');
if (q0.y - q1.y < 100) fail('joystick não moveu o personagem');

// desktop caminha até o celular até os dois se enxergarem (área de interesse)
const idB = await b.evaluate(() => window.__mutant.game.me.id);
const idA = await a.evaluate(() => window.__mutant.game.me.id);
let met = false;
const held = new Set();
const press = async (want) => {
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    if (want.has(k) && !held.has(k)) { await a.keyboard.down(k); held.add(k); }
    if (!want.has(k) && held.has(k)) { await a.keyboard.up(k); held.delete(k); }
  }
};
for (let i = 0; i < 120 && !met; i++) {
  const pa = await a.evaluate(() => window.__mutant.game.me);
  const pb = await b.evaluate(() => window.__mutant.game.me);
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const want = new Set();
  if (dx > 60) want.add('KeyD'); if (dx < -60) want.add('KeyA');
  if (dy > 60) want.add('KeyS'); if (dy < -60) want.add('KeyW');
  await press(want);
  met = await a.evaluate((id) => window.__mutant.game.remotes.has(id), idB) && Math.hypot(dx, dy) < 300;
  await wait(200);
}
await press(new Set());
const seesB = await a.evaluate((id) => window.__mutant.game.remotes.has(id), idB);
const seesA = await b.evaluate((id) => window.__mutant.game.remotes.has(id), idA);
const nameB = await a.evaluate((id) => window.__mutant.game.meta.get(id)?.name, idB);
console.log('desktop vê o celular:', seesB, '(' + nameB + ') · celular vê o desktop:', seesA);
if (!seesB || !seesA || nameB !== 'Bruno') fail('os dois clientes não se enxergaram na mesma arena');
const meB = await b.evaluate(() => window.__mutant.game.me);
await a.screenshot({ path: `${OUT}/04-arena-desktop.png` });
await b.screenshot({ path: `${OUT}/05-arena-celular.png` });

// queda de conexão + reconexão com token
await b.evaluate(() => window.__mutant.game.conn.ws.close(4000));
await b.waitForFunction(() => window.__mutant.game?.welcome?.reconnected === true && !!window.__mutant.game.me, null, { timeout: 8000 }).catch(() => fail('reconexão não aconteceu'));
const after = await b.evaluate(() => window.__mutant.game.me?.id);
console.log('reconectado como jogador', after, '(antes', meB.id + ')');
if (after !== meB.id) fail('reconectou como outro jogador');

const health = await (await fetch(`${BASE}/health`)).json();
console.log('health:', JSON.stringify(health));
if (errors.length) fail('erros no navegador:\n' + errors.join('\n'));
await browser.close();
console.log(process.exitCode ? 'E2E COM FALHAS' : 'E2E OK');
