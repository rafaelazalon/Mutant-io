import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LOOK, sanitizeLook, type Look } from '@mutant/shared';

/** Conta de jogador (sem e-mail nem senha: identificada por um código secreto de recuperação). */
export interface Account {
  id: string;
  secretHash: string;
  createdAt: number;
  owned: string[];
  look: Look;
}

export type OrderStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';

export interface Order {
  id: string;
  accountId: string;
  itemId: string;
  priceCents: number;
  status: OrderStatus;
  createdAt: number;
  paidAt?: number;
  providerRef?: string;
  paymentId?: string;
  lastSyncAt?: number;
}

/**
 * Armazenamento de contas e pedidos. Toda alteração passa por `updateX(id, mutate)`,
 * que é atômica (arquivo: execução síncrona; PostgreSQL: transação com SELECT … FOR UPDATE).
 */
export interface AccountStore {
  init(): Promise<void>;
  createAccount(a: Account): Promise<void>;
  getAccount(id: string): Promise<Account | null>;
  getAccountBySecretHash(hash: string): Promise<Account | null>;
  updateAccount(id: string, mutate: (a: Account) => void): Promise<Account | null>;
  createOrder(o: Order): Promise<void>;
  getOrder(id: string): Promise<Order | null>;
  updateOrder(id: string, mutate: (o: Order) => void): Promise<Order | null>;
  countOrdersSince(accountId: string, since: number): Promise<number>;
  /** Registra um pagamento processado; false se já tinha sido registrado (evita entrega dupla). */
  recordPayment(paymentId: string, orderId: string, status: string): Promise<boolean>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Código secreto                                                      */
/* ------------------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código de recuperação no formato MX-XXXX-XXXX-XXXX-XXXX (~80 bits). */
export function newSecret(): string {
  const b = randomBytes(16);
  const chars = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
  return `MX-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(`mutantio:${secret.trim().toUpperCase()}`).digest('hex');
}

export function isSecretFormat(s: unknown): s is string {
  return typeof s === 'string' && /^MX(-[A-Z2-9]{4}){4}$/.test(s.trim().toUpperCase());
}

export function newAccount(secret: string): Account {
  return { id: randomUUID(), secretHash: hashSecret(secret), createdAt: Date.now(), owned: [], look: { ...DEFAULT_LOOK } };
}

export function newOrderId(): string {
  return `ord_${randomBytes(12).toString('hex')}`;
}

/* ------------------------------------------------------------------ */
/* Arquivo JSON                                                         */
/* ------------------------------------------------------------------ */

interface FileData {
  accounts: Record<string, Account>;
  bySecret: Record<string, string>;
  orders: Record<string, Order>;
  payments: Record<string, { orderId: string; status: string; at: number }>;
}

/**
 * Armazenamento em arquivo (desenvolvimento ou servidor com disco persistente).
 * ATENÇÃO: em hospedagens com disco temporário (ex.: Render gratuito), os dados somem
 * a cada novo deploy — use DATABASE_URL (PostgreSQL) em produção.
 */
export class FileAccountStore implements AccountStore {
  private data: FileData = { accounts: {}, bySecret: {}, orders: {}, payments: {} };
  private file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    this.file = join(dir, 'mutant-store.json');
    mkdirSync(dir, { recursive: true });
  }

  async init() {
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileData>;
      this.data = { accounts: raw.accounts ?? {}, bySecret: raw.bySecret ?? {}, orders: raw.orders ?? {}, payments: raw.payments ?? {} };
      for (const a of Object.values(this.data.accounts)) a.look = sanitizeLook(a.look);
    }
  }

  private save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.file);
    } catch (e) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'store_write_failed', err: String(e) }));
    }
  }

  private clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
  }

  async createAccount(a: Account) {
    this.data.accounts[a.id] = this.clone(a);
    this.data.bySecret[a.secretHash] = a.id;
    this.save();
  }
  async getAccount(id: string) {
    const a = this.data.accounts[id];
    return a ? this.clone(a) : null;
  }
  async getAccountBySecretHash(hash: string) {
    const id = this.data.bySecret[hash];
    return id ? this.getAccount(id) : null;
  }
  async updateAccount(id: string, mutate: (a: Account) => void) {
    const a = this.data.accounts[id];
    if (!a) return null;
    mutate(a);
    this.save();
    return this.clone(a);
  }
  async createOrder(o: Order) {
    this.data.orders[o.id] = this.clone(o);
    this.save();
  }
  async getOrder(id: string) {
    const o = this.data.orders[id];
    return o ? this.clone(o) : null;
  }
  async updateOrder(id: string, mutate: (o: Order) => void) {
    const o = this.data.orders[id];
    if (!o) return null;
    mutate(o);
    this.save();
    return this.clone(o);
  }
  async countOrdersSince(accountId: string, since: number) {
    let n = 0;
    for (const o of Object.values(this.data.orders)) if (o.accountId === accountId && o.createdAt >= since) n++;
    return n;
  }
  async recordPayment(paymentId: string, orderId: string, status: string) {
    const key = `${paymentId}:${status}`;
    if (this.data.payments[key]) return false;
    this.data.payments[key] = { orderId, status, at: Date.now() };
    this.save();
    return true;
  }
  async close() {
    this.flush();
  }
}

/* ------------------------------------------------------------------ */
/* PostgreSQL                                                           */
/* ------------------------------------------------------------------ */

type PgClient = { query: (q: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>; release: () => void };
type PgPool = { connect: () => Promise<PgClient>; query: PgClient['query']; end: () => Promise<void> };

/**
 * Armazenamento em PostgreSQL (produção). Usa o pacote `pg`, instalado pelo `npm install`
 * na hospedagem. Ativado automaticamente quando DATABASE_URL está definida.
 */
export class PgAccountStore implements AccountStore {
  private pool!: PgPool;
  constructor(private readonly url: string) {}

  async init() {
    // nome em variável: o pacote só é exigido quando DATABASE_URL está configurada
    const pkg = 'pg';
    const mod = (await import(pkg)) as unknown as { default?: { Pool: new (o: unknown) => PgPool }; Pool?: new (o: unknown) => PgPool };
    const Pool = mod.Pool ?? mod.default!.Pool;
    const ssl = /localhost|127\.0\.0\.1/.test(this.url) ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString: this.url, ssl, max: 5 });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS mx_accounts (
        id TEXT PRIMARY KEY,
        secret_hash TEXT UNIQUE NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS mx_orders (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mx_orders_account ON mx_orders (account_id, created_at);
      CREATE TABLE IF NOT EXISTS mx_payments (
        key TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        status TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);
  }

  private async tx<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async createAccount(a: Account) {
    await this.pool.query('INSERT INTO mx_accounts (id, secret_hash, data) VALUES ($1, $2, $3)', [a.id, a.secretHash, JSON.stringify(a)]);
  }
  async getAccount(id: string) {
    const r = await this.pool.query('SELECT data FROM mx_accounts WHERE id = $1', [id]);
    return (r.rows[0]?.data as Account) ?? null;
  }
  async getAccountBySecretHash(hash: string) {
    const r = await this.pool.query('SELECT data FROM mx_accounts WHERE secret_hash = $1', [hash]);
    return (r.rows[0]?.data as Account) ?? null;
  }
  async updateAccount(id: string, mutate: (a: Account) => void) {
    return this.tx(async (c) => {
      const r = await c.query('SELECT data FROM mx_accounts WHERE id = $1 FOR UPDATE', [id]);
      const a = r.rows[0]?.data as Account | undefined;
      if (!a) return null;
      mutate(a);
      await c.query('UPDATE mx_accounts SET data = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(a)]);
      return a;
    });
  }
  async createOrder(o: Order) {
    await this.pool.query('INSERT INTO mx_orders (id, account_id, created_at, data) VALUES ($1, $2, $3, $4)', [o.id, o.accountId, o.createdAt, JSON.stringify(o)]);
  }
  async getOrder(id: string) {
    const r = await this.pool.query('SELECT data FROM mx_orders WHERE id = $1', [id]);
    return (r.rows[0]?.data as Order) ?? null;
  }
  async updateOrder(id: string, mutate: (o: Order) => void) {
    return this.tx(async (c) => {
      const r = await c.query('SELECT data FROM mx_orders WHERE id = $1 FOR UPDATE', [id]);
      const o = r.rows[0]?.data as Order | undefined;
      if (!o) return null;
      mutate(o);
      await c.query('UPDATE mx_orders SET data = $2 WHERE id = $1', [id, JSON.stringify(o)]);
      return o;
    });
  }
  async countOrdersSince(accountId: string, since: number) {
    const r = await this.pool.query('SELECT count(*)::int AS n FROM mx_orders WHERE account_id = $1 AND created_at >= $2', [accountId, since]);
    return Number(r.rows[0]?.n ?? 0);
  }
  async recordPayment(paymentId: string, orderId: string, status: string) {
    const r = await this.pool.query('INSERT INTO mx_payments (key, order_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [`${paymentId}:${status}`, orderId, status]);
    return (r.rowCount ?? 0) > 0;
  }
  async close() {
    await this.pool?.end();
  }
}
