/**
 * Avisos no celular do dono do jogo quando jogadores de verdade entram.
 * Usa o ntfy (https://ntfy.sh): o servidor faz um POST num "tópico" e o app ntfy no celular mostra a notificação.
 * Configure NOTIFY_URL=https://ntfy.sh/<tópico-secreto>. Sem NOTIFY_URL, nada é enviado.
 *
 * Para não virar spam: no máximo um aviso a cada NOTIFY_MIN_GAP_SEC (padrão 120 s); quem entra nesse
 * intervalo é somado e aparece no próximo aviso. Bots nunca geram aviso.
 */
export interface NotifyDeps {
  url: string;
  minGapSec: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  onError?: (err: unknown) => void;
}

export class JoinNotifier {
  private lastSent = -Infinity;
  private pending: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  sent = 0;

  constructor(private readonly deps: NotifyDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  get enabled() {
    return /^https:\/\//.test(this.deps.url);
  }

  /** Um jogador humano entrou (não chamar para reconexões nem bots). */
  playerJoined(name: string, onlineNow: number) {
    if (!this.enabled) return;
    this.pending.push(name);
    this.online = onlineNow;
    const wait = this.lastSent + this.deps.minGapSec * 1000 - this.now();
    if (wait <= 0) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), wait);
  }

  private online = 0;

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.length) return;
    const names = this.pending.splice(0);
    this.lastSent = this.now();
    const who = names.length === 1 ? `${names[0]} entrou no jogo` : `${names.length} jogadores entraram: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}`;
    const body = `${who}. Online agora: ${this.online}.`;
    try {
      await this.fetchFn(this.deps.url, {
        method: 'POST',
        body,
        headers: { Title: 'MUTANT.IO', Tags: 'video_game', Priority: 'default' },
        signal: AbortSignal.timeout(5000),
      });
      this.sent++;
    } catch (err) {
      this.deps.onError?.(err);
    }
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
