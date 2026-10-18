import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MUTATION_IDS, MUTATION_PARAMS, MUTATIONS, computeStats } from '@mutant/shared';
import { addPlayer, emptyWorld, secs, steps } from '../helpers.js';

const base = computeStats(0, []);

describe('as 12 mutações', () => {
  it('todas têm id, nome, categoria, descrição, ícone, efeito e contrajogada', () => {
    assert.equal(MUTATION_IDS.length, 12);
    const codes = new Set<string>();
    for (const id of MUTATION_IDS) {
      const m = MUTATIONS[id];
      assert.equal(m.id, id);
      for (const k of ['name', 'category', 'description', 'icon', 'effect', 'counterplay'] as const) assert.ok(m[k], `${id}.${k}`);
      codes.add(m.code);
    }
    assert.equal(codes.size, 12);
  });

  it('nenhuma mutação é só cosmética: cada uma muda atributos ou concede habilidade', () => {
    for (const id of MUTATION_IDS) {
      const s = computeStats(0, [id]);
      const changed = JSON.stringify({ ...s, cooldowns: 0, hybrids: 0 }) !== JSON.stringify({ ...base, cooldowns: 0, hybrids: 0 });
      assert.ok(changed || MUTATIONS[id].ability, `${id} sem efeito`);
    }
  });

  it('Pernas Elásticas: mais aceleração e velocidade, mais dano recebido', () => {
    const s = computeStats(0, ['pernas_elasticas']);
    assert.ok(s.accel > base.accel && s.maxSpeed > base.maxSpeed && s.damageTakenMul > base.damageTakenMul);
  });

  it('Cauda Propulsora: investida com duração, recarga e bônus de mordida', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['cauda_propulsora']);
    p.faceX = 1;
    p.faceY = 0;
    assert.equal(w.useAbility(p), 'ok');
    assert.ok(p.dashT > 0 && p.status.biteBonusT > 0);
    assert.notEqual(w.useAbility(p), 'ok', 'não reativa durante a investida');
    secs(w, 0.3);
    assert.ok(p.x - 1000 > base.maxSpeed * 0.25 * 2, 'percorre mais que a velocidade normal');
    assert.equal(w.useAbility(p), 'cooldown');
    secs(w, MUTATION_PARAMS.cauda_propulsora.cooldown);
    assert.equal(w.useAbility(p), 'ok');
  });

  it('Pele Escorregadia: lentidão mais fraca e mais curta', () => {
    const w = emptyWorld();
    const a = addPlayer(w, 500, 500, []);
    const b = addPlayer(w, 900, 900, ['pele_escorregadia']);
    w.applySlow(a, 0.45, 2);
    w.applySlow(b, 0.45, 2);
    assert.ok(b.status.slowStrength < a.status.slowStrength);
    assert.ok(b.status.slowT < a.status.slowT);
  });

  it('Salto Dimensional: reposiciona com alcance limitado e não sai da arena', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['salto_dimensional']);
    p.lastInput = { x: 1, y: 0 };
    w.useAbility(p);
    assert.equal(Math.round(p.x), 1000 + MUTATION_PARAMS.salto_dimensional.distance);
    const q = addPlayer(w, 60, 1000, ['salto_dimensional']);
    q.lastInput = { x: -1, y: 0 };
    w.useAbility(q);
    assert.ok(q.x >= q.stats.radius, 'preso ao limite');
  });

  it('Carapaça Cristalina: reduz dano e velocidade', () => {
    const w = emptyWorld();
    const a = addPlayer(w, 500, 500, []);
    const b = addPlayer(w, 900, 900, ['carapaca_cristalina']);
    assert.ok(b.stats.maxSpeed < a.stats.maxSpeed);
    assert.ok(w.damage(b, 20, -1) < w.damage(a, 20, -1));
  });

  it('Gel Regenerativo: regenera fora de combate, quase nada em combate, nunca acima do máximo', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['gel_regenerativo']);
    p.hp = 50;
    p.lastDamagedAt = -100;
    secs(w, 1);
    const outOfCombat = p.hp - 50;
    p.hp = 50;
    p.lastDamagedAt = w.t;
    secs(w, 1);
    const inCombat = p.hp - 50;
    assert.ok(outOfCombat > inCombat * 3 && inCombat > 0);
    p.lastDamagedAt = -100;
    secs(w, 60);
    assert.equal(p.hp, p.stats.maxHp);
  });

  it('Espinhos Externos: refletem dano com limite e frequência controlada', () => {
    const w = emptyWorld();
    const spiky = addPlayer(w, 1000, 1000, ['espinhos_externos']);
    const biter = addPlayer(w, 1040, 1000, []);
    biter.faceX = -1; // virado para o espinhoso
    spiky.biteCd = 99; // só o outro morde
    const hp0 = biter.hp;
    steps(w, 1);
    const reflected = hp0 - biter.hp;
    const T = MUTATION_PARAMS.espinhos_externos;
    assert.ok(reflected >= T.minDamage && reflected <= T.maxDamage);
    assert.ok(spiky.thornsIcd.has(biter.id));
  });

  it('Escudo Orgânico: bloqueia dano durante a janela e depois expira', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['escudo_organico']);
    w.useAbility(p);
    assert.equal(w.damage(p, 50, -1), 0);
    secs(w, MUTATION_PARAMS.escudo_organico.duration + 0.1);
    assert.ok(w.damage(p, 10, -1) > 0);
  });

  it('Língua Coletora: atrai biomassa dentro do alcance, não fora', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['lingua_coletora']);
    const near = w.spawnPellet(1120, 1000, 1, 0)!;
    const far = w.spawnPellet(1000, 1300, 1, 0)!;
    steps(w, 1);
    assert.ok(near.x < 1120);
    assert.equal(far.y, 1300);
    secs(w, 1);
    assert.ok(!w.pellets.has(near.id) && p.biomass >= 1);
  });

  it('Pulso Bioelétrico: dano e lentidão só em quem está perto; sem controle permanente', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['pulso_bioeletrico']);
    const near = addPlayer(w, 1120, 1000, []);
    const far = addPlayer(w, 1600, 1000, []);
    near.status.protectT = 0;
    p.biteCd = near.biteCd = 99;
    w.useAbility(p);
    assert.ok(near.hp < near.stats.maxHp && near.status.slowT > 0);
    assert.equal(far.hp, far.stats.maxHp);
    secs(w, MUTATION_PARAMS.pulso_bioeletrico.slowDuration + 0.05);
    assert.equal(near.status.slowT, 0);
    w.applySlow(near, 0.45, 2);
    assert.equal(near.status.slowT, 0, 'imune logo após a lentidão');
  });

  it('Isca Biológica: chamariz temporário, um por vez, estoura com mordida', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['isca_biologica']);
    p.lastInput = { x: 1, y: 0 };
    w.useAbility(p);
    assert.equal(w.decoys.size, 1);
    p.cooldowns = {};
    w.useAbility(p);
    assert.equal(w.decoys.size, 1, 'máximo de 1 ativa');
    secs(w, MUTATION_PARAMS.isca_biologica.duration + 0.1);
    assert.equal(w.decoys.size, 0);
    p.cooldowns = {};
    w.useAbility(p);
    const d = [...w.decoys.values()][0]!;
    const biter = addPlayer(w, d.x + 30, d.y, []);
    biter.faceX = -1;
    biter.faceY = 0;
    steps(w, 2);
    assert.equal(w.decoys.size, 0, 'mordida estoura a isca');
  });

  it('Camuflagem: esconde de longe, aparece de perto, não dá invulnerabilidade', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, ['camuflagem']);
    assert.equal(w.useAbility(p), 'ok');
    assert.equal(w.canSee({ x: 1500, y: 1000 }, p), false);
    assert.equal(w.canSee({ x: 1150, y: 1000 }, p), true);
    assert.ok(w.damage(p, 10, -1) > 0);
    assert.equal(p.status.cloakT, 0, 'dano revela');
  });

  it('Camuflagem é recusada dentro de zona de energia', () => {
    const w = emptyWorld();
    w.zones = [{ id: 1, x: 1000, y: 1000, r: 200, life: 50, maxLife: 50 }];
    const p = addPlayer(w, 1000, 1000, ['camuflagem']);
    assert.equal(w.useAbility(p), 'in_zone');
    assert.equal(p.cooldowns.cloak, undefined, 'sem gastar recarga');
  });
});
