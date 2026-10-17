import { HYBRID_PARAMS, MUTATION_PARAMS, PLAYER_BASE, STAT_LIMITS } from './balance.js';
import { clamp } from './math.js';
import { hybridsFor, type AbilityId, type HybridId, type MutationId } from './mutations.js';

export interface DerivedStats {
  radius: number;
  maxHp: number;
  biteDamage: number;
  biteCooldown: number;
  maxSpeed: number;
  accel: number;
  decel: number;
  /** Multiplicador de dano recebido (1 = normal). */
  damageTakenMul: number;
  slowStrengthMul: number;
  slowDurationMul: number;
  regenPctPerSec: number;
  inCombatRegenPctPerSec: number;
  magnetRange: number;
  thorns: boolean;
  cooldowns: Record<AbilityId, number>;
  hybrids: HybridId[];
}

/**
 * Calcula atributos a partir do nível e das mutações.
 * Função pura e determinística: nada acumula entre chamadas (sem acúmulo infinito).
 */
export function computeStats(level: number, mutations: readonly MutationId[]): DerivedStats {
  const has = new Set(mutations);
  const hybrids = hybridsFor(mutations);
  const hy = new Set(hybrids);
  const P = MUTATION_PARAMS;
  const B = PLAYER_BASE;

  let speedMul = 1 - B.speedLossPerLevel * level;
  let accelMul = 1;
  let decelMul = 1;
  let dmgTaken = 1;
  let slowStrengthMul = 1;
  let slowDurationMul = 1;
  let regen = 0;
  let regenCombat = 0;
  let magnet = 0;

  if (has.has('pernas_elasticas')) {
    accelMul *= P.pernas_elasticas.accelMul;
    speedMul *= P.pernas_elasticas.speedMul;
    dmgTaken += P.pernas_elasticas.damageTakenAdd;
  }
  if (has.has('pele_escorregadia')) {
    slowStrengthMul *= P.pele_escorregadia.slowStrengthMul;
    slowDurationMul *= P.pele_escorregadia.slowDurationMul;
    decelMul *= P.pele_escorregadia.decelMul;
  }
  if (has.has('carapaca_cristalina')) {
    dmgTaken += P.carapaca_cristalina.damageTakenAdd;
    speedMul *= P.carapaca_cristalina.speedMul;
  }
  if (has.has('gel_regenerativo')) {
    regen = P.gel_regenerativo.regenPctPerSec;
    regenCombat = P.gel_regenerativo.inCombatRegenPctPerSec;
  }
  if (has.has('lingua_coletora')) magnet = P.lingua_coletora.range;

  const cooldowns: Record<AbilityId, number> = {
    dash: P.cauda_propulsora.cooldown,
    blink: P.salto_dimensional.cooldown,
    shield: hy.has('mutante_resistencia') ? HYBRID_PARAMS.mutante_resistencia.cooldown : P.escudo_organico.cooldown,
    pulse: hy.has('cacador_aproximacao') ? HYBRID_PARAMS.cacador_aproximacao.cooldown : P.pulso_bioeletrico.cooldown,
    decoy: P.isca_biologica.cooldown,
    cloak: P.camuflagem.cooldown,
  };
  for (const k of Object.keys(cooldowns) as AbilityId[]) {
    cooldowns[k] = Math.max(STAT_LIMITS.minCooldown, cooldowns[k]);
  }

  return {
    radius: B.radius + B.radiusPerLevel * level,
    maxHp: B.maxHp + B.maxHpPerLevel * level,
    biteDamage: B.biteDamage + B.biteDamagePerLevel * level,
    biteCooldown: B.biteCooldown,
    maxSpeed: B.maxSpeed * clamp(speedMul, STAT_LIMITS.speedMulMin, STAT_LIMITS.speedMulMax),
    accel: B.accel * Math.min(accelMul, STAT_LIMITS.accelMulMax),
    decel: B.decel * decelMul,
    damageTakenMul: clamp(dmgTaken, STAT_LIMITS.damageTakenMulMin, STAT_LIMITS.damageTakenMulMax),
    slowStrengthMul,
    slowDurationMul,
    regenPctPerSec: Math.min(regen, STAT_LIMITS.regenPctMaxPerSec),
    inCombatRegenPctPerSec: Math.min(regenCombat, STAT_LIMITS.regenPctMaxPerSec),
    magnetRange: magnet,
    thorns: has.has('espinhos_externos'),
    cooldowns,
    hybrids,
  };
}
