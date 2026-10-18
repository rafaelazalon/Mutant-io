import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Situação de um pagamento já normalizada (independe do provedor). */
export interface PaymentInfo {
  id: string;
  /** approved | pending | in_process | rejected | cancelled | refunded | charged_back */
  status: string;
  orderId: string;
  amountCents: number;
  currency: string;
  method?: string;
}

export interface CheckoutRequest {
  orderId: string;
  /** conta que comprou (vai junto no pagamento para recuperar a compra se o banco do jogo se perder) */
  accountId: string;
  itemId: string;
  title: string;
  priceCents: number;
  publicUrl: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** Cria a página de pagamento e devolve o endereço para onde o jogador vai. */
  createCheckout(req: CheckoutRequest): Promise<{ url: string; providerRef: string }>;
  getPayment(paymentId: string): Promise<PaymentInfo | null>;
  /** Procura pagamentos de um pedido (usado quando o aviso automático atrasa). */
  findPaymentsForOrder(orderId: string): Promise<PaymentInfo[]>;
  /** Pagamentos aprovados de uma conta (recuperação de compras direto do provedor). */
  findApprovedForAccount?(accountId: string): Promise<(PaymentInfo & { itemId: string })[]>;
  /** Confere a assinatura do aviso (webhook). */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, dataId: string): boolean;
}

/* ------------------------------------------------------------------ */
/* Mercado Pago — Checkout Pro (cartão de crédito, débito e Pix)       */
/* ------------------------------------------------------------------ */

interface MpPayment {
  id: number | string;
  status: string;
  external_reference?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  payment_type_id?: string;
  metadata?: Record<string, unknown> | null;
}

function toInfo(p: MpPayment): PaymentInfo {
  return {
    id: String(p.id),
    status: p.status,
    orderId: p.external_reference ?? '',
    amountCents: Math.round((p.transaction_amount ?? 0) * 100),
    currency: p.currency_id ?? '',
    method: p.payment_type_id,
  };
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago';
  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret: string,
    private readonly apiBase = 'https://api.mercadopago.com',
  ) {}

  private async api<T>(method: string, path: string, body?: unknown, idem?: string): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(idem ? { 'X-Idempotency-Key': idem } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Mercado Pago ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createCheckout(req: CheckoutRequest) {
    const back = (s: string) => `${req.publicUrl}/?pedido=${encodeURIComponent(req.orderId)}&pagamento=${s}`;
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const pref = await this.api<{ id: string; init_point: string }>(
      'POST',
      '/checkout/preferences',
      {
        items: [
          {
            id: req.itemId,
            title: req.title,
            description: 'Aparência visual para o MUTANT.IO (não altera a jogabilidade)',
            category_id: 'virtual_goods',
            quantity: 1,
            currency_id: 'BRL',
            unit_price: req.priceCents / 100,
          },
        ],
        external_reference: req.orderId,
        metadata: { acct: req.accountId, item: req.itemId },
        notification_url: `${req.publicUrl}/api/webhooks/mercadopago`,
        back_urls: { success: back('aprovado'), pending: back('pendente'), failure: back('recusado') },
        auto_return: 'approved',
        statement_descriptor: 'MUTANTIO',
        // cartão de crédito, débito e Pix; boleto fica de fora (demora dias para compensar)
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }], installments: 1 },
        expires: true,
        expiration_date_to: expires,
      },
      req.orderId,
    );
    return { url: pref.init_point, providerRef: pref.id };
  }

  async getPayment(paymentId: string) {
    if (!/^\d{1,20}$/.test(paymentId)) return null;
    try {
      return toInfo(await this.api<MpPayment>('GET', `/v1/payments/${paymentId}`));
    } catch {
      return null;
    }
  }

  async findApprovedForAccount(accountId: string) {
    const out: (PaymentInfo & { itemId: string })[] = [];
    // poucas vendas: varre os aprovados mais recentes (até 1000) e filtra pela conta guardada no pagamento
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await this.api<{ results?: MpPayment[] }>('GET', `/v1/payments/search?status=approved&sort=date_created&criteria=desc&limit=100&offset=${offset}`);
      const list = r.results ?? [];
      for (const p of list) {
        const md = p.metadata ?? {};
        if (md.acct === accountId && typeof md.item === 'string') out.push({ ...toInfo(p), itemId: md.item });
      }
      if (list.length < 100) break;
    }
    return out;
  }

  async findPaymentsForOrder(orderId: string) {
    const r = await this.api<{ results?: MpPayment[] }>('GET', `/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc`);
    return (r.results ?? []).map(toInfo);
  }

  /**
   * Assinatura do aviso: cabeçalho x-signature "ts=…,v1=…" = HMAC-SHA256 do texto
   * "id:{data.id};request-id:{x-request-id};ts:{ts};" com a chave secreta do painel.
   * Mesmo com assinatura válida, o pagamento sempre é reconsultado na API antes de liberar o item.
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, dataId: string) {
    if (!this.webhookSecret) return true;
    const sig = String(headers['x-signature'] ?? '');
    const reqId = String(headers['x-request-id'] ?? '');
    const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=') as [string, string]));
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) return false;
    const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
    let manifest = `id:${id};`;
    if (reqId) manifest += `request-id:${reqId};`;
    manifest += `ts:${ts};`;
    const expected = createHmac('sha256', this.webhookSecret).update(manifest).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/* ------------------------------------------------------------------ */
/* Provedor simulado (somente desenvolvimento e testes automáticos)    */
/* ------------------------------------------------------------------ */

export class FakeProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly payments = new Map<string, PaymentInfo>();
  private prices = new Map<string, number>();
  private orderMeta = new Map<string, { acct: string; item: string }>();

  async createCheckout(req: CheckoutRequest) {
    this.prices.set(req.orderId, req.priceCents);
    this.orderMeta.set(req.orderId, { acct: req.accountId, item: req.itemId });
    return { url: `/api/dev/checkout/${encodeURIComponent(req.orderId)}`, providerRef: `fake_${randomBytes(4).toString('hex')}` };
  }
  /** Simula o jogador pagando na página do provedor. */
  pay(orderId: string, status = 'approved', amountCents?: number): PaymentInfo {
    const id = String(Math.floor(1e9 + Math.random() * 8e9));
    const p: PaymentInfo = { id, status, orderId, amountCents: amountCents ?? this.prices.get(orderId) ?? 0, currency: 'BRL', method: 'pix' };
    this.payments.set(id, p);
    return p;
  }
  async getPayment(paymentId: string) {
    return this.payments.get(paymentId) ?? null;
  }
  async findPaymentsForOrder(orderId: string) {
    return [...this.payments.values()].filter((p) => p.orderId === orderId);
  }
  async findApprovedForAccount(accountId: string) {
    return [...this.payments.values()]
      .filter((p) => p.status === 'approved' && this.orderMeta.get(p.orderId)?.acct === accountId)
      .map((p) => ({ ...p, itemId: this.orderMeta.get(p.orderId)!.item }));
  }
  verifyWebhook() {
    return true;
  }
}
