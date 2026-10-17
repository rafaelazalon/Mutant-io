/**
 * Parâmetros centrais de partida, rede e arena.
 * Todos são valores iniciais de teste — ajuste aqui, não espalhe números pelo código.
 */
export const GAME_CONFIG = {
  /** Frequência da simulação autoritativa (ticks por segundo). */
  tickRate: 30,
  /** Snapshots enviados por segundo a cada cliente. */
  snapshotRate: 15,
  /** Leaderboard / minimapa: a cada N snapshots. */
  slowUpdateEvery: 15,

  maxPlayersPerRoom: 20,
  /** Humanos necessários para iniciar a preparação. */
  minHumansToStart: 1,
  /** Bots preenchem a sala até este total de jogadores (0 desliga). */
  botFillTarget: 8,

  prepareSec: 5,
  matchDurationSec: 360,
  finalCountdownSec: 30,
  resultsSec: 12,

  reconnectWindowSec: 20,
  respawnDelaySec: 4,
  spawnProtectionSec: 2.5,
  /** Tempo máximo para escolher uma mutação antes da escolha automática. */
  offerTimeoutSec: 15,

  arena: { width: 3200, height: 3200 },
  /** Raio de interesse: entidades além disso não são enviadas ao cliente. */
  viewRadius: 1150,
  /** Jogadores camuflados só aparecem para quem está a esta distância. */
  cloakRevealRadius: 260,

  biomass: {
    maxPellets: 260,
    richPelletChance: 0.08,
    normalValue: 1,
    richValue: 3,
    spawnPerSecBase: 1,
    spawnPerSecPerPlayer: 0.45,
    pelletRadius: 7,
    /** Fração da biomassa da vítima que vira partículas no chão. */
    killDropFraction: 0.4,
    /** Fração da biomassa que a vítima mantém ao renascer. */
    deathKeepFraction: 0.5,
    maxDropPellets: 24,
  },

  zones: {
    count: 3,
    radius: 230,
    minLifeSec: 45,
    maxLifeSec: 70,
    biomassPerSec: 0.6,
    scorePerSec: 2,
  },

  hazards: {
    count: 5,
    minRadius: 110,
    maxRadius: 170,
    damagePerSec: 10,
  },

  score: {
    perBiomass: 1,
    killBase: 25,
    killPerVictimLevel: 3,
  },

  net: {
    maxMessageBytes: 1024,
    /** Token bucket por conexão. */
    msgPerSec: 70,
    msgBurst: 120,
    /** Violações seguidas antes de desconectar. */
    maxViolations: 200,
    maxInputQueue: 10,
    maxConnectionsPerIp: 8,
  },
} as const;

type Widen<T> = T extends number ? number : T extends object ? { readonly [K in keyof T]: Widen<T[K]> } : T;
/** Tipo da configuração com números livres (permite variações, ex.: partidas de treino curtas). */
export type GameConfig = Widen<typeof GAME_CONFIG>;
export const TICK_DT = 1 / GAME_CONFIG.tickRate;
