import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAME_CONFIG, TICK_DT, TokenBucket, decodeBuild, encodeBuild, parseC2S, sanitizeName, type S2C } from '@mutant/shared';
import { MatchRoom } from '@mutant/sim';

const fast = { ...GAME_CONFIG, prepareSec: 1, matchDurationSec: 5, resultsSec: 1, reconnectWindowSec: 2 };

function makeRoom(botFill = 4) {
  const inbox = new Map<string, S2C[]>();
  const room = new MatchRoom({ id: 't', code: 'TEST1', isPrivate: false, seed: 7, cfg: fast, botFill });
  room.setSender((c, m) => {
    if (!inbox.has(c)) inbox.set(c, []);
    inbox.get(c)!.push(m);
  });
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s / TICK_DT); i++) room.tick(TICK_DT);
  };
  return { room, inbox, run };
}

describe('ciclo da partida', () => {
  it('waiting → preparing → playing → finished → nova partida', () => {
    const { room, inbox, run } = makeRoom();
    assert.equal(room.phase, 'waiting');
    room.join('a', 'Ana');
    run(0.1);
    assert.equal(room.phase, 'preparing');
    run(1.1);
    assert.equal(room.phase, 'playing');
    run(5.1);
    assert.equal(room.phase, 'finished');
    const res = inbox.get('a')!.find((m) => m.t === 'results');
    assert.ok(res && res.t === 'results' && res.rows.length === room.world.players.size);
    run(1.1);
    assert.equal(room.phase, 'preparing');
    assert.ok(inbox.get('a')!.some((m) => m.t === 'newMatch'));
  });

  it('classificação com desempate estável (pontos, abates, mortes, ordem de entrada)', () => {
    const { room } = makeRoom(0);
    room.join('a', 'A');
    room.join('b', 'B');
    room.join('c', 'C');
    const [a, b, c] = [...room.world.players.values()];
    a!.score = 10;
    b!.score = 10;
    c!.score = 10;
    b!.kills = 1;
    c!.deaths = 1;
    assert.deepEqual(room.ranking().map((r) => r.name), ['B', 'A', 'C']);
  });

  it('bots preenchem a sala, são identificados e saem quando humanos entram', () => {
    const { room, run } = makeRoom(4);
    room.join('a', 'Ana');
    run(1.2);
    assert.equal(room.botCount, 3);
    assert.ok([...room.world.players.values()].filter((p) => p.isBot).every((p) => p.bot));
    room.join('b', 'Beto');
    run(1.2);
    assert.equal(room.botCount, 2);
  });

  it('quem entra tarde recebe biomassa de recuperação limitada', () => {
    const { room, run } = makeRoom(0);
    room.join('a', 'Ana');
    run(1.3);
    const a = room.playerByClient('a')!;
    room.world.gainBiomass(a, 100);
    room.join('b', 'Beto');
    const b = room.playerByClient('b')!;
    assert.ok(b.biomass > 0 && b.biomass <= 40);
  });

  it('desconexão mantém o jogador pela janela; token reconecta uma única vez', () => {
    const { room, inbox, run } = makeRoom(0);
    room.join('a', 'Ana');
    const w = inbox.get('a')!.find((m) => m.t === 'welcome');
    assert.ok(w && w.t === 'welcome');
    const id = room.playerByClient('a')!.id;
    room.leave('a', false);
    run(0.5);
    assert.ok(room.world.players.has(id));
    const r = room.reconnect('a2', w.token);
    assert.ok(r && r.ok && r.playerId === id);
    room.leave('a2', false);
    assert.equal(room.reconnect('a3', w.token), null, 'token antigo não serve mais');
    run(2.5);
    assert.equal(room.world.players.has(id), false, 'removido após a janela');
  });

  it('escolha de mutação de uma partida anterior é rejeitada', () => {
    const { room, run } = makeRoom(0);
    room.join('a', 'Ana');
    run(1.3);
    const p = room.playerByClient('a')!;
    room.world.gainBiomass(p, 10);
    run(0.1);
    const oldOffer = p.offer!;
    run(7);
    room.world.gainBiomass(p, 10);
    run(0.1);
    assert.equal(room.handle('a', { t: 'pick', o: oldOffer.id, m: oldOffer.options[0] }), false);
  });
});

describe('segurança e protocolo', () => {
  it('mensagens malformadas são recusadas e campos extras ignorados', () => {
    assert.equal(parseC2S(null), null);
    assert.equal(parseC2S({ t: 'hack' }), null);
    assert.equal(parseC2S({ t: 'pick', o: 1, m: 'super_mutacao' }), null);
    assert.equal(parseC2S({ t: 'in', s: -1, x: 0, y: 0 }), null);
    const m = parseC2S({ t: 'in', s: 3, x: 5, y: 5, biomass: 9999 });
    assert.ok(m && m.t === 'in' && !('biomass' in m) && Math.abs(Math.hypot(m.x, m.y) - 1) < 1e-9, 'magnitude limitada a 1');
    assert.deepEqual(parseC2S({ t: 'in', s: 3, x: NaN, y: 'a' }), { t: 'in', s: 3, x: 0, y: 0 });
  });

  it('nomes são higienizados', () => {
    assert.equal(sanitizeName('<script>alert(1)</script>'), 'scriptalert(1)/s');
    assert.equal(sanitizeName('‮abc\u0000'), 'abc');
    assert.equal(sanitizeName(''), 'Mutante');
    assert.equal(sanitizeName('x'.repeat(40)).length, 16);
  });

  it('token bucket limita rajadas', () => {
    let t = 0;
    const b = new TokenBucket(10, 5, () => t);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (b.take()) ok++;
    assert.equal(ok, 5);
    t += 1000;
    assert.equal(b.take(), true);
  });

  it('inundar entradas não acelera o jogador (um passo por tick)', () => {
    const { room, run } = makeRoom(0);
    room.join('a', 'Ana');
    run(1.3);
    const p = room.playerByClient('a')!;
    const x0 = p.x;
    let seq = 1;
    for (let tick = 0; tick < 30; tick++) {
      for (let k = 0; k < 50; k++) room.handle('a', { t: 'in', s: seq++, x: 1, y: 0 });
      room.tick(TICK_DT);
    }
    assert.ok(p.x - x0 <= p.stats.maxSpeed * 1.0 + 1, `andou ${p.x - x0}`);
    assert.ok(p.inputQueue.length <= GAME_CONFIG.net.maxInputQueue);
  });

  it('entradas fora de ordem/duplicadas são descartadas', () => {
    const { room } = makeRoom(0);
    room.join('a', 'Ana');
    assert.equal(room.handle('a', { t: 'in', s: 5, x: 1, y: 0 }), true);
    assert.equal(room.handle('a', { t: 'in', s: 5, x: 1, y: 0 }), false);
    assert.equal(room.handle('a', { t: 'in', s: 4, x: 1, y: 0 }), false);
  });

  it('código de build é reversível e rejeita códigos inválidos', () => {
    const b = encodeBuild(['cauda_propulsora', 'carapaca_cristalina']);
    assert.equal(b, 'MX-BE');
    assert.deepEqual(decodeBuild(b), ['cauda_propulsora', 'carapaca_cristalina']);
    assert.equal(decodeBuild('MX-BB'), null);
    assert.equal(decodeBuild('lixo'), null);
  });
});

describe('habilidade por espaço', () => {
  it('ab com índice equipa e usa aquela habilidade; índice inválido é recusado', () => {
    const room = new MatchRoom({ id: 'ab', code: 'ABAB1', isPrivate: false, seed: 2, cfg: fast, botFill: 0 });
    room.setSender(() => {});
    room.join('a', 'Ana');
    for (let i = 0; i < 40; i++) room.tick(TICK_DT);
    const p = room.playerByClient('a')!;
    p.level = 2;
    p.mutations = ['escudo_organico', 'camuflagem'];
    room.world.recompute(p);
    assert.equal(room.handle('a', { t: 'ab', i: 1 }), true);
    room.tick(TICK_DT);
    assert.ok(p.status.cloakT > 0 && (p.cooldowns.cloak ?? 0) > 0);
    assert.equal(room.handle('a', { t: 'ab', i: 5 }), false);
  });
});
