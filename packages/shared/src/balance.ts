/**
 * Balanceamento: atributos base, curva de evolução e parâmetros de cada mutação.
 * Valores iniciais — sujeitos a ajuste após playtests.
 */
export const PLAYER_BASE = {
  radius: 22,
  radiusPerLevel: 2.2,
  maxHp: 100,
  maxHpPerLevel: 14,
  biteDamage: 11,
  biteDamagePerLevel: 1.6,
  biteCooldown: 0.75,
  biteReachExtra: 10,
  biteKnockback: 140,
  maxSpeed: 250,
  speedLossPerLevel: 0.025,
  accel: 1400,
  decel: 1100,
} as const;

/** Limites absolutos aplicados depois de somar todas as mutações. */
export const STAT_LIMITS = {
  damageTakenMulMin: 0.4,
  damageTakenMulMax: 1.5,
  /** Piso global, inclusive com efeitos temporários (escudo é tratado à parte). */
  damageTakenMulFloor: 0.35,
  speedMulMin: 0.6,
  speedMulMax: 1.3,
  accelMulMax: 1.8,
  slowMaxStrength: 0.5,
  minCooldown: 1,
  regenPctMaxPerSec: 0.03,
} as const;

/**
 * Biomassa acumulada necessária para cada nível (índice 0 = nível 1).
 * Cada nível concede uma escolha de mutação.
 */
export const LEVEL_THRESHOLDS = [10, 25, 45, 75, 115, 165, 230, 310, 400] as const;
export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export function levelForBiomass(biomass: number): number {
  let lv = 0;
  for (const t of LEVEL_THRESHOLDS) {
    if (biomass >= t) lv++;
    else break;
  }
  return lv;
}

export const MUTATION_PARAMS = {
  pernas_elasticas: { accelMul: 1.6, speedMul: 1.1, damageTakenAdd: 0.1 },
  cauda_propulsora: { duration: 0.25, speedMul: 3, cooldown: 6, biteBonusMul: 1.5, biteBonusWindow: 0.35 },
  pele_escorregadia: { slowStrengthMul: 0.5, slowDurationMul: 0.6, decelMul: 0.8 },
  salto_dimensional: { distance: 220, cooldown: 8 },
  carapaca_cristalina: { damageTakenAdd: -0.25, speedMul: 0.9 },
  gel_regenerativo: { regenPctPerSec: 0.02, inCombatRegenPctPerSec: 0.005, combatWindow: 3 },
  espinhos_externos: { reflectFraction: 0.3, minDamage: 3, maxDamage: 15, perAttackerCooldown: 0.5 },
  escudo_organico: { duration: 1.5, cooldown: 12 },
  lingua_coletora: { range: 140, pullSpeed: 320 },
  pulso_bioeletrico: { radius: 170, slowStrength: 0.45, slowDuration: 2, damage: 8, cooldown: 9 },
  isca_biologica: { duration: 3, speed: 220, cooldown: 10, maxActive: 1 },
  camuflagem: { duration: 4, cooldown: 12, visibleAlpha: 0.15 },
} as const;

export const HYBRID_PARAMS = {
  /** Cauda + Carapaça: investida com redução de dano extra durante e logo após. */
  investida_blindada: { damageReduction: 0.4, extraWindow: 0.4, knockback: 320 },
  /** Língua + Camuflagem: coleta melhorada enquanto camuflado. */
  coletor_furtivo: { cloakedRange: 240, cloakedValueMul: 1.25 },
  /** Pernas + Pulso: o pulso vira "Bote" — avanço curto seguido do pulso. */
  cacador_aproximacao: { lungeDuration: 0.18, lungeSpeedMul: 2.6, radius: 150, cooldown: 10 },
  /** Gel + Escudo: escudo também cura ao longo do tempo; recarga maior. */
  mutante_resistencia: { healPct: 0.15, healDuration: 3, cooldown: 14 },
} as const;

/** Imunidade a lentidão após uma lentidão terminar (impede controle permanente). */
export const SLOW_IMMUNITY_SEC = 1.5;
