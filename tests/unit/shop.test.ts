import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { COSMETICS, DEFAULT_LOOK, restrictLook, sanitizeLook } from '@mutant/shared';
import { FileAccountStore, hashSecret } from '../../apps/server/src/persistence/accounts.js';
import { FakeProvider, MercadoPagoProvider } from '../../apps/server/src/payments/provider.js';
import { ShopError, ShopService } from '../../apps/server/src/shop/shopService.js';

const dirs: string[] = [];
const stores: FileAccountStore[] = [];
async function makeShop() {
  const dir = mkdtempSync(join(tmpdir(), 'mx-shop-'));
  dirs.push(dir);
  const store = new FileAccountStore(dir);
  stores.push(store);
  await store.init();
  const provider = new FakeProvider();
  const shop = new ShopService(store, provider, { publicUrl: 'https://jogo.exemplo' });
  return { store, provider, shop, dir };
}
after(async () => {
  for (const s of stores) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('catálogo de aparências', () => {
  it('tem itens grátis em todos os espaços e pagos a R$ 1,00', () => {
    for (const slot of ['cor', 'padrao', 'olhos', 'acessorio', 'rastro']) {
      assert.ok(COSMETICS.some((c) => c.slot === slot && c.priceCents === 0));
      assert.ok(COSMETICS.some((c) => c.slot === slot && c.priceCents === 100));
    }
    assert.equal(new Set(COSMETICS.map((c) => c.id)).size, COSMETICS.length);
  });

  it('aparência inválida ou não comprada volta ao padrão', () => {
    assert.deepEqual(sanitizeLook({ cor: 'cor.inexistente', olhos: 'cor.ouro' }), DEFAULT_LOOK);
    const l = sanitizeLook({ cor: 'cor.ouro', acessorio: 'acessorio.coroa' });
    assert.equal(restrictLook(l, new Set(['cor.ouro'])).acessorio, 'acessorio.nenhum');
    assert.equal(restrictLook(l, new Set(['cor.ouro'])).cor, 'cor.ouro');
  });
});

describe('loja (regras do servidor)', () => {
  it('fluxo completo: conta → pedido → pagamento aprovado → item liberado e equipável', async () => {
    const { shop, provider } = await makeShop();
    const { secret } = await shop.createAccount();
    const a = await shop.auth(secret);
    const { orderId, url } = await shop.startCheckout(a, 'acessorio.coroa');
    assert.ok(url.includes(orderId));
    // antes de pagar não pode equipar
    assert.equal((await shop.setLook(a, { acessorio: 'acessorio.coroa' })).look.acessorio, 'acessorio.nenhum');
    const p = provider.pay(orderId);
    await shop.handleNotification(p.id);
    const st = await shop.orderStatus(await shop.auth(secret), orderId);
    assert.equal(st.status, 'paid');
    assert.ok(st.account.owned.includes('acessorio.coroa'));
    const a2 = await shop.auth(secret);
    assert.equal((await shop.setLook(a2, { acessorio: 'acessorio.coroa' })).look.acessorio, 'acessorio.coroa');
  });

  it('aviso repetido do pagamento não duplica nada', async () => {
    const { shop, provider, store } = await makeShop();
    const { secret } = await shop.createAccount();
    const { orderId } = await shop.startCheckout(await shop.auth(secret), 'cor.ouro');
    const p = provider.pay(orderId);
    for (let i = 0; i < 5; i++) await shop.handleNotification(p.id);
    const acc = await store.getAccountBySecretHash(hashSecret(secret));
    assert.deepEqual(acc!.owned, ['cor.ouro']);
  });

  it('pagamento com valor menor ou outra moeda não libera o item', async () => {
    const { shop, provider } = await makeShop();
    const { secret } = await shop.createAccount();
    const { orderId } = await shop.startCheckout(await shop.auth(secret), 'cor.lava');
    const p = provider.pay(orderId, 'approved', 50);
    await shop.handleNotification(p.id);
    const st = await shop.orderStatus(await shop.auth(secret), orderId);
    assert.equal(st.status, 'pending');
    assert.ok(!st.account.owned.includes('cor.lava'));
  });

  it('pagamento recusado não libera; estorno retira o item e a aparência equipada', async () => {
    const { shop, provider } = await makeShop();
    const { secret } = await shop.createAccount();
    const { orderId } = await shop.startCheckout(await shop.auth(secret), 'rastro.fogo');
    const rej = provider.pay(orderId, 'rejected');
    await shop.handleNotification(rej.id);
    assert.ok(!(await shop.orderStatus(await shop.auth(secret), orderId)).account.owned.includes('rastro.fogo'));
    const ok = provider.pay(orderId, 'approved');
    await shop.handleNotification(ok.id);
    await shop.setLook(await shop.auth(secret), { rastro: 'rastro.fogo' });
    provider.payments.set(ok.id, { ...ok, status: 'refunded' });
    await shop.handleNotification(ok.id);
    const st = await shop.orderStatus(await shop.auth(secret), orderId);
    assert.equal(st.status, 'refunded');
    assert.ok(!st.account.owned.includes('rastro.fogo'));
    assert.equal(st.account.look.rastro, 'rastro.nenhum');
  });

  it('recusa item grátis, item inexistente, item já comprado e pedido de outra conta', async () => {
    const { shop, provider } = await makeShop();
    const { secret } = await shop.createAccount();
    const a = await shop.auth(secret);
    await assert.rejects(shop.startCheckout(a, 'cor.natural'), (e: ShopError) => e.code === 'bad_item');
    await assert.rejects(shop.startCheckout(a, 'cor.diamante'), (e: ShopError) => e.code === 'bad_item');
    const { orderId } = await shop.startCheckout(a, 'olhos.robo');
    await shop.handleNotification(provider.pay(orderId).id);
    await assert.rejects(shop.startCheckout(await shop.auth(secret), 'olhos.robo'), (e: ShopError) => e.code === 'owned');
    const other = await shop.createAccount();
    await assert.rejects(shop.orderStatus(await shop.auth(other.secret), orderId), (e: ShopError) => e.code === 'not_found');
  });

  it('código de recuperação errado é recusado; o certo restaura as compras', async () => {
    const { shop, provider, dir } = await makeShop();
    const { secret } = await shop.createAccount();
    const { orderId } = await shop.startCheckout(await shop.auth(secret), 'padrao.tigre');
    await shop.handleNotification(provider.pay(orderId).id);
    await assert.rejects(shop.auth('MX-AAAA-AAAA-AAAA-AAAA'), (e: ShopError) => e.status === 401);
    await assert.rejects(shop.auth('qualquer coisa'), (e: ShopError) => e.status === 401);
    // reabre o armazenamento do disco (simula reinício do servidor)
    const store2 = new FileAccountStore(dir);
    await new Promise((r) => setTimeout(r, 250));
    await store2.init();
    const shop2 = new ShopService(store2, provider, { publicUrl: 'https://jogo.exemplo' });
    assert.ok((await shop2.auth(secret.toLowerCase())).owned.includes('padrao.tigre'));
  });

  it('se o banco do jogo se perder, as compras voltam a partir do provedor de pagamento', async () => {
    const { shop, provider } = await makeShop();
    const { secret } = await shop.createAccount();
    const a = await shop.auth(secret);
    const { orderId } = await shop.startCheckout(a, 'cor.ouro');
    await shop.handleNotification(provider.pay(orderId).id);
    // servidor recriado: banco novo e vazio, mesmo provedor (o Mercado Pago guarda os pagamentos)
    const dir = mkdtempSync(join(tmpdir(), 'mx-shop-'));
    dirs.push(dir);
    const fresh = new FileAccountStore(dir);
    stores.push(fresh);
    await fresh.init();
    const shop2 = new ShopService(fresh, provider, { publicUrl: 'https://jogo.exemplo' });
    const back = await shop2.auth(secret);
    assert.deepEqual(back.owned, ['cor.ouro']);
    // código sem compras continua sendo recusado
    await assert.rejects(shop2.auth('MX-AAAA-BBBB-CCCC-DDDD'), ShopError);
  });

  it('limita pedidos por hora', async () => {
    const { shop } = await makeShop();
    const s2 = new ShopService((shop as unknown as { store: FileAccountStore }).store, new FakeProvider(), { publicUrl: 'https://x', maxOrdersPerHour: 3 });
    const { secret } = await s2.createAccount();
    const a = await s2.auth(secret);
    for (const id of ['cor.neon', 'cor.ouro', 'cor.lava']) await s2.startCheckout(a, id);
    await assert.rejects(s2.startCheckout(a, 'cor.gelo'), (e: ShopError) => e.code === 'rate');
  });

  it('sem provedor configurado a compra fica desativada', async () => {
    const { store } = await makeShop();
    const shop = new ShopService(store, null, { publicUrl: '' });
    const { secret } = await shop.createAccount();
    assert.equal(shop.paymentsEnabled, false);
    await assert.rejects(shop.startCheckout(await shop.auth(secret), 'cor.neon'), (e: ShopError) => e.code === 'payments_off');
  });

  it('a aparência na partida só usa o que a conta possui', async () => {
    const { shop, provider } = await makeShop();
    const { secret } = await shop.createAccount();
    const { orderId } = await shop.startCheckout(await shop.auth(secret), 'cor.galaxia');
    await shop.handleNotification(provider.pay(orderId).id);
    const look = await shop.lookFor(secret, sanitizeLook({ cor: 'cor.galaxia', acessorio: 'acessorio.coroa' }));
    assert.equal(look.cor, 'cor.galaxia');
    assert.equal(look.acessorio, 'acessorio.nenhum');
    const anon = await shop.lookFor(undefined, sanitizeLook({ cor: 'cor.galaxia' }));
    assert.equal(anon.cor, 'cor.natural');
  });
});

describe('Mercado Pago (API simulada localmente)', () => {
  let server: Server;
  let base = '';
  const seen: { method: string; url: string; body: unknown; auth: string | undefined; idem: string | undefined }[] = [];
  const payments = new Map<string, unknown>();
  before(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization, idem: req.headers['x-idempotency-key'] as string | undefined });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/checkout/preferences' && req.method === 'POST') return res.end(JSON.stringify({ id: 'pref_123', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref_123' }));
        const pm = /^\/v1\/payments\/(\d+)$/.exec(req.url!);
        if (pm) {
          const p = payments.get(pm[1]!);
          if (!p) return (res.statusCode = 404), res.end('{}');
          return res.end(JSON.stringify(p));
        }
        if (req.url!.startsWith('/v1/payments/search')) {
          const ref = new URL(req.url!, 'http://x').searchParams.get('external_reference');
          return res.end(JSON.stringify({ results: [...payments.values()].filter((p) => (p as { external_reference: string }).external_reference === ref) }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
  });
  after(() => server.close());

  it('cria a preferência com cartão/Pix (sem boleto), R$ 1,00 em BRL, retorno e aviso no endereço público', async () => {
    const mp = new MercadoPagoProvider('TEST-token', '', base);
    const r = await mp.createCheckout({ orderId: 'ord_aaaaaaaaaaaaaaaaaaaaaaaa', accountId: 'a123', itemId: 'cor.neon', title: 'MUTANT.IO — Neon', priceCents: 100, publicUrl: 'https://jogo.exemplo' });
    assert.equal(r.providerRef, 'pref_123');
    assert.ok(r.url.startsWith('https://www.mercadopago.com.br/'));
    const call = seen.find((s) => s.url === '/checkout/preferences')!;
    assert.deepEqual((call.body as { metadata?: unknown }).metadata, { acct: 'a123', item: 'cor.neon' });
    assert.equal(call.auth, 'Bearer TEST-token');
    assert.equal(call.idem, 'ord_aaaaaaaaaaaaaaaaaaaaaaaa');
    const b = call.body as Record<string, any>;
    assert.equal(b.items[0].unit_price, 1);
    assert.equal(b.items[0].currency_id, 'BRL');
    assert.equal(b.external_reference, 'ord_aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(b.notification_url, 'https://jogo.exemplo/api/webhooks/mercadopago');
    assert.deepEqual(b.payment_methods.excluded_payment_types, [{ id: 'ticket' }]);
    assert.ok(b.back_urls.success.includes('pedido=ord_aaaaaaaaaaaaaaaaaaaaaaaa'));
  });

  it('lê pagamento e busca por pedido', async () => {
    payments.set('555', { id: 555, status: 'approved', external_reference: 'ord_bbbbbbbbbbbbbbbbbbbbbbbb', transaction_amount: 1, currency_id: 'BRL', payment_type_id: 'credit_card' });
    const mp = new MercadoPagoProvider('TEST-token', '', base);
    const p = await mp.getPayment('555');
    assert.deepEqual(p, { id: '555', status: 'approved', orderId: 'ord_bbbbbbbbbbbbbbbbbbbbbbbb', amountCents: 100, currency: 'BRL', method: 'credit_card' });
    assert.equal(await mp.getPayment('../../etc'), null);
    assert.equal((await mp.findPaymentsForOrder('ord_bbbbbbbbbbbbbbbbbbbbbbbb')).length, 1);
  });

  it('confere a assinatura do aviso (x-signature)', () => {
    const secret = 'segredo-do-painel';
    const mp = new MercadoPagoProvider('t', secret, base);
    const ts = '1704908010';
    const v1 = createHmac('sha256', secret).update(`id:123456;request-id:req-1;ts:${ts};`).digest('hex');
    assert.equal(mp.verifyWebhook({ 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' }, '123456'), true);
    assert.equal(mp.verifyWebhook({ 'x-signature': `ts=${ts},v1=${v1.replace(/.$/, '0')}`, 'x-request-id': 'req-1' }, '123456'), false);
    assert.equal(mp.verifyWebhook({}, '123456'), false);
  });
});
