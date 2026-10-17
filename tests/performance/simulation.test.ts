import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAME_CONFIG, TICK_DT } from '@mutant/shared';
import { MatchRoom } from '@mutant/sim';

describe('desempenho', () => {
  it('sala cheia (20 jogadores) simula 6 minutos com tick e banda dentro do orçamento', () => {
    const room = new MatchRoom({ id: 'perf', code: 'PERF1', isPrivate: false, seed: 3, botFill: 20 });
    let bytes = 0;
    let snaps = 0;
    room.setSender((_c, m) => {
      if (m.t === 'snap') {
        bytes += JSON.stringify(m).length;
        snaps++;
      }
    });
    // 4 humanos simulados + 16 bots
    for (const c of ['h1', 'h2', 'h3', 'h4']) room.join(c, c);
    let seq = 0;
    const ticks = Math.round((GAME_CONFIG.prepareSec + GAME_CONFIG.matchDurationSec) / TICK_DT);
    const t0 = performance.now();
    let worst = 0;
    for (let i = 0; i < ticks; i++) {
      seq++;
      for (const c of ['h1', 'h2', 'h3', 'h4']) room.handle(c, { t: 'in', s: seq, x: Math.cos(i / 50 + c.length), y: Math.sin(i / 40) });
      const s = performance.now();
      room.tick(TICK_DT);
      worst = Math.max(worst, performance.now() - s);
    }
    const avg = (performance.now() - t0) / ticks;
    const kbps = ((bytes / snaps) * GAME_CONFIG.snapshotRate * 8) / 1000;
    console.log(`tick médio ${avg.toFixed(3)} ms · pior ${worst.toFixed(2)} ms · snapshot ${Math.round(bytes / snaps)} B · ~${kbps.toFixed(0)} kbps por cliente`);
    assert.equal(room.world.players.size, 20);
    assert.ok(avg < 3, 'tick médio abaixo de 3 ms (orçamento: 33 ms)');
    assert.ok(kbps < 250, 'banda por cliente adequada a redes móveis');
  });
});
