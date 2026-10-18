import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JoinNotifier } from '../../apps/server/src/notify/notifier.js';

describe('aviso de jogadores (ntfy)', () => {
  it('desligado sem NOTIFY_URL', async () => {
    let calls = 0;
    const n = new JoinNotifier({ url: '', minGapSec: 0, fetchFn: (async () => { calls++; return new Response(); }) as typeof fetch });
    n.playerJoined('Ana', 1);
    await n.flush();
    assert.equal(calls, 0);
  });

  it('avisa na hora e agrupa quem entra durante o intervalo', async () => {
    const bodies: string[] = [];
    let t = 0;
    const n = new JoinNotifier({
      url: 'https://ntfy.sh/teste',
      minGapSec: 120,
      now: () => t,
      fetchFn: (async (_u: string, init: RequestInit) => { bodies.push(String(init.body)); return new Response(); }) as unknown as typeof fetch,
    });
    n.playerJoined('Ana', 1);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(bodies.length, 1);
    assert.match(bodies[0]!, /Ana entrou/);
    t = 10_000;
    n.playerJoined('Bia', 2);
    n.playerJoined('Caio', 3);
    assert.equal(bodies.length, 1, 'não manda de novo antes do intervalo');
    await n.flush();
    assert.match(bodies[1]!, /2 jogadores entraram: Bia, Caio/);
    assert.match(bodies[1]!, /Online agora: 3/);
    n.close();
  });
});
