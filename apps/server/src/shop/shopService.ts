import { COSMETIC_BY_ID, DEFAULT_LOOK, restrictLook, sanitizeLook, type Look } from '@mutant/shared';
import { accountIdFor, hashSecret, isSecretFormat, newAccount, newOrderId, newSecret, type Account, type AccountStore, type Order } from '../persistence/accounts.js';
import type { PaymentInfo, PaymentProvider } from '../payments/provider.js';

export class ShopError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ShopConfig {
  publicUrl: string;
  /** limite de pedidos criados por conta por hora */
  maxOrdersPerHour?: number;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export interface PublicAccount {
  owned: string[];
  look: Look;
}

const SYNC_INTERVAL_MS = 5000;

/**
 * Regras da loja. O cliente nunca decide o que possui: a posse só muda aqui,
 * depois de o pagamento ser confirmado diretamente com o provedor.
 */
export class ShopService {
  constructor(
    private readonly store: AccountStore,
    readonly provider: PaymentProvider | null,
    private readonly cfg: ShopConfig,
  ) {}

  get paymentsEnabled() {
    return !!this.provider && !!this.cfg.publicUrl;
  }

  private log(level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) {
    this.cfg.log?.(level, msg, data);
  }

  view(a: Account): PublicAccount {
    return { owned: [...a.owned], look: restrictLook(sanitizeLook(a.look), new Set(a.owned)) };
  }

  async createAccount(): Promise<{ secret: string; account: PublicAccount }> {
    const secret = newSecret();
    const a = newAccount(secret);
    await this.store.createAccount(a);
    this.log('info', 'account_created', { account: a.id });
    return { secret, account: this.view(a) };
  }

  async auth(secret: unknown): Promise<Account> {
    if (!isSecretFormat(secret)) throw new ShopError('unauthorized', 401, 'Conta não encontrada. Confira o código de recuperação.');
    const a = await this.store.getAccountBySecretHash(hashSecret(secret));
    if (a) return a;
    // conta sumiu do banco do jogo (servidor recriado): se o provedor tiver compras desse código, recria a conta
    const restored = await this.restoreFromProvider(secret).catch((e) => {
      this.log('warn', 'restore_failed', { err: String(e) });
      return null;
    });
    if (restored) return restored;
    throw new ShopError('unauthorized', 401, 'Conta não encontrada. Confira o código de recuperação.');
  }

  /** Recria a conta a partir dos pagamentos aprovados guardados no provedor (fonte da verdade das compras). */
  private async restoreFromProvider(secret: string): Promise<Account | null> {
    if (!this.provider?.findApprovedForAccount) return null;
    const id = accountIdFor(hashSecret(secret));
    const paid = await this.provider.findApprovedForAccount(id);
    const items = [...new Set(paid.filter((p) => {
      const it = COSMETIC_BY_ID.get(p.itemId);
      return it && p.currency === 'BRL' && p.amountCents >= it.priceCents;
    }).map((p) => p.itemId))];
    if (!items.length) return null;
    const a = newAccount(secret);
    a.owned = items;
    await this.store.createAccount(a);
    this.log('info', 'account_restored', { account: a.id, items: items.length });
    return a;
  }

  /** Aparência que o jogador pode usar de fato (itens não comprados voltam ao padrão). */
  async lookFor(secret: string | undefined, requested: Look | undefined): Promise<Look> {
    const want = requested ?? { ...DEFAULT_LOOK };
    if (!secret) return restrictLook(want, new Set());
    try {
      const a = await this.auth(secret);
      return restrictLook(want, new Set(a.owned));
    } catch {
      return restrictLook(want, new Set());
    }
  }

  async setLook(a: Account, raw: unknown): Promise<PublicAccount> {
    const look = restrictLook(sanitizeLook(raw), new Set(a.owned));
    const up = await this.store.updateAccount(a.id, (x) => {
      x.look = look;
    });
    return this.view(up ?? a);
  }

  async startCheckout(a: Account, itemId: unknown): Promise<{ orderId: string; url: string }> {
    if (!this.provider || !this.cfg.publicUrl) throw new ShopError('payments_off', 503, 'Os pagamentos ainda não foram configurados neste servidor.');
    const item = typeof itemId === 'string' ? COSMETIC_BY_ID.get(itemId) : undefined;
    if (!item || item.priceCents <= 0) throw new ShopError('bad_item', 400, 'Item inválido.');
    if (a.owned.includes(item.id)) throw new ShopError('owned', 409, 'Você já tem este item.');
    const recent = await this.store.countOrdersSince(a.id, Date.now() - 3600_000);
    if (recent >= (this.cfg.maxOrdersPerHour ?? 20)) throw new ShopError('rate', 429, 'Muitas tentativas de compra. Tente de novo mais tarde.');
    const order: Order = { id: newOrderId(), accountId: a.id, itemId: item.id, priceCents: item.priceCents, status: 'pending', createdAt: Date.now() };
    await this.store.createOrder(order);
    try {
      const r = await this.provider.createCheckout({ orderId: order.id, accountId: a.id, itemId: item.id, title: `MUTANT.IO — ${item.name}`, priceCents: item.priceCents, publicUrl: this.cfg.publicUrl });
      await this.store.updateOrder(order.id, (o) => {
        o.providerRef = r.providerRef;
      });
      this.log('info', 'checkout_created', { order: order.id, item: item.id });
      return { orderId: order.id, url: r.url };
    } catch (e) {
      await this.store.updateOrder(order.id, (o) => {
        o.status = 'cancelled';
      });
      this.log('warn', 'checkout_failed', { order: order.id, err: String(e) });
      throw new ShopError('provider', 502, 'Não foi possível abrir o pagamento agora. Tente novamente.');
    }
  }

  /** Situação do pedido para a tela do jogador; consulta o provedor se o aviso automático atrasar. */
  async orderStatus(a: Account, orderId: unknown): Promise<{ status: Order['status']; itemId: string; account: PublicAccount }> {
    if (typeof orderId !== 'string' || !/^ord_[a-f0-9]{24}$/.test(orderId)) throw new ShopError('bad_order', 400, 'Pedido inválido.');
    let o = await this.store.getOrder(orderId);
    if (!o || o.accountId !== a.id) throw new ShopError('not_found', 404, 'Pedido não encontrado.');
    if (o.status === 'pending' && this.provider && Date.now() - (o.lastSyncAt ?? 0) > SYNC_INTERVAL_MS) {
      await this.store.updateOrder(o.id, (x) => {
        x.lastSyncAt = Date.now();
      });
      try {
        for (const p of await this.provider.findPaymentsForOrder(o.id)) await this.applyPayment(p);
      } catch (e) {
        this.log('warn', 'order_sync_failed', { order: o.id, err: String(e) });
      }
      o = (await this.store.getOrder(orderId)) ?? o;
    }
    const acc = (await this.store.getAccount(a.id)) ?? a;
    return { status: o.status, itemId: o.itemId, account: this.view(acc) };
  }

  /** Aviso do provedor (webhook): sempre reconsulta o pagamento na API antes de agir. */
  async handleNotification(paymentId: string): Promise<void> {
    if (!this.provider) return;
    const p = await this.provider.getPayment(paymentId);
    if (!p) {
      this.log('warn', 'webhook_unknown_payment', { payment: paymentId });
      return;
    }
    await this.applyPayment(p);
  }

  /** Aplica um pagamento confirmado: entrega ou retira o item. Idempotente. */
  async applyPayment(p: PaymentInfo): Promise<'granted' | 'revoked' | 'ignored'> {
    const o = await this.store.getOrder(p.orderId);
    if (!o) return 'ignored';
    if (p.status === 'approved') {
      if (p.currency !== 'BRL' || p.amountCents < o.priceCents) {
        this.log('warn', 'payment_mismatch', { order: o.id, payment: p.id, amount: p.amountCents, currency: p.currency });
        return 'ignored';
      }
      // entrega primeiro (idempotente), depois marca o pedido: reprocessar é seguro
      await this.store.updateAccount(o.accountId, (a) => {
        if (!a.owned.includes(o.itemId)) a.owned.push(o.itemId);
      });
      const first = await this.store.recordPayment(p.id, o.id, 'approved');
      await this.store.updateOrder(o.id, (x) => {
        if (x.status !== 'paid') {
          x.status = 'paid';
          x.paidAt = Date.now();
          x.paymentId = p.id;
        }
      });
      if (first) this.log('info', 'item_granted', { order: o.id, item: o.itemId, payment: p.id, method: p.method });
      return 'granted';
    }
    if ((p.status === 'refunded' || p.status === 'charged_back') && o.paymentId === p.id) {
      await this.store.updateAccount(o.accountId, (a) => {
        a.owned = a.owned.filter((i) => i !== o.itemId);
        a.look = restrictLook(a.look, new Set(a.owned));
      });
      await this.store.recordPayment(p.id, o.id, p.status);
      await this.store.updateOrder(o.id, (x) => {
        x.status = 'refunded';
      });
      this.log('info', 'item_revoked', { order: o.id, item: o.itemId, payment: p.id });
      return 'revoked';
    }
    return 'ignored';
  }
}
