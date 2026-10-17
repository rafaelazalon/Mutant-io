import { randomBytes } from 'node:crypto';
import { GAME_CONFIG, TICK_DT, type JoinMode, type Look, type S2C } from '@mutant/shared';
import { MatchRoom, type JoinResult } from '@mutant/sim';
import { ENV } from '../env.js';
import { log } from '../logger.js';
import type { StatsRepository } from '../persistence/statsRepository.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL_SEC = 30;

function makeCode(): string {
  const b = randomBytes(5);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

/**
 * Matchmaking e ciclo de vida das salas.
 * Pública: entra na sala pública com mais jogadores que ainda tenha vaga (fora da tela de resultados).
 * Privada: cria uma sala com código de convite; outros entram pelo código.
 */
export class RoomManager {
  rooms = new Map<string, MatchRoom>();
  private byCode = new Map<string, MatchRoom>();
  private clientRoom = new Map<string, MatchRoom>();
  private nextRoom = 1;
  private acc = 0;
  private last = performance.now();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly send: (clientId: string, msg: S2C) => void,
    private readonly stats: StatsRepository,
  ) {}

  join(clientId: string, name: string, mode: JoinMode, code?: string, token?: string, look?: Look): JoinResult & { room?: MatchRoom } {
    this.leave(clientId, true);

    // reconexão: procura o token em todas as salas
    if (token) {
      for (const room of this.rooms.values()) {
        const r = room.reconnect(clientId, token);
        if (r) {
          this.clientRoom.set(clientId, room);
          return { ...r, room };
        }
      }
    }

    let room: MatchRoom | undefined;
    if (mode === 'code') {
      room = code ? this.byCode.get(code) : undefined;
      if (!room) return { ok: false, reason: 'room_not_found' };
    } else if (mode === 'create') {
      room = this.create(true);
      if (!room) return { ok: false, reason: 'server_full' };
    } else {
      const candidates = [...this.rooms.values()]
        .filter((r) => !r.isPrivate && r.canAcceptHuman() && r.phase !== 'finished')
        .sort((a, b) => b.humanCount - a.humanCount);
      room = candidates[0] ?? this.create(false);
      if (!room) return { ok: false, reason: 'server_full' };
    }
    const r = room.join(clientId, name, look);
    if (r.ok) this.clientRoom.set(clientId, room);
    return { ...r, room };
  }

  private create(isPrivate: boolean): MatchRoom | undefined {
    if (this.rooms.size >= ENV.maxRooms) return undefined;
    let code = makeCode();
    while (this.byCode.has(code)) code = makeCode();
    const id = `r${this.nextRoom++}`;
    const room = new MatchRoom({
      id,
      code,
      isPrivate,
      botFill: ENV.botFill,
      botDifficulty: ENV.botDifficulty,
      makeToken: () => randomBytes(16).toString('hex'),
      onMatchEnd: (rows, rm) => {
        this.stats.recordMatch(rm.id, rm.matchId, rows).catch((e) => log('warn', 'stats_failed', { err: String(e) }));
      },
      log: (level, msg, data) => log(level, msg, data),
    });
    room.setSender(this.send);
    this.rooms.set(id, room);
    this.byCode.set(code, room);
    log('info', 'room_created', { room: id, private: isPrivate });
    return room;
  }

  handle(clientId: string, msg: unknown): boolean {
    const room = this.clientRoom.get(clientId);
    if (!room) return false;
    const ok = room.handle(clientId, msg);
    if (msg && typeof msg === 'object' && (msg as { t?: unknown }).t === 'leave') this.clientRoom.delete(clientId);
    return ok;
  }

  leave(clientId: string, consented: boolean) {
    const room = this.clientRoom.get(clientId);
    if (!room) return;
    room.leave(clientId, consented);
    this.clientRoom.delete(clientId);
  }

  /** Laço de simulação com passo fixo, independente do relógio do sistema. */
  start() {
    this.last = performance.now();
    this.timer = setInterval(() => this.loop(), 1000 / GAME_CONFIG.tickRate / 2);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private loop() {
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    let steps = 0;
    while (this.acc >= TICK_DT && steps < 5) {
      this.acc -= TICK_DT;
      steps++;
      this.tickAll(TICK_DT);
    }
  }

  tickAll(dt: number) {
    for (const [id, room] of this.rooms) {
      try {
        room.tick(dt);
      } catch (e) {
        log('warn', 'room_tick_error', { room: id, err: String((e as Error)?.stack ?? e) });
      }
      if (room.humanCount === 0) {
        room.emptySince += dt;
        if (room.emptySince > EMPTY_ROOM_TTL_SEC) {
          this.rooms.delete(id);
          this.byCode.delete(room.code);
          log('info', 'room_disposed', { room: id });
        }
      } else room.emptySince = 0;
    }
  }

  summary() {
    let players = 0;
    let bots = 0;
    for (const r of this.rooms.values()) {
      players += r.humanCount;
      bots += r.botCount;
    }
    return { rooms: this.rooms.size, players, bots };
  }
}
