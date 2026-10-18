import {
  TICK_DT,
  sanitizeAxis,
  stepMovement,
  type ChatMsg,
  type GameEvent,
  type HazardTuple,
  type LeaderRow,
  type MoveBody,
  type MutationId,
  type Phase,
  type PlayerMeta,
  type ResultRow,
  type S2C,
  type SelfState,
  type Snapshot,
  type Welcome,
  type ZoneTuple,
} from '@mutant/shared';
import type { Connection } from './connection.js';

interface Sample {
  t: number;
  x: number;
  y: number;
  r: number;
  hp: number;
  lv: number;
  flags: number;
  fx: number;
  fy: number;
}

export interface RemoteView {
  id: number;
  x: number;
  y: number;
  r: number;
  hp: number;
  lv: number;
  flags: number;
  fx: number;
  fy: number;
  vx: number;
  vy: number;
}

export interface PelletView {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  v: number;
  kind: number;
  born: number;
}

export interface DecoyView {
  id: number;
  owner: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
  lastT: number;
}

export interface OfferView {
  id: number;
  opts: MutationId[];
  expiresAt: number;
}

const INTERP_DELAY_MS = 110;

/**
 * Estado do cliente: previsão local com reconciliação, interpolação dos
 * jogadores remotos e espelho das entidades enviadas pelo servidor.
 */
export class ClientGame {
  welcome: Welcome | null = null;
  me: SelfState | null = null;
  phase: Phase = 'waiting';
  timeLeft = 0;
  hazards: HazardTuple[] = [];
  zones: ZoneTuple[] = [];
  meta = new Map<number, PlayerMeta>();
  pellets = new Map<number, PelletView>();
  decoys = new Map<number, DecoyView>();
  remotes = new Map<number, Sample[]>();
  leaderboard: LeaderRow[] = [];
  rank = 0;
  total = 0;
  minimap: [number, number][] = [];
  /** marcadores do mundo (chuva de biomassa anunciada, célula dourada) */
  worldMarks: [number, number, number, number][] = [];
  offer: OfferView | null = null;
  results: { rows: ResultRow[]; you: number; nextIn: number; receivedAt: number; matchId: number } | null = null;
  ping = 0;
  /** eventos ainda não consumidos pelo renderizador/áudio */
  events: GameEvent[] = [];
  /** callbacks de interface */
  onToast: (text: string, kind: string) => void = () => {};
  onError: (code: string, msg: string) => void = () => {};
  onKicked: (reason: string) => void = () => {};
  onWelcome: (w: Welcome) => void = () => {};
  onResults: () => void = () => {};
  onNewMatch: () => void = () => {};
  onChat: (m: ChatMsg) => void = () => {};

  /* previsão */
  body: MoveBody = { x: 0, y: 0, vx: 0, vy: 0, dashT: 0, dashDx: 0, dashDy: 0, dashSpeed: 0 };
  prevX = 0;
  prevY = 0;
  /** erro visual que decai suavemente após reconciliação */
  offX = 0;
  offY = 0;
  private seq = 0;
  private history: { seq: number; x: number; y: number }[] = [];
  private acc = 0;
  private serverOffset: number | null = null;
  private lastPing = 0;
  snapCount = 0;
  bytesIn = 0;
  bytesWindow: { t: number; b: number }[] = [];

  constructor(public conn: Connection) {
    conn.onMessage = (m) => this.receive(m);
  }

  get myId() {
    return this.me?.id ?? this.welcome?.you ?? -1;
  }

  serverNow() {
    return performance.now() + (this.serverOffset ?? 0);
  }

  private receive(m: S2C) {
    switch (m.t) {
      case 'welcome':
        this.welcome = m;
        this.hazards = m.hazards;
        if (!m.reconnected) this.resetWorld();
        this.history = [];
        this.onWelcome(m);
        break;
      case 'snap':
        this.applySnapshot(m);
        break;
      case 'offer':
        this.offer = { id: m.id, opts: m.opts, expiresAt: performance.now() + m.exp * 1000 };
        break;
      case 'offerClosed':
        if (this.offer?.id === m.id) this.offer = null;
        break;
      case 'toast':
        this.onToast(m.text, m.kind);
        break;
      case 'chat':
        this.onChat(m.m);
        break;
      case 'results':
        this.results = { rows: m.rows, you: m.you, nextIn: m.nextIn, receivedAt: performance.now(), matchId: m.matchId };
        this.offer = null;
        this.onResults();
        break;
      case 'newMatch':
        this.hazards = m.hazards;
        this.resetWorld();
        this.results = null;
        this.onNewMatch();
        break;
      case 'pong':
        this.ping = Math.max(0, Math.round(performance.now() - m.c));
        break;
      case 'error':
        this.onError(m.code, m.msg);
        break;
      case 'kicked':
        this.onKicked(m.reason);
        break;
    }
  }

  private resetWorld() {
    this.pellets.clear();
    this.decoys.clear();
    this.remotes.clear();
    this.offer = null;
    this.meta.clear();
  }

  private applySnapshot(s: Snapshot) {
    const now = performance.now();
    this.snapCount++;
    // estimativa do relógio do servidor (favorece pacotes mais rápidos)
    const sample = s.st - now;
    if (this.serverOffset === null) this.serverOffset = sample;
    else if (sample > this.serverOffset) this.serverOffset += (sample - this.serverOffset) * 0.5;
    else this.serverOffset += (sample - this.serverOffset) * 0.05;

    this.phase = s.ph;
    this.timeLeft = s.tl;
    this.zones = s.z;
    if (s.meta) for (const [id, m] of Object.entries(s.meta)) this.meta.set(Number(id), m);
    if (s.lb) {
      this.leaderboard = s.lb;
      this.rank = s.rank ?? 0;
      this.total = s.total ?? 0;
      this.minimap = s.mm ?? [];
    }
    this.worldMarks = s.wm ?? [];

    // jogadores remotos
    const seen = new Set<number>();
    for (const p of s.p) {
      const [id, x, y, r, hp, lv, flags, fx, fy] = p;
      seen.add(id);
      let buf = this.remotes.get(id);
      if (!buf) this.remotes.set(id, (buf = []));
      buf.push({ t: s.st, x, y, r, hp, lv, flags, fx: fx / 100, fy: fy / 100 });
      if (buf.length > 12) buf.shift();
    }
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.remotes.delete(id);

    // biomassa
    for (const id of s.pr) this.pellets.delete(id);
    for (const [id, x, y, v, kind] of s.pa) this.pellets.set(id, { id, x, y, tx: x, ty: y, v, kind, born: now });
    for (const [id, x, y] of s.pm) {
      const p = this.pellets.get(id);
      if (p) {
        p.tx = x;
        p.ty = y;
      }
    }

    // iscas
    const dseen = new Set<number>();
    for (const [id, owner, x, y, fx, fy] of s.dz) {
      dseen.add(id);
      const d = this.decoys.get(id);
      if (d) {
        d.x = x;
        d.y = y;
        d.lastT = now;
      } else this.decoys.set(id, { id, owner, x, y, fx: fx / 100, fy: fy / 100, lastT: now });
    }
    for (const id of this.decoys.keys()) if (!dseen.has(id)) this.decoys.delete(id);

    this.events.push(...s.ev);

    // reconciliação do jogador local
    const prevMe = this.me;
    this.me = s.me;
    if (s.me) {
      const me = s.me;
      const oldX = this.body.x;
      const oldY = this.body.y;
      const beforeX = oldX + this.offX;
      const beforeY = oldY + this.offY;
      this.body = { x: me.x, y: me.y, vx: me.vx, vy: me.vy, dashT: me.dashT, dashDx: me.dashDx, dashDy: me.dashDy, dashSpeed: me.dashSpeed };
      this.history = this.history.filter((h) => h.seq > s.ack);
      if (me.alive) {
        for (const h of this.history) this.stepLocal(h.x, h.y);
      } else this.history = [];
      const justSpawned = !prevMe || (!prevMe.alive && me.alive) || Math.hypot(beforeX - this.body.x, beforeY - this.body.y) > 180;
      if (justSpawned) {
        this.offX = this.offY = 0;
        this.prevX = this.body.x;
        this.prevY = this.body.y;
      } else {
        this.offX = beforeX - this.body.x;
        this.offY = beforeY - this.body.y;
        this.prevX += this.body.x - oldX;
        this.prevY += this.body.y - oldY;
      }
    }
  }

  private stepLocal(ix: number, iy: number) {
    const me = this.me;
    const a = this.welcome?.arena;
    if (!me || !a) return;
    stepMovement(this.body, ix, iy, { maxSpeed: me.ms, accel: me.ac, decel: me.dc, radius: me.r }, TICK_DT, a.w, a.h);
  }

  /**
   * Chamado a cada quadro. Amostra a entrada em passos fixos de 1/tickRate,
   * envia ao servidor e prevê o movimento local.
   */
  update(dtSec: number, axis: [number, number], paused: boolean) {
    const now = performance.now();
    this.acc += Math.min(0.25, dtSec);
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.prevX = this.body.x;
      this.prevY = this.body.y;
      const canMove = this.me?.alive && this.phase !== 'finished';
      if (!canMove) continue;
      const [x, y] = paused ? [0, 0] : sanitizeAxis(Math.round(axis[0] * 1000) / 1000, Math.round(axis[1] * 1000) / 1000);
      this.seq++;
      this.conn.send({ t: 'in', s: this.seq, x, y });
      this.history.push({ seq: this.seq, x, y });
      if (this.history.length > 120) this.history.shift();
      this.stepLocal(x, y);
    }
    // decaimento do erro visual (~120 ms)
    const k = Math.exp(-dtSec * 9);
    this.offX *= k;
    this.offY *= k;
    if (now - this.lastPing > 2000) {
      this.lastPing = now;
      this.conn.send({ t: 'ping', c: now });
    }
  }

  /** Posição suavizada do jogador local para desenhar. */
  myRenderPos(): { x: number; y: number } {
    const a = this.acc / TICK_DT;
    return {
      x: this.prevX + (this.body.x - this.prevX) * a + this.offX,
      y: this.prevY + (this.body.y - this.prevY) * a + this.offY,
    };
  }

  /** Jogadores remotos interpolados ~110 ms no passado. */
  remoteViews(): RemoteView[] {
    const rt = this.serverNow() - INTERP_DELAY_MS;
    const out: RemoteView[] = [];
    for (const [id, buf] of this.remotes) {
      if (!buf.length) continue;
      let a = buf[0]!;
      let b = buf[buf.length - 1]!;
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1]!.t <= rt) {
          a = buf[i - 1]!;
          b = buf[i]!;
          break;
        }
      }
      const span = b.t - a.t;
      let t = span > 0 ? (rt - a.t) / span : 1;
      t = Math.max(0, Math.min(1.5, t));
      // teleporte (ex.: Salto Dimensional) não deve ser interpolado
      if (Math.hypot(b.x - a.x, b.y - a.y) > 160) t = t < 0.5 ? 0 : 1;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const s = t > 1 ? b : t < 0.5 ? a : b;
      const vx = span > 0 ? ((b.x - a.x) / span) * 1000 : 0;
      const vy = span > 0 ? ((b.y - a.y) / span) * 1000 : 0;
      out.push({ id, x, y, r: a.r + (b.r - a.r) * Math.min(1, t), hp: s.hp, lv: s.lv, flags: s.flags, fx: s.fx, fy: s.fy, vx, vy });
    }
    return out;
  }

  /** Aba em segundo plano: para o personagem imediatamente. */
  sendIdle() {
    if (!this.me?.alive) return;
    this.seq++;
    this.conn.send({ t: 'in', s: this.seq, x: 0, y: 0 });
    this.history.push({ seq: this.seq, x: 0, y: 0 });
  }

  sendAbility(slot?: number) {
    this.conn.send(slot === undefined ? { t: 'ab' } : { t: 'ab', i: slot });
  }
  equip(i: number) {
    this.conn.send({ t: 'eq', i });
  }
  pick(m: MutationId) {
    if (!this.offer) return;
    this.conn.send({ t: 'pick', o: this.offer.id, m });
    // evita escolhas duplicadas; o servidor confirma com offerClosed
    this.offer = null;
  }
  takeEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
