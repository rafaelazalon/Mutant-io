import { DEFAULT_LOOK, restrictLook, sanitizeLook, type CosmeticDef, type Look } from '@mutant/shared';

const ACC_KEY = 'mutantio.account.v1';
const PENDING_KEY = 'mutantio.pendingOrder.v1';

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* sem armazenamento: a conta vale só nesta sessão */
  }
}

export interface ShopInfo {
  items: CosmeticDef[];
  priceCents: number;
  payments: { enabled: boolean; methods: string[]; provider: string | null };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Dentro do app Android (Trusted Web Activity) as compras precisam do Google Play Billing. */
export function inAndroidApp(): boolean {
  try {
    if (document.referrer.startsWith('android-app://')) sessionStorage.setItem('mx.twa', '1');
    return sessionStorage.getItem('mx.twa') === '1' || new URLSearchParams(location.search).get('app') === 'android';
  } catch {
    return document.referrer.startsWith('android-app://');
  }
}

/**
 * Conta do jogador e aparências. O servidor é a fonte da verdade sobre o que foi comprado;
 * aqui fica só uma cópia para mostrar a loja e usar o visual também no treino offline.
 */
export class AccountClient {
  secret: string | null = null;
  owned = new Set<string>();
  look: Look = { ...DEFAULT_LOOK };
  online = false;
  onChange: () => void = () => {};

  constructor() {
    try {
      const raw = JSON.parse(get(ACC_KEY) || 'null') as { secret?: string; owned?: string[]; look?: unknown } | null;
      if (raw?.secret) this.secret = raw.secret;
      if (Array.isArray(raw?.owned)) this.owned = new Set(raw!.owned.filter((x): x is string => typeof x === 'string'));
      this.look = restrictLook(sanitizeLook(raw?.look), this.owned);
    } catch {
      /* conta local corrompida: começa do zero */
    }
  }

  private persist() {
    set(ACC_KEY, JSON.stringify({ secret: this.secret, owned: [...this.owned], look: this.look }));
    this.onChange();
  }

  private async api<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth && this.secret) headers.authorization = `Bearer ${this.secret}`;
    let res: Response;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw new ApiError(0, 'network', 'Sem conexão com o servidor do jogo.');
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* resposta vazia */
    }
    if (!res.ok) throw new ApiError(res.status, String(data.code ?? 'error'), String(data.error ?? 'Algo deu errado.'));
    return data as T;
  }

  private apply(acc: { owned: string[]; look: Look }) {
    this.owned = new Set(acc.owned);
    this.look = restrictLook(sanitizeLook(acc.look), this.owned);
    this.persist();
  }

  async shopInfo(): Promise<ShopInfo> {
    const r = await this.api<ShopInfo>('GET', '/api/shop', undefined, false);
    this.online = true;
    return r;
  }

  /** Cria a conta na primeira visita à loja (ou recarrega a existente). */
  async ensure(): Promise<void> {
    if (this.secret) {
      try {
        const r = await this.api<{ account: { owned: string[]; look: Look } }>('GET', '/api/account');
        this.apply(r.account);
        return;
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) throw e;
        // conta não existe neste servidor (ex.: banco recriado): cria outra mantendo o visual grátis
        this.secret = null;
      }
    }
    const r = await this.api<{ secret: string; account: { owned: string[]; look: Look } }>('POST', '/api/account', undefined, false);
    this.secret = r.secret;
    this.apply(r.account);
  }

  async restore(code: string): Promise<void> {
    const clean = code.trim().toUpperCase();
    const prev = this.secret;
    this.secret = clean;
    try {
      const r = await this.api<{ account: { owned: string[]; look: Look } }>('GET', '/api/account');
      this.apply(r.account);
    } catch (e) {
      this.secret = prev;
      throw e;
    }
  }

  async equip(look: Look): Promise<void> {
    const wanted = restrictLook(look, this.owned);
    this.look = wanted;
    this.persist();
    if (!this.secret || !this.online) return;
    const r = await this.api<{ account: { owned: string[]; look: Look } }>('PUT', '/api/account/look', { look: wanted });
    this.apply(r.account);
  }

  async checkout(itemId: string): Promise<{ orderId: string; url: string }> {
    const r = await this.api<{ orderId: string; url: string }>('POST', '/api/checkout', { itemId });
    set(PENDING_KEY, JSON.stringify({ orderId: r.orderId, itemId, at: Date.now() }));
    return r;
  }

  pendingOrder(): { orderId: string; itemId: string; at: number } | null {
    try {
      const p = JSON.parse(get(PENDING_KEY) || 'null');
      if (p && typeof p.orderId === 'string' && Date.now() - p.at < 24 * 3600 * 1000) return p;
    } catch {
      /* ignora */
    }
    return null;
  }

  clearPending() {
    set(PENDING_KEY, null);
  }

  async orderStatus(orderId: string): Promise<{ status: string; itemId: string }> {
    const r = await this.api<{ status: string; itemId: string; account: { owned: string[]; look: Look } }>('GET', `/api/orders/${encodeURIComponent(orderId)}`);
    this.apply(r.account);
    return r;
  }
}
