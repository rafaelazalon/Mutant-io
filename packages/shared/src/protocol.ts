import { sanitizeAxis } from './movement.js';
import { isMutationId, type AbilityId, type HybridId, type MutationId } from './mutations.js';
import { sanitizeLook, type Look } from './cosmetics.js';

/* ------------------------------------------------------------------ */
/* Cliente → servidor                                                  */
/* ------------------------------------------------------------------ */

export type JoinMode = 'public' | 'create' | 'code';

export type C2S =
  | { t: 'join'; name: string; mode: JoinMode; code?: string; token?: string; look?: Look; acct?: string }
  | { t: 'in'; s: number; x: number; y: number }
  | { t: 'ab'; i?: number }
  | { t: 'eq'; i: number }
  | { t: 'pick'; o: number; m: MutationId }
  | { t: 'ping'; c: number }
  | { t: 'leave' }
  | { t: 'qc'; i: number };

/** Chat rápido: só frases prontas (sem texto livre, então não há o que moderar). */
export const QUICK_CHAT = ['GG! 🤝', 'Socorro! 😱', 'Vem pro X1! 😤', 'Kkkkk 😂', 'Que mutação é essa?! 🧬', 'Bora caçar o líder! 👑', 'Desculpa aí 😅', 'Partiu zona de energia ⚡'] as const;

/** Mensagem do chat. k: 0 = personagem de IA (bot), 1 = chat rápido de jogador, 2 = sistema. */
export interface ChatMsg {
  id: number;
  n: string;
  h: number;
  s: string;
  k: 0 | 1 | 2;
  pid?: number;
}

const NAME_MAX = 16;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Mutante';
  // remove controles, marcas invisíveis e espaços repetidos
  const clean = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return clean || 'Mutante';
}

export function sanitizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(c) ? c : null;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Valida e normaliza uma mensagem recebida. Retorna null se for inválida.
 * Nunca confia em campos extras: reconstrói o objeto só com o necessário.
 */
export function parseC2S(raw: unknown): C2S | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'in': {
      if (!isInt(m.s) || m.s < 0 || m.s > 2 ** 31) return null;
      const [x, y] = sanitizeAxis(m.x, m.y);
      return { t: 'in', s: m.s, x, y };
    }
    case 'ab':
      // i opcional: usa diretamente a habilidade daquele espaço (botões na tela)
      if (m.i === undefined) return { t: 'ab' };
      if (!isInt(m.i) || m.i < 0 || m.i > 11) return null;
      return { t: 'ab', i: m.i };
    case 'eq':
      if (!isInt(m.i) || m.i < 0 || m.i > 11) return null;
      return { t: 'eq', i: m.i };
    case 'pick':
      if (!isInt(m.o) || m.o < 0 || !isMutationId(m.m)) return null;
      return { t: 'pick', o: m.o, m: m.m };
    case 'ping':
      if (typeof m.c !== 'number' || !Number.isFinite(m.c)) return null;
      return { t: 'ping', c: m.c };
    case 'leave':
      return { t: 'leave' };
    case 'qc':
      if (!isInt(m.i) || m.i < 0 || m.i >= QUICK_CHAT.length) return null;
      return { t: 'qc', i: m.i };
    case 'join': {
      const mode = m.mode === 'create' || m.mode === 'code' ? m.mode : 'public';
      const code = sanitizeRoomCode(m.code) ?? undefined;
      if (mode === 'code' && !code) return null;
      const token = typeof m.token === 'string' && /^[a-f0-9]{32}$/.test(m.token) ? m.token : undefined;
      // conta: código secreto MX-XXXX-XXXX-XXXX-XXXX (validado no servidor contra o banco)
      const acct = typeof m.acct === 'string' && /^MX(-[A-Z2-9]{4}){4}$/.test(m.acct) ? m.acct : undefined;
      return { t: 'join', name: sanitizeName(m.name), mode, code, token, look: m.look === undefined ? undefined : sanitizeLook(m.look), acct };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Servidor → cliente                                                  */
/* ------------------------------------------------------------------ */

export type Phase = 'waiting' | 'preparing' | 'playing' | 'finished';

/** Bits de estado visual enviados por jogador. */
export const FLAG = {
  shield: 1,
  cloak: 2,
  slow: 4,
  protected: 8,
  dashing: 16,
  inZone: 32,
  hurt: 64,
  armored: 128,
  healing: 256,
  disconnected: 512,
} as const;

/** [id, x, y, raio, vida%, nível, flags, faceX*100, faceY*100] */
export type PlayerTuple = [number, number, number, number, number, number, number, number, number];
/** [id, x, y, valor, tipo(0 normal|1 rica|2 drop|3 célula dourada)] */
export type PelletTuple = [number, number, number, number, number];
/** [id, donoId, x, y, faceX*100, faceY*100] */
export type DecoyTuple = [number, number, number, number, number, number];
/** [id, x, y, raio, vida restante 0–100] */
export type ZoneTuple = [number, number, number, number, number];
/** [x, y, raio] */
export type HazardTuple = [number, number, number];

export interface PlayerMeta {
  name: string;
  hue: number;
  bot: boolean;
  muts: MutationId[];
  hyb: HybridId[];
  look: Look;
}

export type GameEvent =
  | { k: 'bite'; a: number; b: number; d: number; x: number; y: number; back?: 1 }
  | { k: 'blocked'; b: number }
  | { k: 'thorns'; a: number; b: number; d: number }
  | { k: 'pulse'; a: number; x: number; y: number; r: number }
  | { k: 'dash'; a: number }
  | { k: 'blink'; a: number; fx: number; fy: number; tx: number; ty: number }
  | { k: 'shield'; a: number }
  | { k: 'cloak'; a: number }
  | { k: 'decoy'; a: number }
  | { k: 'pop'; x: number; y: number }
  | { k: 'evo'; a: number; m: MutationId }
  | { k: 'hybrid'; a: number; h: HybridId }
  | { k: 'kill'; a: number; b: number; x: number; y: number; back?: 1; an?: string; bn?: string }
  | { k: 'streak'; a: number; n: number }
  | { k: 'rain'; x: number; y: number; r: number }
  | { k: 'superSpawn'; x: number; y: number }
  | { k: 'acid'; b: number; d: number }
  | { k: 'eat'; a: number; x: number; y: number };

export interface SelfState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dashT: number;
  dashDx: number;
  dashDy: number;
  dashSpeed: number;
  ms: number;
  ac: number;
  dc: number;
  r: number;
  hp: number;
  mhp: number;
  lv: number;
  bm: number;
  /** biomassa do nível atual e do próximo, para a barra de evolução */
  bmPrev: number;
  bmNext: number;
  sc: number;
  k: number;
  d: number;
  alive: boolean;
  respawnIn: number;
  flags: number;
  muts: MutationId[];
  hyb: HybridId[];
  abilities: AbilityId[];
  equipped: number;
  /** recarga restante por habilidade */
  cds: Partial<Record<AbilityId, number>>;
  cdMax: Partial<Record<AbilityId, number>>;
  pendingEvolutions: number;
}

export interface Snapshot {
  t: 'snap';
  /** tempo do servidor em ms */
  st: number;
  ph: Phase;
  tl: number;
  ack: number;
  me: SelfState | null;
  p: PlayerTuple[];
  pa: PelletTuple[];
  pr: number[];
  pm: [number, number, number][];
  dz: DecoyTuple[];
  z: ZoneTuple[];
  ev: GameEvent[];
  meta?: Record<number, PlayerMeta>;
  lb?: LeaderRow[];
  rank?: number;
  total?: number;
  /** pontos do minimapa: jogadores em zonas de energia (visíveis para todos) */
  mm?: [number, number][];
  /** marcadores do mundo: [tipo 0=chuva de biomassa (aviso) | 1=célula dourada, x, y, segundos] */
  wm?: [number, number, number, number][];
}

/** [id, nome, pontos, bot(0|1)] */
export type LeaderRow = [number, string, number, number];

export interface ResultRow {
  id: number;
  name: string;
  bot: boolean;
  score: number;
  kills: number;
  deaths: number;
  level: number;
  maxLevel: number;
  biomass: number;
  muts: MutationId[];
  hyb: HybridId[];
  build: string;
  hue: number;
  look: Look;
}

export interface Welcome {
  t: 'welcome';
  you: number;
  token: string;
  room: { id: string; code: string; private: boolean };
  arena: { w: number; h: number };
  hazards: HazardTuple[];
  tickRate: number;
  snapshotRate: number;
  matchId: number;
  reconnected: boolean;
}

export type S2C =
  | Welcome
  | Snapshot
  | { t: 'offer'; id: number; opts: MutationId[]; exp: number }
  | { t: 'offerClosed'; id: number }
  | { t: 'toast'; text: string; kind: 'info' | 'warn' | 'good' | 'hybrid' }
  | { t: 'chat'; m: ChatMsg }
  | { t: 'results'; matchId: number; rows: ResultRow[]; you: number; nextIn: number }
  | { t: 'newMatch'; matchId: number; hazards: HazardTuple[] }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: string; msg: string }
  | { t: 'kicked'; reason: string };
