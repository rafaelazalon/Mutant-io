// Loja de ponta a ponta com pagamento SIMULADO (servidor com PAYMENTS_MODE=fake):
// abrir a loja → comprar → página de pagamento → voltar → item liberado → outro jogador vê o visual.
// Uso: BASE_URL=http://localhost:2567 node tests/e2e/shop-flow.mjs [pasta]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:2567';
const OUT = process.argv[2] || 'tests/e2e/screens';
mkdirSync(OUT, { recursive: true });
const fail = (m) => { console.error('FALHOU:', m); process.exitCode = 1; };
const b = await chromium.launch();
const errors = [];
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.click('#open-shop');
await page.waitForSelector('#shop:not(.hidden) .sitem');
await page.waitForFunction(() => !!window.__mutant.account.secret, null, { timeout: 5000 });
const secret = await page.evaluate(() => window.__mutant.account.secret);
console.log('conta criada:', secret.replace(/-[A-Z2-9]{4}-[A-Z2-9]{4}$/, '-****-****'));
await page.screenshot({ path: `${OUT}/loja-cores.png` });

// tentar equipar item pago sem comprar não funciona (servidor recusa)
await page.evaluate(() => window.__mutant.account.equip({ ...window.__mutant.account.look, acessorio: 'acessorio.coroa' }));
const sneaky = await page.evaluate(() => window.__mutant.account.look.acessorio);
if (sneaky !== 'acessorio.nenhum') fail('conseguiu equipar item não comprado');

await page.click('.shop-tabs [data-slot="acessorio"]');
await page.click('.sitem[data-id="acessorio.coroa"] [data-act="buy"]');
await page.waitForSelector('.shop-sheet:not(.hidden)');
await page.screenshot({ path: `${OUT}/loja-confirmar.png` });
await Promise.all([page.waitForURL(/\/api\/dev\/checkout\//), page.click('[data-s="go"]')]);
await page.click('#pay');
await page.waitForURL((u) => !u.pathname.startsWith('/api/'), { timeout: 8000 });
await page.waitForFunction(() => document.querySelector('.shop-status')?.textContent?.includes('aprovada'), null, { timeout: 15000 }).catch(() => fail('não confirmou a compra'));
await page.screenshot({ path: `${OUT}/loja-aprovada.png` });
const owned = await page.evaluate(() => [...window.__mutant.account.owned]);
const look = await page.evaluate(() => window.__mutant.account.look);
console.log('possui:', owned.join(', '), '· equipado:', look.acessorio);
if (!owned.includes('acessorio.coroa') || look.acessorio !== 'acessorio.coroa') fail('item não liberado/equipado');

// entra online numa sala e um segundo jogador (sem conta) confere o visual recebido do servidor
await page.click('.shop-close');
await page.fill('#name', 'Comprador');
await page.click('#create');
await page.waitForFunction(() => !!window.__mutant.game?.welcome, null, { timeout: 8000 });
const code = await page.evaluate(() => window.__mutant.game.welcome.room.code);
const myId = await page.evaluate(() => window.__mutant.game.welcome.you);
const ctx2 = await b.newContext({ viewport: { width: 1000, height: 700 } });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
// o segundo jogador tenta "forjar" uma coroa sem ter comprado
await p2.addInitScript(() => localStorage.setItem('mutantio.account.v1', JSON.stringify({ secret: null, owned: ['cor.ouro'], look: { cor: 'cor.ouro', padrao: 'padrao.liso', olhos: 'olhos.padrao', acessorio: 'acessorio.nenhum', rastro: 'rastro.nenhum' } })));
await p2.goto(`${BASE}/?sala=${code}`);
await p2.fill('#name', 'Espiao');
await p2.click('#join-code');
await p2.waitForFunction((id) => window.__mutant.game?.meta?.get(id)?.look, myId, { timeout: 10000 });
const seen = await p2.evaluate((id) => window.__mutant.game.meta.get(id).look, myId);
const p2Id = await p2.evaluate(() => window.__mutant.game.welcome.you);
await page.waitForFunction((id) => window.__mutant.game?.meta?.get(id)?.look, p2Id, { timeout: 10000 });
const forged = await page.evaluate((id) => window.__mutant.game.meta.get(id).look, p2Id);
console.log('outro jogador vê:', seen.acessorio, '· visual forjado chegou como:', forged.cor);
if (seen.acessorio !== 'acessorio.coroa') fail('outro jogador não viu a coroa');
if (forged.cor !== 'cor.natural') fail('servidor aceitou visual não comprado');
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/jogo-com-coroa.png` });
if (errors.length) fail('erros no navegador: ' + errors.join(' | '));
await b.close();
console.log(process.exitCode ? 'LOJA COM FALHAS' : 'LOJA OK');
