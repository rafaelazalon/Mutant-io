import {
  DEFAULT_LOOK,
  computeStats,
  type AbilityId,
  type DerivedStats,
  type HybridId,
  type MoveBody,
  type MutationId,
  type Look,
} from '@mutant/shared';
import type { BotBrain } from './bots.js';

export interface QueuedInput {
  seq: number;
  x: number;
  y: number;
}

export interface Offer {
  id: number;
  options: MutationId[];
  expiresAt: number;
}

export interface PlayerStatus {
  shieldT: number;
  cloakT: number;
  slowT: number;
  slowStrength: number;
  slowImmuneT: number;
  protectT: number;
  /** janela de proteção da Investida Blindada */
  armoredT: number;
  /** bônus de mordida após investida */
  biteBonusT: number;
  /** cura ao longo do tempo (Mutante de Resistência) */
  healT: number;
  healPerSec: number;
  /** pulso pendente ao fim do Bote (Caçador de Aproximação) */
  pendingPulse: boolean;
  hurtT: number;
}

export interface Player extends MoveBody {
  id: number;
  clientId: string | null;
  name: string;
  hue: number;
  /** aparência equipada (só visual; já validada pelo servidor) */
  look: Look;
  isBot: boolean;
  bot: BotBrain | null;
  /** personagem de IA com falas no chat (só bots, ou o jogador controlado pela IA nos vídeos) */
  persona?: 'bolado' | 'zoeiro' | 'tagarela' | 'narrador';
  joinOrder: number;

  connected: boolean;
  disconnectedAt: number;
  reconnectToken: string;

  alive: boolean;
  respawnAt: number;

  faceX: number;
  faceY: number;

  hp: number;
  biomass: number;
  totalBiomass: number;
  score: number;
  kills: number;
  deaths: number;
  maxLevel: number;
  /** abates seguidos sem morrer */
  streak: number;
  bestStreak: number;

  mutations: MutationId[];
  hybrids: HybridId[];
  stats: DerivedStats;
  level: number;

  offer: Offer | null;
  equipped: number;
  cooldowns: Partial<Record<AbilityId, number>>;
  biteCd: number;
  thornsIcd: Map<number, number>;
  lastDamagedAt: number;
  lastHitBy: number;

  status: PlayerStatus;

  inputQueue: QueuedInput[];
  lastInput: { x: number; y: number };
  lastSeq: number;
  /** ticks sem entrada nova (cliente travado ou aba oculta) */
  idleTicks: number;
  /** pedido de habilidade pendente (aplicado no próximo tick) */
  wantAbility: boolean;
}

export function freshStatus(): PlayerStatus {
  return {
    shieldT: 0,
    cloakT: 0,
    slowT: 0,
    slowStrength: 0,
    slowImmuneT: 0,
    protectT: 0,
    armoredT: 0,
    biteBonusT: 0,
    healT: 0,
    healPerSec: 0,
    pendingPulse: false,
    hurtT: 0,
  };
}

export function createPlayer(init: {
  id: number;
  clientId: string | null;
  name: string;
  hue: number;
  isBot: boolean;
  joinOrder: number;
  token: string;
  look?: Look;
}): Player {
  const stats = computeStats(0, []);
  return {
    id: init.id,
    clientId: init.clientId,
    name: init.name,
    hue: init.hue,
    look: init.look ?? { ...DEFAULT_LOOK },
    isBot: init.isBot,
    bot: null,
    joinOrder: init.joinOrder,
    connected: true,
    disconnectedAt: 0,
    reconnectToken: init.token,
    alive: false,
    respawnAt: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dashT: 0,
    dashDx: 0,
    dashDy: 0,
    dashSpeed: 0,
    faceX: 1,
    faceY: 0,
    hp: stats.maxHp,
    biomass: 0,
    totalBiomass: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    maxLevel: 0,
    streak: 0,
    bestStreak: 0,
    mutations: [],
    hybrids: [],
    stats,
    level: 0,
    offer: null,
    equipped: 0,
    cooldowns: {},
    biteCd: 0,
    thornsIcd: new Map(),
    lastDamagedAt: -999,
    lastHitBy: -1,
    status: freshStatus(),
    inputQueue: [],
    lastInput: { x: 0, y: 0 },
    lastSeq: 0,
    idleTicks: 0,
    wantAbility: false,
  };
}

export interface Pellet {
  id: number;
  x: number;
  y: number;
  value: number;
  kind: 0 | 1 | 2 | 3;
  /** movida pela língua neste tick */
  moved: boolean;
}

export interface Zone {
  id: number;
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
}

export interface Hazard {
  x: number;
  y: number;
  r: number;
}

export interface Decoy {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
}
