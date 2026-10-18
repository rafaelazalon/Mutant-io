import { COSMETICS, DEFAULT_LOOK, SLOT_LABEL, SLOTS, formatBRL, type CosmeticDef, type CosmeticSlot, type Look } from '@mutant/shared';
import { ApiError, inAndroidApp, type AccountClient, type ShopInfo } from '../net/account.js';
import { drawCreature } from '../render/creature.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const NO_MUTS = new Set<never>();

type Mode = 'online' | 'offline';

/**
 * Loja de aparências. Mostra o mutante com o visual escolhido, deixa experimentar
 * qualquer item antes de comprar e envia o jogador para o pagamento do Mercado Pago
 * (cartão de crédito, débito ou Pix). A liberação só acontece depois que o servidor confirma.
 */
export class Shop {
  private root: HTMLElement;
  private grid!: HTMLElement;
  private tabs!: HTMLElement;
  private preview!: HTMLCanvasElement;
  private status!: HTMLElement;
  private acct!: HTMLElement;
  private sheet!: HTMLElement;
  private slot: CosmeticSlot = 'cor';
  /** aparência sendo experimentada (pode conter itens não comprados) */
  private trying: Look = { ...DEFAULT_LOOK };
  private info: ShopInfo | null = null;
  private mode: Mode = 'online';
  private raf = 0;
  private t0 = performance.now();
  private polling = false;
  private thumbCache = new Map<string, string>();
  onClose: () => void = () => {};
  onToast: (text: string, kind: string) => void = () => {};

  constructor(private readonly account: AccountClient) {
    this.root = document.getElementById('shop')!;
    this.build();
  }

  private build() {
    this.root.innerHTML = `
      <div class="shop">
        <header class="shop-head">
          <h2>Loja de aparências</h2>
          <button type="button" class="shop-close" aria-label="Fechar loja">✕</button>
        </header>
        <div class="shop-body">
          <div class="shop-stage">
            <canvas class="shop-preview" width="360" height="300" aria-label="Prévia do mutante"></canvas>
            <p class="shop-note">Só visual: nenhuma aparência muda força, velocidade ou tamanho.</p>
          </div>
          <div class="shop-main">
            <nav class="shop-tabs" role="tablist"></nav>
            <div class="shop-grid"></div>
          </div>
        </div>
        <div class="shop-status" aria-live="polite"></div>
        <footer class="shop-foot">
          <div class="pay-badges" aria-label="Formas de pagamento"><span>💳 Crédito</span><span>💳 Débito</span><span>⚡ Pix</span><span class="mp">Mercado Pago</span></div>
          <div class="shop-acct"></div>
        </footer>
        <div class="shop-sheet hidden" role="dialog" aria-modal="true"></div>
      </div>`;
    this.grid = this.root.querySelector('.shop-grid')!;
    this.tabs = this.root.querySelector('.shop-tabs')!;
    this.preview = this.root.querySelector('.shop-preview')!;
    this.status = this.root.querySelector('.shop-status')!;
    this.acct = this.root.querySelector('.shop-acct')!;
    this.sheet = this.root.querySelector('.shop-sheet')!;
    this.root.querySelector('.shop-close')!.addEventListener('click', () => this.close());
    this.tabs.innerHTML = SLOTS.map((s) => `<button type="button" role="tab" data-slot="${s}">${SLOT_LABEL[s]}</button>`).join('');
    this.tabs.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!b) return;
      this.slot = b.dataset.slot as CosmeticSlot;
      this.renderGrid();
    });
    this.grid.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!card) return;
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      void this.onItem(card.dataset.id!, act);
    });
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  async open(mode: Mode) {
    this.mode = mode;
    this.trying = { ...this.account.look };
    this.root.classList.remove('hidden');
    this.setStatus('');
    this.renderGrid();
    this.renderAccount();
    this.loop();
    if (mode === 'online') {
      try {
        this.info = await this.account.shopInfo();
        await this.account.ensure();
        this.trying = { ...this.account.look };
        this.renderGrid();
        this.renderAccount();
        const p = this.account.pendingOrder();
        if (p && !this.polling) void this.watchOrder(p.orderId, false);
      } catch (e) {
        this.mode = 'offline';
        this.setStatus(e instanceof ApiError && e.code === 'network' ? 'Sem conexão com o servidor: você pode ver e usar os itens grátis.' : (e as Error).message, 'warn');
        this.renderGrid();
        this.renderAccount();
      }
    }
  }

  close() {
    this.root.classList.add('hidden');
    this.sheet.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.onClose();
  }

  private canBuy(): { ok: boolean; why?: string } {
    if (this.mode !== 'online') return { ok: false, why: 'A loja funciona no jogo online.' };
    if (inAndroidApp()) return { ok: false, why: 'Compras pelo app chegam em breve.' };
    if (!this.info?.payments.enabled) return { ok: false, why: 'Pagamentos ainda não ativados neste servidor.' };
    return { ok: true };
  }

  private setStatus(text: string, kind: 'info' | 'warn' | 'good' = 'info') {
    this.status.textContent = text;
    this.status.className = `shop-status ${kind}`;
  }

  /* ------------------------------- vitrine ------------------------------- */

  private thumb(item: CosmeticDef): string {
    let url = this.thumbCache.get(item.id);
    if (url) return url;
    const c = document.createElement('canvas');
    c.width = c.height = 120;
    const ctx = c.getContext('2d')!;
    const look: Look = { ...DEFAULT_LOOK, [item.slot]: item.id };
    drawCreature(ctx, { x: 60, y: 64, r: 30, hue: 140, fx: 1, fy: 0.12, vx: 0, vy: 0, muts: NO_MUTS, hyb: NO_MUTS, flags: 0, alpha: 1, seed: 3, level: 3, look }, 0.6, true, 2);
    if (item.slot === 'rastro' && item.priceCents > 0) {
      ctx.globalCompositeOperation = 'destination-over';
      const g = ctx.createLinearGradient(0, 64, 40, 64);
      g.addColorStop(0, 'transparent');
      g.addColorStop(1, item.accent);
      ctx.fillStyle = g;
      ctx.fillRect(4, 52, 40, 24);
    }
    url = c.toDataURL();
    this.thumbCache.set(item.id, url);
    return url;
  }

  private renderGrid() {
    for (const b of this.tabs.querySelectorAll<HTMLElement>('[data-slot]')) b.setAttribute('aria-selected', String(b.dataset.slot === this.slot));
    const buy = this.canBuy();
    const items = COSMETICS.filter((c) => c.slot === this.slot);
    this.grid.innerHTML = items
      .map((it) => {
        const owned = it.priceCents === 0 || this.account.owned.has(it.id);
        const equipped = this.account.look[it.slot] === it.id;
        const trying = this.trying[it.slot] === it.id;
        let action: string;
        if (equipped) action = `<span class="tag on">Equipado</span>`;
        else if (owned) action = `<button type="button" class="btn small" data-act="equip">Equipar</button>`;
        else if (buy.ok) action = `<button type="button" class="btn small primary" data-act="buy">${formatBRL(it.priceCents)}</button>`;
        else action = `<span class="tag">${formatBRL(it.priceCents)}</span>`;
        return `<div class="sitem${trying ? ' trying' : ''}${owned ? ' owned' : ''}" data-id="${it.id}" style="--accent:${it.accent}">
          <button type="button" class="sthumb" data-act="try" aria-label="Experimentar ${esc(it.name)}"><img alt="" src="${this.thumb(it)}"></button>
          <div class="sname">${esc(it.name)}</div>
          <div class="sact">${action}</div>
        </div>`;
      })
      .join('');
  }

  private renderAccount() {
    const s = this.account.secret;
    if (this.mode !== 'online' || !s) {
      this.acct.innerHTML = this.mode === 'online' ? '' : `<span class="muted">Itens comprados aparecem quando você entra online.</span>`;
      return;
    }
    this.acct.innerHTML = `
      <details class="acct">
        <summary>Sua conta e recuperação de compras</summary>
        <p class="muted">Guarde este código. Com ele você recupera suas aparências em outro aparelho.</p>
        <div class="acct-row"><code class="acct-code">${esc(s)}</code><button type="button" class="btn small" data-a="copy">Copiar</button></div>
        <div class="acct-row"><input class="acct-in" id="acct-restore" maxlength="23" placeholder="MX-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" aria-label="Código de recuperação"><button type="button" class="btn small" data-a="restore">Recuperar</button></div>
      </details>`;
    this.acct.querySelector('[data-a="copy"]')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(s);
        this.setStatus('Código copiado.', 'good');
      } catch {
        const code = this.acct.querySelector('.acct-code');
        if (code) window.getSelection()?.selectAllChildren(code);
        this.setStatus('Selecione e copie o código manualmente.');
      }
    });
    this.acct.querySelector('[data-a="restore"]')!.addEventListener('click', async () => {
      const v = (this.acct.querySelector('#acct-restore') as HTMLInputElement).value;
      try {
        await this.account.restore(v);
        this.trying = { ...this.account.look };
        this.renderGrid();
        this.renderAccount();
        this.setStatus(`Conta recuperada: ${this.account.owned.size} aparência(s).`, 'good');
      } catch (e) {
        this.setStatus((e as Error).message, 'warn');
      }
    });
  }

  private async onItem(id: string, act: string | undefined) {
    const it = COSMETICS.find((c) => c.id === id);
    if (!it) return;
    this.trying = { ...this.trying, [it.slot]: it.id };
    if (act === 'equip') {
      try {
        await this.account.equip({ ...this.account.look, [it.slot]: it.id });
        this.trying = { ...this.account.look };
        this.setStatus(`${it.name} equipado.`, 'good');
      } catch (e) {
        this.setStatus((e as Error).message, 'warn');
      }
    } else if (act === 'buy') {
      this.confirmBuy(it);
    } else {
      const owned = it.priceCents === 0 || this.account.owned.has(it.id);
      if (owned && this.account.look[it.slot] !== it.id) void this.onItem(id, 'equip');
      else if (!owned) this.setStatus(`Experimentando ${it.name}. ${this.canBuy().ok ? `Toque em ${formatBRL(it.priceCents)} para comprar.` : this.canBuy().why}`);
    }
    this.renderGrid();
  }

  /* ------------------------------- compra ------------------------------- */

  private confirmBuy(it: CosmeticDef) {
    this.sheet.innerHTML = `
      <div class="sheet-card">
        <h3>Comprar ${esc(it.name)}</h3>
        <img class="sheet-img" alt="" src="${this.thumb(it)}">
        <p class="sheet-price">${formatBRL(it.priceCents)}</p>
        <p class="muted">Você vai para a página segura do Mercado Pago e escolhe <b>cartão de crédito, débito ou Pix</b>. Ao terminar, volta ao jogo e o item é liberado assim que o pagamento for confirmado.</p>
        <p class="muted small">Aparência só visual, sem vantagem na partida. Os dados do cartão ficam só no Mercado Pago.</p>
        <div class="sheet-actions">
          <button type="button" class="btn" data-s="cancel">Voltar</button>
          <button type="button" class="btn primary" data-s="go">Ir para o pagamento</button>
        </div>
      </div>`;
    this.sheet.classList.remove('hidden');
    this.sheet.querySelector('[data-s="cancel"]')!.addEventListener('click', () => this.sheet.classList.add('hidden'));
    const go = this.sheet.querySelector<HTMLButtonElement>('[data-s="go"]')!;
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'Abrindo…';
      // dentro de um portal (itch.io, CrazyGames…) o jogo roda num iframe: o pagamento abre em outra aba
      // (aberta já no toque, para o navegador não bloquear) e esta aba fica conferindo a confirmação
      const inFrame = (() => {
        try {
          return window.top !== window.self;
        } catch {
          return true;
        }
      })();
      const pop = inFrame ? window.open('', '_blank') : null;
      try {
        const r = await this.account.checkout(it.id);
        if (inFrame) {
          if (pop) pop.location.href = r.url;
          else window.open(r.url, '_blank');
          this.sheet.classList.add('hidden');
          this.setStatus('Pagamento aberto em outra aba. Assim que pagar, o item aparece aqui.');
          void this.watchOrder(r.orderId, true, undefined, 10 * 60_000);
          return;
        }
        location.href = r.url;
      } catch (e) {
        pop?.close();
        go.disabled = false;
        go.textContent = 'Ir para o pagamento';
        this.sheet.classList.add('hidden');
        this.setStatus((e as Error).message, 'warn');
      }
    });
  }

  /**
   * Volta do Mercado Pago (?pedido=…&pagamento=…) ou pedido pendente salvo:
   * consulta o servidor até o pagamento ser confirmado (Pix e cartão costumam levar segundos).
   */
  async watchOrder(orderId: string, fromReturn: boolean, hint?: string, maxMs?: number) {
    if (this.polling) return;
    this.polling = true;
    const item = COSMETICS.find((c) => c.id === this.account.pendingOrder()?.itemId);
    if (hint === 'recusado') this.setStatus('O pagamento não foi concluído. Nada foi cobrado por este pedido.', 'warn');
    else this.setStatus(`Confirmando pagamento${item ? ` de ${item.name}` : ''}…`);
    const started = Date.now();
    try {
      while (Date.now() - started < (maxMs ?? (fromReturn ? 90_000 : 20_000))) {
        let st: { status: string; itemId: string };
        try {
          st = await this.account.orderStatus(orderId);
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 400 || e.status === 401)) {
            this.account.clearPending();
            return;
          }
          throw e;
        }
        if (st.status === 'paid') {
          this.account.clearPending();
          const it = COSMETICS.find((c) => c.id === st.itemId);
          if (it) await this.account.equip({ ...this.account.look, [it.slot]: it.id }).catch(() => {});
          this.trying = { ...this.account.look };
          this.renderGrid();
          this.setStatus(`Compra aprovada! Item liberado e equipado${it ? `: ${it.name}` : ''}.`, 'good');
          this.onToast(`🎉 ${it?.name ?? 'Aparência'} liberada!`, 'good');
          return;
        }
        if (st.status === 'refunded' || st.status === 'cancelled') {
          this.account.clearPending();
          this.setStatus('Este pedido foi cancelado ou estornado.', 'warn');
          return;
        }
        if (hint === 'recusado' && Date.now() - started > 6000) return;
        await new Promise((r) => setTimeout(r, 2500));
      }
      this.setStatus('Pagamento ainda em processamento. O item aparece aqui assim que o Mercado Pago confirmar.', 'info');
    } catch (e) {
      this.setStatus((e as Error).message, 'warn');
    } finally {
      this.polling = false;
    }
  }

  /* ------------------------------- prévia ------------------------------- */

  private loop() {
    cancelAnimationFrame(this.raf);
    const draw = () => {
      if (!this.isOpen) return;
      const c = this.preview;
      const ctx = c.getContext('2d');
      if (ctx) {
        const t = (performance.now() - this.t0) / 1000;
        ctx.clearRect(0, 0, c.width, c.height);
        const cx = c.width / 2;
        const cy = c.height / 2 + 14;
        const fx = Math.cos(t * 0.7);
        const fy = Math.sin(t * 0.7) * 0.35;
        // rastro da prévia
        const tr = this.trying.rastro;
        if (tr !== 'rastro.nenhum') {
          const col = COSMETICS.find((x) => x.id === tr)?.accent ?? '#fff';
          for (let i = 1; i <= 6; i++) {
            ctx.globalAlpha = 0.5 - i * 0.07;
            ctx.fillStyle = tr === 'rastro.arcoiris' ? `hsl(${(t * 200 + i * 40) % 360} 100% 60%)` : col;
            ctx.beginPath();
            ctx.arc(cx - fx * (60 + i * 14), cy - fy * (60 + i * 14), 14 - i * 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        drawCreature(ctx, { x: cx, y: cy, r: 72, hue: 140, fx, fy, vx: 90, vy: 0, muts: NO_MUTS, hyb: NO_MUTS, flags: 0, alpha: 1, seed: 3, level: 3, look: this.trying }, t, true, 2);
      }
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }
}
