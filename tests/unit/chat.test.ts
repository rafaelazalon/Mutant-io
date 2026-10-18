import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAME_CONFIG, QUICK_CHAT, TICK_DT, parseC2S, type ChatMsg, type S2C } from '@mutant/shared';
import { MatchRoom, PERSONAS } from '@mutant/sim';

const cfg = { ...GAME_CONFIG, prepareSec: 1, matchDurationSec: 90, resultsSec: 2 };

function setup(personas = true) {
  const inbox: S2C[] = [];
  const room = new MatchRoom({ id: 't', code: 'CHAT1', isPrivate: false, seed: 11, cfg, botFill: 8, personas });
  room.setSender((_c, m) => inbox.push(m));
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s / TICK_DT); i++) room.tick(TICK_DT);
  };
  const chats = () => inbox.filter((m): m is { t: 'chat'; m: ChatMsg } => m.t === 'chat').map((m) => m.m);
  return { room, run, chats };
}

describe('chat e personagens de IA', () => {
  it('os 4 personagens entram como bots marcados e conversam durante a partida', () => {
    const { room, run, chats } = setup();
    room.join('a', 'Ana');
    run(80);
    const names = new Set(Object.values(PERSONAS).map((p) => p.name));
    const personaBots = [...room.world.players.values()].filter((p) => p.persona);
    assert.equal(personaBots.length, 4);
    assert.ok(personaBots.every((p) => p.isBot && names.has(p.name)), 'personagens são sempre bots');
    const ai = chats().filter((m) => m.k === 0);
    assert.ok(ai.length >= 5, `falas: ${ai.length}`);
    assert.ok(ai.every((m) => names.has(m.n)), 'só personagens falam como IA');
    assert.ok(new Set(ai.map((m) => m.n)).size >= 3, 'vários personagens participam');
    assert.ok(ai.every((m) => !/\{\w\}/.test(m.s)), 'sem marcadores sobrando');
    // espaço mínimo entre falas para dar para ler
    const ids = ai.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('chat rápido: só frases prontas, com limite de frequência', () => {
    const { room, run, chats } = setup();
    room.join('a', 'Ana');
    run(2);
    assert.equal(parseC2S({ t: 'qc', i: 99 }), null);
    assert.equal(parseC2S({ t: 'qc', i: 'oi' }), null);
    assert.deepEqual(parseC2S({ t: 'qc', i: 0, s: 'texto livre' }), { t: 'qc', i: 0 });
    assert.equal(room.handle('a', { t: 'qc', i: 0 }), true);
    assert.equal(room.handle('a', { t: 'qc', i: 1 }), false, 'muito rápido');
    run(3);
    assert.equal(room.handle('a', { t: 'qc', i: 3 }), true);
    const mine = chats().filter((m) => m.k === 1);
    assert.deepEqual(mine.map((m) => m.s), [QUICK_CHAT[0], QUICK_CHAT[3]]);
    assert.equal(mine[0]!.n, 'Ana');
  });

  it('pode ser desligado', () => {
    const { room, run, chats } = setup(false);
    room.join('a', 'Ana');
    run(40);
    assert.equal([...room.world.players.values()].filter((p) => p.persona).length, 0);
    assert.equal(chats().filter((m) => m.k === 0).length, 0);
  });
});
