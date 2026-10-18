import {
  FLAG,
  GAME_CONFIG,
  abilitiesFor,
  dist2,
  encodeBuild,
  parseC2S,
  type DecoyTuple,
  type GameConfig,
  type LeaderRow,
  type PelletTuple,
  type Phase,
  type PlayerMeta,
  type PlayerTuple,
  type ResultRow,
  type S2C,
  type SelfState,
  type Snapshot,
  type ZoneTuple,
  type Look,
  type ChatMsg,
  createRng,
} from '@mutant/shared';
import { BOT_NAMES, BotBrain, type BotDifficulty } from './bots.js';
import { ChatDirector, PERSONAS, PERSONA_ORDER } from './personas.js';
import { createPlayer, type Player } from './entities.js';
import { World } from './world.js';

export interface RoomOptions {
  id: string;
  code: string;
  isPrivate: boolean;
  seed?: number;
  cfg?: GameConfig;
  botFill?: number;
  botDifficulty?: BotDifficulty;
  /** Gera tokens de reconexão (servidor usa crypto). */
  makeToken?: () => string;
  /** Chamado ao fim de cada partida (persistência de estatísticas). */
  onMatchEnd?: (rows: ResultRow[], room: MatchRoom) => void;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
  /** Personagens de IA que conversam no chat (padrão: sim). */
  personas?: boolean;
}

interface ClientView {
  clientId: string;
  playerId: number;
  knownPellets: Set<number>;
  knownMeta: Map<number, number>;
  snaps: number;
}

export type JoinResult = { ok: true; playerId: number; reconnected: boolean } | { ok: false; reason: string };

const HUE_STEP = 47;

/**
 * Sala autoritativa: ciclo da partida, clientes, bots e snapshots.
 * Independente de transporte — o servidor WebSocket e o modo de treino offline usam a mesma classe.
 */
export class MatchRoom {
  readonly id: string;
  readonly code: string;
  readonly isPrivate: boolean;
  readonly cfg: GameConfig;
  world: World;
  phase: Phase = 'waiting';
  phaseEndsAt = 0;
  matchId = 1;

  private clients = new Map<string, ClientView>();
  /** chat: falas dos personagens de IA e chat rápido */
  readonly chat: ChatDirector;
  private readonly personas: boolean;
  private send: (clientId: string, msg: S2C) => void = () => {};
  private nextPlayerId = 1;
  private joinOrder = 0;
  private metaVersion = new Map<number, number>();
  private pendingEvents: World['events'] = [];
  private tickInSnap = 0;
  private botFill: number;
  private botDifficulty: BotDifficulty;
  private botCheckT = 0;
  private warned = new Set<number>();
  private seedBase: number;
  private makeToken: () => string;
  private lastResults: ResultRow[] = [];
  private rand: () => number;
  emptySince = 0;

  constructor(private readonly opts: RoomOptions) {
    this.id = opts.id;
    this.code = opts.code;
    this.isPrivate = opts.isPrivate;
    this.cfg = opts.cfg ?? GAME_CONFIG;
    this.seedBase = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.world = new World(this.seedBase, this.cfg);
    this.botFill = opts.botFill ?? this.cfg.botFillTarget;
    this.botDifficulty = opts.botDifficulty ?? 'normal';
    this.rand = this.world.rng.next;
    this.makeToken =
      opts.makeToken ??
      (() => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''));
    this.world.combatEnabled = false;
    this.world.collectEnabled = false;
    this.personas = opts.personas ?? true;
    // gerador separado: as falas não mudam a sequência aleatória da simulação
    const chatRng = createRng((this.seedBase ^ 0x5bd1e995) >>> 0);
    this.chat = new ChatDirector(() => chatRng.next(), (m) => this.broadcastChat(m));
  }

  setSender(fn: (clientId: string, msg: S2C) => void) {
    this.send = fn;
  }

  /* ---------------------------------------------------------------- */
  /* Consultas                                                         */
  /* ---------------------------------------------------------------- */

  get humanCount() {
    let n = 0;
    for (const p of this.world.players.values()) if (!p.isBot) n++;
    return n;
  }
  get connectedHumans() {
    let n = 0;
    for (const p of this.world.players.values()) if (!p.isBot && p.connected) n++;
    return n;
  }
  get botCount() {
    let n = 0;
    for (const p of this.world.players.values()) if (p.isBot) n++;
    return n;
  }
  canAcceptHuman() {
    return this.humanCount < this.cfg.maxPlayersPerRoom;
  }
  playerByClient(clientId: string): Player | undefined {
    const v = this.clients.get(clientId);
    return v ? this.world.players.get(v.playerId) : undefined;
  }
  timeLeft() {
    return Math.max(0, this.phaseEndsAt - this.world.t);
  }

  /* ---------------------------------------------------------------- */
  /* Entrada e saída                                                   */
  /* ---------------------------------------------------------------- */

  /** Reconexão por token de uso único. Sem efeitos colaterais se o token não pertencer à sala. */
  reconnect(clientId: string, token: string): JoinResult | null {
    for (const p of this.world.players.values()) {
      if (!p.isBot && !p.connected && p.reconnectToken === token) {
        p.connected = true;
        p.clientId = clientId;
        p.reconnectToken = this.makeToken();
        p.inputQueue = [];
        p.lastSeq = 0;
        this.attachClient(clientId, p, true);
        this.log('info', 'reconnect', { room: this.id, player: p.id });
        return { ok: true, playerId: p.id, reconnected: true };
      }
    }
    return null;
  }

  join(clientId: string, name: string, look?: Look): JoinResult {
    if (!this.canAcceptHuman()) return { ok: false, reason: 'full' };
    // abre espaço removendo um bot, se necessário
    if (this.world.players.size >= this.cfg.maxPlayersPerRoom) this.removeOneBot();

    const p = createPlayer({
      id: this.nextPlayerId++,
      clientId,
      name,
      hue: (this.nextPlayerId * HUE_STEP) % 360,
      isBot: false,
      joinOrder: this.joinOrder++,
      token: this.makeToken(),
      look,
    });
    this.world.addPlayer(p);
    if (this.phase === 'finished') {
      p.alive = false;
      p.respawnAt = Infinity;
    } else {
      this.world.spawn(p, this.phase === 'playing' ? this.world.catchUpFor() : 0);
    }
    this.attachClient(clientId, p, false);
    this.log('info', 'join', { room: this.id, player: p.id, humans: this.humanCount });
    return { ok: true, playerId: p.id, reconnected: false };
  }

  private attachClient(clientId: string, p: Player, reconnected: boolean) {
    this.clients.set(clientId, { clientId, playerId: p.id, knownPellets: new Set(), knownMeta: new Map(), snaps: 0 });
    this.send(clientId, {
      t: 'welcome',
      you: p.id,
      token: p.reconnectToken,
      room: { id: this.id, code: this.code, private: this.isPrivate },
      arena: { w: this.world.W, h: this.world.H },
      hazards: this.world.hazards.map((h) => [Math.round(h.x), Math.round(h.y), Math.round(h.r)]),
      tickRate: this.cfg.tickRate,
      snapshotRate: this.cfg.snapshotRate,
      matchId: this.matchId,
      reconnected,
    });
    if (p.offer) {
      this.send(clientId, {
        t: 'offer',
        id: p.offer.id,
        opts: p.offer.options,
        exp: Math.max(1, p.offer.expiresAt - this.world.t),
      });
    }
    if (this.phase === 'finished' && this.lastResults.length) {
      this.send(clientId, { t: 'results', matchId: this.matchId, rows: this.lastResults, you: p.id, nextIn: this.timeLeft() });
    }
  }

  /** consented=false mantém o jogador pela janela de reconexão. */
  leave(clientId: string, consented: boolean) {
    const v = this.clients.get(clientId);
    if (!v) return;
    this.clients.delete(clientId);
    const p = this.world.players.get(v.playerId);
    if (!p) return;
    if (consented || this.phase === 'finished') {
      this.world.removePlayer(p.id);
      this.log('info', 'leave', { room: this.id, player: p.id });
    } else {
      p.connected = false;
      p.clientId = null;
      p.disconnectedAt = this.world.t;
      p.inputQueue = [];
      p.lastInput = { x: 0, y: 0 };
      this.log('info', 'disconnect', { room: this.id, player: p.id });
    }
  }

  /** Mensagens já decodificadas (JSON). Tudo é revalidado aqui. */
  handle(clientId: string, raw: unknown) {
    const msg = parseC2S(raw);
    const p = this.playerByClient(clientId);
    if (!msg || !p) return false;
    switch (msg.t) {
      case 'in':
        if (msg.s <= p.lastSeq || p.inputQueue.some((q) => q.seq >= msg.s)) return false;
        p.inputQueue.push({ seq: msg.s, x: msg.x, y: msg.y });
        if (p.inputQueue.length > this.cfg.net.maxInputQueue) p.inputQueue.shift();
        return true;
      case 'ab':
        if (this.phase !== 'playing') return false;
        if (msg.i !== undefined && !this.world.equip(p, msg.i)) return false;
        p.wantAbility = true;
        return true;
      case 'eq':
        return this.world.equip(p, msg.i);
      case 'pick':
        return this.world.choose(p, msg.o, msg.m);
      case 'ping':
        this.send(clientId, { t: 'pong', c: msg.c, s: Date.now() });
        return true;
      case 'qc':
        return this.chat.quick(this.world, p, msg.i);
      case 'leave':
        this.leave(clientId, true);
        return true;
      default:
        return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Bots                                                              */
  /* ---------------------------------------------------------------- */

  private addBot() {
    const used = new Set([...this.world.players.values()].map((p) => p.name));
    // os primeiros bots da sala são os personagens de IA que conversam no chat
    const inUse = this.chat.personasInUse();
    const persona = this.personas ? PERSONA_ORDER.find((id) => !inUse.has(id)) : undefined;
    const name = persona ? PERSONAS[persona].name : BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextPlayerId}`;
    const p = createPlayer({
      id: this.nextPlayerId++,
      clientId: null,
      name,
      hue: persona ? PERSONAS[persona].hue : (this.nextPlayerId * HUE_STEP) % 360,
      isBot: true,
      joinOrder: this.joinOrder++,
      token: '',
    });
    const diffs: BotDifficulty[] = ['facil', 'normal', 'normal', 'dificil'];
    const diff = this.botDifficulty === 'normal' ? diffs[Math.floor(this.rand() * diffs.length)]! : this.botDifficulty;
    p.bot = new BotBrain(persona ? PERSONAS[persona].difficulty : diff, this.rand);
    if (persona) this.chat.assign(p, persona);
    this.world.addPlayer(p);
    if (this.phase !== 'finished') this.world.spawn(p, this.phase === 'playing' ? this.world.catchUpFor() : 0);
  }

  private removeOneBot() {
    let pick: Player | null = null;
    for (const p of this.world.players.values()) {
      if (!p.isBot) continue;
      // personagens saem por último
      if (!pick || (pick.persona && !p.persona) || (!!pick.persona === !!p.persona && ((!p.alive && pick.alive) || p.score < pick.score))) pick = p;
    }
    if (pick) {
      this.chat.release(pick.id);
      this.world.removePlayer(pick.id);
    }
  }

  private balanceBots() {
    const humans = this.humanCount;
    const want = humans > 0 ? Math.max(0, Math.min(this.botFill, this.cfg.maxPlayersPerRoom) - humans) : 0;
    let bots = this.botCount;
    while (bots < want && this.world.players.size < this.cfg.maxPlayersPerRoom) {
      this.addBot();
      bots++;
    }
    while (bots > want) {
      this.removeOneBot();
      bots--;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Ciclo da partida                                                  */
  /* ---------------------------------------------------------------- */

  private setPhase(ph: Phase, duration: number) {
    this.phase = ph;
    this.phaseEndsAt = this.world.t + duration;
    const w = this.world;
    w.combatEnabled = ph === 'playing';
    w.collectEnabled = ph === 'playing';
    const top = ph === 'finished' ? this.ranking()[0] : undefined;
    this.chat.onPhase(w, ph, top ? w.players.get(top.id) : undefined);
  }

  private broadcastChat(m: ChatMsg) {
    for (const v of this.clients.values()) {
      const p = this.world.players.get(v.playerId);
      if (p?.connected) this.send(v.clientId, { t: 'chat', m });
    }
  }

  private startNewMatch() {
    this.matchId++;
    const w = this.world;
    w.matchId = this.matchId;
    w.resetMap(this.seedBase + this.matchId * 7919);
    for (const p of w.players.values()) {
      w.resetPlayerForMatch(p);
      if (p.connected || p.isBot) w.spawn(p);
      else p.alive = false;
    }
    for (const v of this.clients.values()) {
      v.knownPellets.clear();
      v.knownMeta.clear();
    }
    this.pendingEvents = [];
    this.warned.clear();
    const hazards = w.hazards.map((h) => [Math.round(h.x), Math.round(h.y), Math.round(h.r)] as [number, number, number]);
    for (const v of this.clients.values()) this.send(v.clientId, { t: 'newMatch', matchId: this.matchId, hazards });
  }

  private finishMatch() {
    const rows = this.ranking();
    this.lastResults = rows;
    this.setPhase('finished', this.cfg.resultsSec);
    for (const p of this.world.players.values()) {
      p.offer = null;
      p.inputQueue = [];
    }
    for (const v of this.clients.values()) {
      this.send(v.clientId, { t: 'results', matchId: this.matchId, rows, you: v.playerId, nextIn: this.cfg.resultsSec });
    }
    try {
      this.opts.onMatchEnd?.(rows, this);
    } catch (e) {
      this.log('warn', 'onMatchEnd failed', { err: String(e) });
    }
    this.log('info', 'match_end', { room: this.id, match: this.matchId, winner: rows[0]?.name });
  }

  /** Classificação: pontos ↓, abates ↓, mortes ↑, ordem de entrada ↑ (desempate estável). */
  ranking(): ResultRow[] {
    const list = [...this.world.players.values()];
    list.sort(
      (a, b) =>
        Math.floor(b.score) - Math.floor(a.score) || b.kills - a.kills || a.deaths - b.deaths || a.joinOrder - b.joinOrder,
    );
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.isBot,
      score: Math.floor(p.score),
      kills: p.kills,
      deaths: p.deaths,
      level: p.level,
      maxLevel: p.maxLevel,
      biomass: Math.floor(p.totalBiomass),
      muts: [...p.mutations],
      hyb: [...p.hybrids],
      build: encodeBuild(p.mutations),
      hue: p.hue,
      look: p.look,
    }));
  }

  private broadcastToast(text: string, kind: 'info' | 'warn' | 'good' | 'hybrid') {
    for (const v of this.clients.values()) this.send(v.clientId, { t: 'toast', text, kind });
  }

  tick(dt: number) {
    const w = this.world;
    const cfg = this.cfg;

    // fases
    if (this.phase === 'waiting') {
      if (this.connectedHumans >= cfg.minHumansToStart) {
        this.setPhase('preparing', cfg.prepareSec);
        this.broadcastToast('A partida vai começar!', 'good');
      }
    } else if (this.phase === 'preparing') {
      if (this.connectedHumans < cfg.minHumansToStart) this.setPhase('waiting', 0);
      else if (w.t >= this.phaseEndsAt) {
        this.setPhase('playing', cfg.matchDurationSec);
        w.protectAll(cfg.spawnProtectionSec);
        this.broadcastToast('Evolua ou seja devorado!', 'good');
      }
    } else if (this.phase === 'playing') {
      const left = this.timeLeft();
      for (const mark of [60, cfg.finalCountdownSec, 10]) {
        if (left <= mark && !this.warned.has(mark)) {
          this.warned.add(mark);
          this.broadcastToast(`${mark} segundos restantes!`, 'warn');
        }
      }
      if (left <= 0) this.finishMatch();
    } else if (this.phase === 'finished') {
      if (w.t >= this.phaseEndsAt) {
        this.startNewMatch();
        this.setPhase(this.connectedHumans >= cfg.minHumansToStart ? 'preparing' : 'waiting', cfg.prepareSec);
      }
    }

    // bots
    this.botCheckT -= dt;
    if (this.botCheckT <= 0) {
      this.botCheckT = 1;
      if (this.phase !== 'finished') this.balanceBots();
    }
    if (this.phase !== 'finished') {
      for (const p of w.players.values()) if (p.bot) p.bot.update(w, p, dt);
    }

    // remove desconectados após a janela
    for (const p of [...w.players.values()]) {
      if (!p.isBot && !p.connected && w.t - p.disconnectedAt > cfg.reconnectWindowSec) {
        w.removePlayer(p.id);
        this.log('info', 'expired', { room: this.id, player: p.id });
      }
    }

    if (this.phase !== 'finished') w.step(dt);
    else w.t += dt;

    // mensagens pessoais e avisos
    for (const m of w.outbox) {
      const p = w.players.get(m.playerId);
      if (p?.clientId && p.connected) this.send(p.clientId, m.msg);
    }
    w.outbox = [];
    for (const t of w.globalToasts) this.broadcastToast(t.text, t.kind);
    w.globalToasts = [];
    for (const id of w.metaDirty) this.metaVersion.set(id, (this.metaVersion.get(id) ?? 0) + 1);
    w.metaDirty.clear();
    if (this.phase === 'playing') {
      this.chat.onEvents(w, w.events);
      let leader: Player | undefined;
      for (const p of w.players.values()) if (!leader || p.score > leader.score) leader = p;
      this.chat.tick(w, leader);
    } else if (this.phase === 'finished') this.chat.tick(w, undefined);
    this.pendingEvents.push(...w.events);
    w.events = [];

    this.tickInSnap++;
    if (this.tickInSnap >= Math.max(1, Math.round(cfg.tickRate / cfg.snapshotRate))) {
      this.tickInSnap = 0;
      this.sendSnapshots();
      this.pendingEvents = [];
    }
  }

  /* ---------------------------------------------------------------- */
  /* Snapshots com área de interesse                                   */
  /* ---------------------------------------------------------------- */

  private selfState(p: Player): SelfState {
    const w = this.world;
    const [bmPrev, bmNext] = w.thresholds(p);
    const abilities = abilitiesFor(p.mutations);
    const cdMax: SelfState['cdMax'] = {};
    for (const a of abilities) cdMax[a] = p.stats.cooldowns[a];
    return {
      id: p.id,
      x: r1(p.x),
      y: r1(p.y),
      vx: r1(p.vx),
      vy: r1(p.vy),
      dashT: r3(p.dashT),
      dashDx: r3(p.dashDx),
      dashDy: r3(p.dashDy),
      dashSpeed: r1(p.dashSpeed),
      ms: r1(w.effMaxSpeed(p)),
      ac: r1(p.stats.accel),
      dc: r1(p.stats.decel),
      r: r1(p.stats.radius),
      hp: Math.ceil(p.hp),
      mhp: Math.round(p.stats.maxHp),
      lv: p.level,
      bm: r1(p.biomass),
      bmPrev,
      bmNext,
      sc: Math.floor(p.score),
      k: p.kills,
      d: p.deaths,
      alive: p.alive,
      respawnIn: p.alive ? 0 : Math.max(0, r1(p.respawnAt - w.t)),
      flags: this.flagsOf(p),
      muts: p.mutations,
      hyb: p.hybrids,
      abilities,
      equipped: p.equipped,
      cds: Object.fromEntries(Object.entries(p.cooldowns).map(([k, v]) => [k, r1(v ?? 0)])),
      cdMax,
      pendingEvolutions: w.pendingEvolutions(p),
    };
  }

  private flagsOf(p: Player) {
    const s = p.status;
    let f = 0;
    if (s.shieldT > 0) f |= FLAG.shield;
    if (s.cloakT > 0) f |= FLAG.cloak;
    if (s.slowT > 0) f |= FLAG.slow;
    if (s.protectT > 0) f |= FLAG.protected;
    if (p.dashT > 0) f |= FLAG.dashing;
    if (this.world.zoneAt(p.x, p.y)) f |= FLAG.inZone;
    if (s.hurtT > 0) f |= FLAG.hurt;
    if (s.armoredT > 0) f |= FLAG.armored;
    if (s.healT > 0) f |= FLAG.healing;
    if (!p.connected && !p.isBot) f |= FLAG.disconnected;
    return f;
  }

  private sendSnapshots() {
    const w = this.world;
    const vr2 = this.cfg.viewRadius ** 2;
    const slow: number = this.cfg.slowUpdateEvery;
    const ranking = [...w.players.values()].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
    const lb: LeaderRow[] = ranking.slice(0, 6).map((p) => [p.id, p.name, Math.floor(p.score), p.isBot ? 1 : 0]);
    const zones: ZoneTuple[] = w.zones.map((z) => [z.id, Math.round(z.x), Math.round(z.y), Math.round(z.r), Math.round((z.life / z.maxLife) * 100)]);
    const mm: [number, number][] = [];
    for (const p of w.players.values()) if (p.alive && w.zoneAt(p.x, p.y)) mm.push([Math.round(p.x), Math.round(p.y)]);
    const markers = w.worldMarkers();

    for (const v of this.clients.values()) {
      const me = w.players.get(v.playerId);
      if (!me) continue;
      v.snaps++;
      const cx = me.x;
      const cy = me.y;
      const players: PlayerTuple[] = [];
      const metaIds: number[] = [];
      for (const o of w.players.values()) {
        if (o === me || !w.canSee(me, o)) continue;
        players.push([
          o.id,
          r1(o.x),
          r1(o.y),
          r1(o.stats.radius),
          Math.max(0, Math.round((o.hp / o.stats.maxHp) * 100)),
          o.level,
          this.flagsOf(o),
          Math.round(o.faceX * 100),
          Math.round(o.faceY * 100),
        ]);
        metaIds.push(o.id);
      }
      // biomassa: só diferenças (adições, remoções, movimentos)
      const pa: PelletTuple[] = [];
      const pm: [number, number, number][] = [];
      const visible = new Set<number>();
      for (const pl of w.pellets.values()) {
        if (dist2(cx, cy, pl.x, pl.y) > vr2) continue;
        visible.add(pl.id);
        if (!v.knownPellets.has(pl.id)) pa.push([pl.id, Math.round(pl.x), Math.round(pl.y), r1(pl.value), pl.kind]);
        else if (pl.moved) pm.push([pl.id, Math.round(pl.x), Math.round(pl.y)]);
      }
      const pr: number[] = [];
      for (const id of v.knownPellets) if (!visible.has(id)) pr.push(id);
      v.knownPellets = visible;

      const dz: DecoyTuple[] = [];
      for (const d of w.decoys.values()) {
        if (dist2(cx, cy, d.x, d.y) > vr2) continue;
        const sp = Math.hypot(d.vx, d.vy) || 1;
        dz.push([d.id, d.ownerId, r1(d.x), r1(d.y), Math.round((d.vx / sp) * 100), Math.round((d.vy / sp) * 100)]);
        metaIds.push(d.ownerId);
      }
      const ev = this.pendingEvents
        .filter((e) => e.global || e.owner === me.id || dist2(cx, cy, e.x, e.y) <= vr2)
        .map((e) => e.ev);

      const snap: Snapshot = {
        t: 'snap',
        st: Math.round(w.t * 1000),
        ph: this.phase,
        tl: r1(this.timeLeft()),
        ack: me.lastSeq,
        me: this.selfState(me),
        p: players,
        pa,
        pr,
        pm,
        dz,
        z: zones,
        ev,
        wm: markers.length ? markers : undefined,
      };
      const isSlow = v.snaps % slow === 1 || slow === 1;
      if (isSlow) {
        snap.lb = lb;
        snap.rank = ranking.indexOf(me) + 1;
        snap.total = ranking.length;
        snap.mm = mm;
        for (const row of lb) metaIds.push(row[0]);
      }
      metaIds.push(me.id);
      const meta: Record<number, PlayerMeta> = {};
      let anyMeta = false;
      for (const id of metaIds) {
        const ver = this.metaVersion.get(id) ?? 0;
        if (v.knownMeta.get(id) === ver) continue;
        const o = w.players.get(id);
        if (!o) continue;
        v.knownMeta.set(id, ver);
        meta[id] = { name: o.name, hue: o.hue, bot: o.isBot, muts: [...o.mutations], hyb: [...o.hybrids], look: o.look };
        anyMeta = true;
      }
      if (anyMeta) snap.meta = meta;
      this.send(v.clientId, snap);
    }
  }

  private log(level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) {
    this.opts.log?.(level, msg, data);
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
