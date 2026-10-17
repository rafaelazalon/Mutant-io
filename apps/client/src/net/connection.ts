import { sanitizeLook, sanitizeName, type C2S, type S2C } from '@mutant/shared';

export interface Connection {
  readonly kind: 'online' | 'offline';
  send(m: C2S): void;
  onMessage: (m: S2C) => void;
  /** wasClean=false indica queda inesperada (tentar reconectar). */
  onClose: (wasClean: boolean) => void;
  onOpen: () => void;
  close(): void;
}

export function defaultServerUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q && /^wss?:\/\//.test(q)) return q;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Conexão real com o servidor autoritativo via WebSocket (JSON). */
export class WsConnection implements Connection {
  readonly kind = 'online' as const;
  onMessage: (m: S2C) => void = () => {};
  onClose: (wasClean: boolean) => void = () => {};
  onOpen: () => void = () => {};
  private ws: WebSocket;
  private closedByUs = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      try {
        this.onMessage(JSON.parse(e.data) as S2C);
      } catch (err) {
        console.warn('mensagem inválida do servidor', err);
      }
    };
    this.ws.onclose = (e) => this.onClose(this.closedByUs || e.code === 1000);
  }

  send(m: C2S) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closedByUs = true;
    try {
      this.ws.close(1000);
    } catch {
      /* já fechado */
    }
  }
}

/**
 * Treino offline: roda a MESMA sala autoritativa no navegador, contra bots.
 * Não substitui o multiplayer — é um modo separado e identificado na interface.
 */
export class LocalConnection implements Connection {
  readonly kind = 'offline' as const;
  onMessage: (m: S2C) => void = () => {};
  onClose: (wasClean: boolean) => void = () => {};
  onOpen: () => void = () => {};
  private timer: number | null = null;
  private room: import('@mutant/sim').MatchRoom | null = null;
  private readonly clientId = 'local';

  constructor() {
    void this.boot();
  }

  private async boot() {
    const { MatchRoom } = await import('@mutant/sim');
    const { TICK_DT } = await import('@mutant/shared');
    const { GAME_CONFIG } = await import('@mutant/shared');
    // ?duracao=N (30–600 s) encurta a partida de treino; não existe no modo online
    const q = Number(new URLSearchParams(location.search).get('duracao'));
    const cfg = Number.isFinite(q) && q >= 30 && q <= 600 ? { ...GAME_CONFIG, matchDurationSec: Math.round(q) } : GAME_CONFIG;
    this.room = new MatchRoom({ id: 'offline', code: 'TREINO', isPrivate: true, botFill: 8, cfg });
    this.room.setSender((_id, m) => {
      // entrega assíncrona e em cópia, como numa rede real
      const copy = JSON.parse(JSON.stringify(m)) as S2C;
      queueMicrotask(() => this.onMessage(copy));
    });
    let last = performance.now();
    let acc = 0;
    this.timer = window.setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      let n = 0;
      while (acc >= TICK_DT && n++ < 5) {
        acc -= TICK_DT;
        this.room?.tick(TICK_DT);
      }
    }, 1000 / 60);
    this.onOpen();
  }

  send(m: C2S) {
    const room = this.room;
    if (!room) return;
    const copy = JSON.parse(JSON.stringify(m));
    // offline: o visual vem da cópia local da conta (já limitada ao que foi comprado)
    if (m.t === 'join') room.join(this.clientId, sanitizeName(m.name), m.look ? sanitizeLook(m.look) : undefined);
    else room.handle(this.clientId, copy);
  }

  close() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.room = null;
    this.onClose(true);
  }
}
