import type { IncomingMessage, ServerResponse } from 'node:http';
import { COSMETICS, ITEM_PRICE_CENTS, TokenBucket } from '@mutant/shared';
import { FakeProvider } from '../payments/provider.js';
import { ShopError, type ShopService } from './shopService.js';

const MAX_BODY = 16 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; json: unknown }> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ShopError('too_large', 413, 'Requisição grande demais.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({ raw, json: {} });
      try {
        resolve({ raw, json: JSON.parse(raw) });
      } catch {
        reject(new ShopError('bad_json', 400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return undefined;
  return h.slice(7).trim().toUpperCase();
}

const DEV_PAGE = (orderId: string) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pagamento simulado</title><style>body{font-family:system-ui;background:#0b1222;color:#eef4ff;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.c{max-width:360px;text-align:center;background:#16213d;padding:24px;border-radius:16px}button{font:inherit;padding:12px 18px;border-radius:12px;border:0;margin:6px;cursor:pointer}
.ok{background:#7dff6a}.no{background:#ff5f8f}</style></head><body><div class="c"><h2>Pagamento simulado</h2>
<p>Modo de testes: nenhum dinheiro é cobrado. Pedido <code>${orderId}</code>.</p>
<button class="ok" id="pay">Simular pagamento aprovado</button><button class="no" onclick="location.href='/?pedido=${orderId}&pagamento=recusado'">Cancelar</button>
<script>document.getElementById('pay').onclick=async()=>{await fetch('/api/dev/pay/${orderId}',{method:'POST'});location.href='/?pedido=${orderId}&pagamento=aprovado'}</script></div></body></html>`;

/**
 * Rotas /api da loja. Retorna true se tratou a requisição.
 */
export function createShopApi(shop: ShopService, opts: { clientIp: (req: IncomingMessage) => string; devMode: boolean }) {
  const buckets = new Map<string, TokenBucket>();
  const createBuckets = new Map<string, TokenBucket>();
  const allow = (map: Map<string, TokenBucket>, ip: string, rate: number, burst: number) => {
    let b = map.get(ip);
    if (!b) {
      if (map.size > 5000) map.clear();
      map.set(ip, (b = new TokenBucket(rate, burst)));
    }
    return b.take();
  };

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://x');
    const path = url.pathname;
    if (!path.startsWith('/api/')) return false;
    const ip = opts.clientIp(req);
    try {
      // aviso do Mercado Pago: sem limite por IP (vem dos servidores deles), responde rápido
      if (path === '/api/webhooks/mercadopago' && req.method === 'POST') {
        const body = (await readBody(req)).json as { type?: string; action?: string; data?: { id?: string | number } };
        const dataId = String(url.searchParams.get('data.id') ?? body?.data?.id ?? '');
        const type = url.searchParams.get('type') ?? body?.type ?? '';
        if (!dataId || (type && type !== 'payment')) return send(res, 200, { ok: true }), true;
        if (!shop.provider?.verifyWebhook(req.headers, dataId)) return send(res, 401, { error: 'assinatura inválida' }), true;
        send(res, 200, { ok: true });
        void shop.handleNotification(dataId).catch(() => {});
        return true;
      }

      if (!allow(buckets, ip, 1, 40)) throw new ShopError('rate', 429, 'Muitas requisições. Aguarde um pouco.');

      if (path === '/api/shop' && req.method === 'GET') {
        send(res, 200, { items: COSMETICS, priceCents: ITEM_PRICE_CENTS, payments: { enabled: shop.paymentsEnabled, methods: ['credito', 'debito', 'pix'], provider: shop.provider?.name ?? null } });
        return true;
      }
      if (path === '/api/account' && req.method === 'POST') {
        if (!allow(createBuckets, ip, 5 / 3600, 5)) throw new ShopError('rate', 429, 'Muitas contas criadas deste endereço.');
        send(res, 201, await shop.createAccount());
        return true;
      }
      if (path === '/api/account' && req.method === 'GET') {
        const a = await shop.auth(bearer(req));
        send(res, 200, { account: shop.view(a) });
        return true;
      }
      if (path === '/api/account/look' && req.method === 'PUT') {
        const a = await shop.auth(bearer(req));
        const { json } = await readBody(req);
        send(res, 200, { account: await shop.setLook(a, (json as { look?: unknown })?.look) });
        return true;
      }
      if (path === '/api/checkout' && req.method === 'POST') {
        const a = await shop.auth(bearer(req));
        const { json } = await readBody(req);
        send(res, 201, await shop.startCheckout(a, (json as { itemId?: unknown })?.itemId));
        return true;
      }
      const m = /^\/api\/orders\/([^/]+)$/.exec(path);
      if (m && req.method === 'GET') {
        const a = await shop.auth(bearer(req));
        send(res, 200, await shop.orderStatus(a, decodeURIComponent(m[1]!)));
        return true;
      }

      // somente modo de testes (PAYMENTS_MODE=fake, fora de produção)
      if (opts.devMode && shop.provider instanceof FakeProvider) {
        const dc = /^\/api\/dev\/checkout\/(ord_[a-f0-9]{24})$/.exec(path);
        if (dc && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DEV_PAGE(dc[1]!));
          return true;
        }
        const dp = /^\/api\/dev\/pay\/(ord_[a-f0-9]{24})$/.exec(path);
        if (dp && req.method === 'POST') {
          const p = shop.provider.pay(dp[1]!);
          await shop.handleNotification(p.id);
          send(res, 200, { ok: true, payment: p.id });
          return true;
        }
      }
      throw new ShopError('not_found', 404, 'Rota não encontrada.');
    } catch (e) {
      if (e instanceof ShopError) send(res, e.status, { error: e.message, code: e.code });
      else send(res, 500, { error: 'Erro interno.', code: 'internal' });
      return true;
    }
  };
}
