import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAME_CONFIG, LEVEL_THRESHOLDS, PLAYER_BASE, TICK_DT, levelForBiomass, stepMovement, type MoveBody } from '@mutant/shared';
import { addPlayer, emptyWorld, secs, steps } from '../helpers.js';

describe('combate', () => {
  it('mordida automática causa dano e respeita a recarga', () => {
    const w = emptyWorld();
    const a = addPlayer(w, 1000, 1000, []);
    const b = addPlayer(w, 1040, 1000, []);
    b.biteCd = 99;
    b.faceX = -1; // de frente para o atacante (sem bônus pelas costas)
    steps(w, 1);
    const dealt = b.stats.maxHp - b.hp;
    assert.ok(Math.abs(dealt - PLAYER_BASE.biteDamage) < 1e-6);
    b.x = a.x + 40;
    steps(w, 1);
    assert.ok(Math.abs(b.stats.maxHp - b.hp - dealt) < 1e-6, 'não morde de novo antes da recarga');
  });

  it('mordida só acerta à frente; pelas costas causa mais dano', () => {
    const w = emptyWorld();
    const a = addPlayer(w, 1000, 1000, []);
    const b = addPlayer(w, 1040, 1000, []);
    a.faceX = -1; // atacante virado para longe: não morde
    a.faceY = 0;
    b.biteCd = 99;
    steps(w, 1);
    assert.equal(b.hp, b.stats.maxHp, 'sem mordida por trás do próprio atacante');
    a.faceX = 1;
    b.faceX = 1; // alvo de costas
    b.x = a.x + 40;
    b.y = a.y;
    steps(w, 1);
    const dealt = b.stats.maxHp - b.hp;
    assert.ok(Math.abs(dealt - PLAYER_BASE.biteDamage * GAME_CONFIG.combat.backstabMul) < 1e-6);
    assert.ok(w.events.some((e) => e.ev.k === 'bite' && e.ev.back === 1), 'evento marca pelas costas');
  });

  it('sequência de abates dá bônus crescente e zera ao morrer', () => {
    const w = emptyWorld();
    const a = addPlayer(w, 1000, 1000, []);
    const v1 = addPlayer(w, 1400, 1000, []);
    const v2 = addPlayer(w, 1800, 1000, []);
    const s0 = a.score;
    w.kill(v1, a.id);
    const first = a.score - s0;
    w.kill(v2, a.id);
    const second = a.score - s0 - first;
    assert.equal(a.streak, 2);
    assert.ok(second > first, 'segundo abate seguido vale mais');
    w.kill(a, -1);
    assert.equal(a.streak, 0);
    assert.equal(a.bestStreak, 2);
  });

  it('proteção de nascimento: não morde e não é mordido', () => {
    const w = emptyWorld();
    const a = addPlayer(w, 1000, 1000, []);
    const b = addPlayer(w, 1040, 1000, []);
    a.status.protectT = 2;
    steps(w, 1);
    assert.equal(a.hp, a.stats.maxHp);
    assert.equal(b.hp, b.stats.maxHp);
  });

  it('eliminação: derruba biomassa, pontua o abatedor, vítima renasce com metade e regride', () => {
    const w = emptyWorld();
    const killer = addPlayer(w, 1000, 1000, []);
    const v = addPlayer(w, 2000, 2000, ['carapaca_cristalina', 'escudo_organico', 'camuflagem'], { level: 3 });
    v.biomass = LEVEL_THRESHOLDS[2]!;
    v.level = levelForBiomass(v.biomass);
    w.damage(v, 9999, killer.id);
    assert.equal(v.alive, false);
    assert.equal(killer.kills, 1);
    assert.ok(killer.score >= GAME_CONFIG.score.killBase);
    assert.ok(w.pellets.size > 0, 'biomassa no chão');
    assert.ok(Math.abs(v.biomass - LEVEL_THRESHOLDS[2]! * 0.5) < 1e-9);
    assert.ok(v.mutations.length <= v.level, 'mutações acima do nível foram removidas');
    secs(w, GAME_CONFIG.respawnDelaySec + 0.1);
    assert.equal(v.alive, true);
    assert.ok(v.status.protectT > 0);
  });

  it('ácido causa dano contínuo e credita o último agressor', () => {
    const w = emptyWorld();
    w.hazards = [{ x: 1000, y: 1000, r: 150 }];
    const a = addPlayer(w, 2000, 2000, []);
    const v = addPlayer(w, 1000, 1000, []);
    w.damage(v, v.hp - 1, a.id);
    secs(w, 0.5);
    assert.equal(v.alive, false);
    assert.equal(a.kills, 1);
  });
});

describe('evolução', () => {
  it('oferece 3 mutações diferentes e ainda não obtidas ao subir de nível', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, []);
    w.gainBiomass(p, LEVEL_THRESHOLDS[0]!);
    steps(w, 1);
    assert.ok(p.offer);
    assert.equal(new Set(p.offer!.options).size, 3);
    assert.ok(w.outbox.some((m) => m.msg.t === 'offer'));
  });

  it('rejeita escolhas não oferecidas, duplicadas ou de ofertas antigas', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, []);
    w.gainBiomass(p, LEVEL_THRESHOLDS[0]!);
    steps(w, 1);
    const o = p.offer!;
    const notOffered = ['pernas_elasticas', 'cauda_propulsora', 'pele_escorregadia', 'salto_dimensional'].find((m) => !o.options.includes(m as never))!;
    assert.equal(w.choose(p, o.id, notOffered as never), false);
    assert.equal(w.choose(p, o.id + 1, o.options[0]!), false);
    assert.equal(w.choose(p, o.id, o.options[0]!), true);
    assert.equal(w.choose(p, o.id, o.options[1]!), false, 'mensagem duplicada ignorada');
    assert.equal(p.mutations.length, 1);
  });

  it('escolhe automaticamente quando o tempo esgota', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, []);
    w.gainBiomass(p, LEVEL_THRESHOLDS[1]!);
    steps(w, 1);
    secs(w, GAME_CONFIG.offerTimeoutSec + 0.1);
    assert.equal(p.mutations.length, 1);
    assert.ok(p.offer, 'segunda evolução pendente gera nova oferta');
  });
});

describe('biomassa', () => {
  it('uma partícula só pode ser coletada uma vez, mesmo com dois jogadores em cima', () => {
    const w = emptyWorld();
    const a = addPlayer(w, 1000, 1000, []);
    const b = addPlayer(w, 1000, 1000, []);
    a.biteCd = b.biteCd = 99;
    w.spawnPellet(1000, 1000, 1, 0);
    steps(w, 1);
    assert.equal(a.biomass + b.biomass, 1);
  });

  it('respeita o limite de partículas no mapa', () => {
    const w = emptyWorld();
    for (let i = 0; i < 1000; i++) w.spawnPellet();
    assert.ok(w.pellets.size <= GAME_CONFIG.biomass.maxPellets);
  });
});

describe('movimento', () => {
  it('previsão do cliente reproduz exatamente o servidor com as mesmas entradas', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1600, 1600, ['pernas_elasticas']);
    const body: MoveBody = { x: p.x, y: p.y, vx: 0, vy: 0, dashT: 0, dashDx: 0, dashDy: 0, dashSpeed: 0 };
    for (let i = 1; i <= 120; i++) {
      const x = Math.cos(i / 10);
      const y = Math.sin(i / 7) * 0.5;
      p.inputQueue.push({ seq: i, x, y });
      w.step(TICK_DT);
      stepMovement(body, x, y, { maxSpeed: p.stats.maxSpeed, accel: p.stats.accel, decel: p.stats.decel, radius: p.stats.radius }, TICK_DT, w.W, w.H);
    }
    assert.ok(Math.abs(body.x - p.x) < 1e-6 && Math.abs(body.y - p.y) < 1e-6);
  });

  it('não ultrapassa a velocidade máxima nem os limites da arena', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 100, 100, []);
    for (let i = 0; i < 300; i++) {
      p.inputQueue.push({ seq: i + 1, x: -Math.SQRT1_2, y: -Math.SQRT1_2 });
      w.step(TICK_DT);
      assert.ok(Math.hypot(p.vx, p.vy) <= p.stats.maxSpeed + 1e-6);
    }
    assert.ok(p.x >= p.stats.radius && p.y >= p.stats.radius);
  });

  it('cliente parado (sem entradas) é freado pelo servidor', () => {
    const w = emptyWorld();
    const p = addPlayer(w, 1000, 1000, [], { bot: false });
    p.inputQueue.push({ seq: 1, x: 1, y: 0 });
    secs(w, 2);
    assert.ok(Math.hypot(p.vx, p.vy) < 1);
  });
});

describe('eventos do mapa', () => {
  it('chuva de biomassa: avisa, marca no mapa e depois derruba células ricas', () => {
    const w = emptyWorld();
    (w as unknown as { nextRainAt: number }).nextRainAt = 0;
    steps(w, 1);
    assert.ok(w.rain, 'chuva anunciada');
    const mk = w.worldMarkers();
    assert.equal(mk[0]?.[0], 0);
    assert.equal(w.pellets.size, 0, 'nada cai durante o aviso');
    secs(w, GAME_CONFIG.events.rainWarnSec + 0.2);
    assert.equal(w.rain, null);
    assert.ok(w.pellets.size >= GAME_CONFIG.events.rainPellets * 0.7);
  });

  it('célula dourada: uma por vez, vale muito e volta depois de comida', () => {
    const w = emptyWorld();
    (w as unknown as { nextSuperAt: number }).nextSuperAt = 0;
    steps(w, 1);
    const cell = w.pellets.get(w.superCellId)!;
    assert.equal(cell.kind, 3);
    assert.equal(cell.value, GAME_CONFIG.events.superValue);
    assert.ok(w.worldMarkers().some((m) => m[0] === 1));
    const p = addPlayer(w, cell.x, cell.y, []);
    steps(w, 2);
    assert.ok(p.biomass >= GAME_CONFIG.events.superValue);
    steps(w, 1);
    assert.equal(w.superCellId, -1);
  });
});
