import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { GAME_CONFIG, parseC2S, sanitizeName, type S2C } from '@mutant/shared';
import { ENV } from './env.js';
import { log } from './logger.js';
import { RoomManager } from './matchmaking/roomManager.js';
import { MemoryStatsRepository } from './persistence/statsRepository.js';
import { ConnectionGuard, IpLimiter, originAllowed } from './security/guard.js';
import { FileAccountStore, PgAccountStore, type AccountStore } from './persistence/accounts.js';
import { FakeProvider, MercadoPagoProvider, type PaymentProvider } from './payments/provider.js';
import { ShopService } from './shop/shopService.js';
import { createShopApi } from './shop/api.js';
import { JoinNotifier } from './notify/notifier.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const staticRoot = resolve(ENV.staticDir || join(here, '../../client/dist'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const stats = new MemoryStatsRepository();
const sockets = new Map<string, WebSocket>();
const startedAt = Date.now();

function sendTo(clientId: string, msg: S2C) {
  const ws = sockets.get(clientId);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const rooms = new RoomManager(sendTo, stats);

/* ---------------- loja: contas, pedidos e pagamentos ---------------- */
const store: AccountStore = ENV.databaseUrl ? new PgAccountStore(ENV.databaseUrl) : new FileAccountStore(ENV.dataDir);
let provider: PaymentProvider | null = null;
if (ENV.paymentsMode === 'mercadopago' && ENV.mpAccessToken) provider = new MercadoPagoProvider(ENV.mpAccessToken, ENV.mpWebhookSecret, ENV.mpApiBase);
else if (ENV.paymentsMode === 'fake' && !ENV.production) provider = new FakeProvider();
const shop = new ShopService(store, provider, { publicUrl: ENV.publicUrl || (provider instanceof FakeProvider ? `http://localhost:${ENV.port}` : ''), log });
const shopApi = createShopApi(shop, { clientIp: (r) => clientIp(r), devMode: !ENV.production });
if (ENV.paymentsMode === 'mercadopago' && !ENV.publicUrl) log('warn', 'shop_public_url_missing', { hint: 'defina PUBLIC_URL para ativar os pagamentos' });
const notifier = new JoinNotifier({ url: ENV.notifyUrl, minGapSec: ENV.notifyMinGapSec, onError: (e) => log('warn', 'notify_failed', { err: String(e) }) });
if (!ENV.databaseUrl) log('warn', 'shop_file_store', { dir: ENV.dataDir, hint: 'em produção use DATABASE_URL para não perder compras' });

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !extname(rel)) rel = '/index.html';
  const file = normalize(join(staticRoot, rel));
  if (!file.startsWith(staticRoot + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    const body = { ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), ...rooms.summary(), stats: await stats.summary() };
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    return;
  }
  // vínculo do app Android (Trusted Web Activity) com o site — gerado pelo PWABuilder
  if (req.url === '/.well-known/assetlinks.json' && process.env.ASSETLINKS_JSON) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(process.env.ASSETLINKS_JSON);
    return;
  }
  if (req.url?.startsWith('/api/')) {
    await shopApi(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

const ipLimiter = new IpLimiter();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: GAME_CONFIG.net.maxMessageBytes });

function clientIp(req: IncomingMessage): string {
  if (ENV.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if (!originAllowed(req.headers.origin)) {
    log('warn', 'origin_rejected', { origin: req.headers.origin });
    ws.close(1008, 'origin');
    return;
  }
  if (!ipLimiter.acquire(ip)) {
    ws.send(JSON.stringify({ t: 'kicked', reason: 'Muitas conexões deste endereço.' } satisfies S2C));
    ws.close(1008, 'ip_limit');
    return;
  }
  const id = randomUUID();
  const guard = new ConnectionGuard();
  let alive = true;
  let joined = false;
  let joining = false;
  sockets.set(id, ws);

  ws.on('pong', () => (alive = true));
  const hb = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 10000);

  ws.on('message', async (data, isBinary) => {
    if (isBinary || !guard.allow()) return kickIfNeeded();
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      guard.invalid();
      return kickIfNeeded();
    }
    const msg = parseC2S(raw);
    if (!msg) {
      guard.invalid();
      return kickIfNeeded();
    }
    if (msg.t === 'join') {
      if (joining) return;
      joining = true;
      // aparência: só o que a conta realmente comprou (o cliente não decide)
      const look = await shop.lookFor(msg.acct, msg.look).catch(() => undefined);
      joining = false;
      if (ws.readyState !== WebSocket.OPEN) return;
      const r = rooms.join(id, msg.name, msg.mode, msg.code, msg.token, look);
      if (!r.ok) {
        sendTo(id, { t: 'error', code: r.reason, msg: errorText(r.reason) });
        return;
      }
      joined = true;
      if (!r.reconnected) notifier.playerJoined(sanitizeName(msg.name), rooms.summary().players);
      return;
    }
    if (!joined) return;
    rooms.handle(id, msg);
    if (msg.t === 'leave') joined = false;
    kickIfNeeded();
  });

  function kickIfNeeded() {
    if (!guard.shouldKick) return;
    log('warn', 'kicked', { ip, violations: guard.violations });
    sendTo(id, { t: 'kicked', reason: 'Mensagens inválidas ou em excesso.' });
    ws.close(1008, 'abuse');
  }

  ws.on('close', () => {
    clearInterval(hb);
    sockets.delete(id);
    ipLimiter.release(ip);
    rooms.leave(id, false);
  });
  ws.on('error', (e) => log('warn', 'ws_error', { err: String(e) }));
});

function errorText(code: string) {
  switch (code) {
    case 'room_not_found':
      return 'Sala não encontrada. Confira o código do convite.';
    case 'full':
      return 'A sala está cheia.';
    case 'server_full':
      return 'Servidor lotado. Tente novamente em instantes.';
    default:
      return 'Não foi possível entrar.';
  }
}

await store.init();
rooms.start();
server.listen(ENV.port, ENV.host, () => {
  log('info', 'listening', { port: ENV.port, host: ENV.host, static: existsSync(staticRoot) ? staticRoot : null });
});

function shutdown() {
  log('info', 'shutdown');
  rooms.stop();
  void store.close();
  for (const ws of sockets.values()) ws.close(1001, 'shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
