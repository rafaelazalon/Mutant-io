import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HYBRID_IDS, HYBRID_PARAMS, HYBRIDS, MUTATION_IDS, STAT_LIMITS, computeStats, hybridsCompletedBy, hybridsFor } from '@mutant/shared';
import { addPlayer, emptyWorld, secs, steps } from '../helpers.js';

describe('combinações híbridas', () => {
  it('requisitos: cada híbrido exige exatamente suas duas mutações', () => {
    for (const h of HYBRID_IDS) {
      const [a, b] = HYBRIDS[h].requires;
      assert.deepEqual(hybridsFor([a, b]), [h]);
      assert.deepEqual(hybridsFor([a]), []);
      assert.deepEqual(hybridsFor([b]), []);
    }
    assert.deepEqual(hybridsCompletedBy(['cauda_propulsora'], 'carapaca_cristalina'), ['investida_blindada']);
  });

  it('Investida Blindada: proteção extra só na janela da investida, depois some', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['cauda_propulsora', 'carapaca_cristalina']);
    assert.ok(p.hybrids.includes('investida_blindada'));
    const normal = w.damageMultiplier(p);
    w.useAbility(p);
    assert.ok(p.status.armoredT > 0);
    assert.ok(w.damageMultiplier(p) < normal);
    secs(w, 1);
    assert.equal(p.status.armoredT, 0);
    assert.equal(w.damageMultiplier(p), normal);
  });

  it('Coletor Furtivo: alcance e valor maiores apenas enquanto camuflado', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['lingua_coletora', 'camuflagem']);
    const pl = w.spawnPellet(1000 + HYBRID_PARAMS.coletor_furtivo.cloakedRange - 20, 1000, 1, 0)!;
    steps(w, 1);
    assert.equal(pl.x, 1000 + HYBRID_PARAMS.coletor_furtivo.cloakedRange - 20, 'sem camuflagem: fora do alcance');
    w.useAbility(p);
    secs(w, 1.5);
    assert.ok(!w.pellets.has(pl.id));
    assert.ok(Math.abs(p.biomass - HYBRID_PARAMS.coletor_furtivo.cloakedValueMul) < 1e-9);
  });

  it('Caçador de Aproximação: avanço seguido do pulso no ponto de chegada', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['pernas_elasticas', 'pulso_bioeletrico']);
    const target = addPlayer(w, 1250, 1000, []);
    p.biteCd = target.biteCd = 99;
    p.lastInput = { x: 1, y: 0 };
    w.useAbility(p);
    assert.ok(p.dashT > 0 && p.status.pendingPulse);
    assert.equal(target.hp, target.stats.maxHp, 'ainda não pulsou');
    secs(w, 0.3);
    assert.equal(p.status.pendingPulse, false);
    assert.ok(target.status.slowT > 0 && target.hp < target.stats.maxHp);
    assert.equal(p.cooldowns.pulse !== undefined, true);
  });

  it('Mutante de Resistência: escudo cura com limite e recarga maior', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['gel_regenerativo', 'escudo_organico']);
    assert.equal(p.stats.cooldowns.shield, HYBRID_PARAMS.mutante_resistencia.cooldown);
    p.hp = 40;
    p.lastDamagedAt = w.t;
    w.useAbility(p);
    secs(w, HYBRID_PARAMS.mutante_resistencia.healDuration + 0.2);
    const healed = p.hp - 40;
    const max = p.stats.maxHp * (HYBRID_PARAMS.mutante_resistencia.healPct + 0.03 * 3.3);
    assert.ok(healed > p.stats.maxHp * 0.1 && healed <= max, `curou ${healed}`);
    assert.equal(p.status.healT, 0);
  });

  it('efeitos do híbrido são removidos quando a mutação se perde', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['gel_regenerativo', 'escudo_organico'], { level: 2 });
    p.biomass = 30;
    w.useAbility(p);
    assert.ok(p.status.healT > 0);
    p.biomass = 12; // regride para o nível 1
    w.updateLevel(p);
    assert.deepEqual(p.mutations, ['gel_regenerativo']);
    assert.deepEqual(p.hybrids, []);
    assert.equal(p.status.healT, 0);
  });

  it('sem acúmulo infinito: recalcular repetidamente dá o mesmo resultado', () => {
    const all = [...MUTATION_IDS];
    const a = computeStats(9, all);
    for (let i = 0; i < 50; i++) assert.deepEqual(computeStats(9, all), a);
    for (const cd of Object.values(a.cooldowns)) assert.ok(cd >= STAT_LIMITS.minCooldown, 'recarga nunca negativa');
    assert.ok(a.damageTakenMul >= STAT_LIMITS.damageTakenMulMin);
  });

  it('piso global de redução de dano vale mesmo com carapaça + investida blindada', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['cauda_propulsora', 'carapaca_cristalina']);
    w.useAbility(p);
    assert.ok(w.damageMultiplier(p) >= STAT_LIMITS.damageTakenMulFloor);
  });
});
