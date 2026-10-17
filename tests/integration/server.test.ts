import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import type { S2C } from '@mutant/shared';

/**
 * Integração com o servidor real: processo Node + WebSocket.
 * Dois clientes reais entram na mesma sala, enviam comandos e recebem o estado autoritativo.
 */
const PORT = 3100 + Math.floor(Math.random() * 500);
const root = join(import.meta.dirname, '../..');
let srv: ChildProcess;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TestClient {
  ws: WebSocket;
  msgs: S2C[] = [];
  closed = false;
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(String(e.data)));
    this.ws.onclose = () => (this.closed = true);
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('falha ao conectar'));
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends S2C['t']>(t: T, ms = 5000): Promise<Extract<S2C, { t: T }>> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = this.msgs.find((x) => x.t === t);
      if (m) return m as Extract<S2C, { t: T }>;
      await sleep(20);
    }
    throw new Error(`sem mensagem ${t}`);
  }
  lastSnap() {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i]!.t === 'snap') return this.msgs[i] as Extract<S2C, { t: 'snap' }>;
    return null;
  }
}

before(async () => {
  srv = spawn(join(root, 'node_modules/.bin/tsx'), ['--tsconfig', join(root, 'tsconfig.json'), join(root, 'apps/server/src/index.ts')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'warn', BOT_FILL: '4' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await sleep(100);
  }
  throw new Error('servidor não subiu');
});

after(() => {
  srv?.kill('SIGTERM');
});

describe('servidor multiplayer', () => {
  it('dois clientes reais compartilham a mesma sala e o mesmo estado', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'join', name: 'Ana', mode: 'create' });
    const wa = await a.waitFor('welcome');
    const b = new TestClient();
    await b.open();
    b.send({ t: 'join', name: 'Beto', mode: 'code', code: wa.room.code });
    const wb = await b.waitFor('welcome');
    assert.equal(wb.room.id, wa.room.id);
    assert.notEqual(wb.you, wa.you);

    await sleep(5300); // preparação
    const before = a.lastSnap()!.me!;
    for (let s = 1; s <= 30; s++) {
      a.send({ t: 'in', s, x: 1, y: 0 });
      await sleep(33);
    }
    await sleep(300);
    const snapA = a.lastSnap()!;
    assert.equal(snapA.ph, 'playing');
    assert.ok(snapA.me!.x - before.x > 150, 'servidor aplicou o movimento');
    assert.ok(snapA.ack >= 25, 'servidor confirmou as entradas');
    // ambos recebem o mesmo placar da sala (2 humanos + bots)
    const lbA = a.msgs.filter((m) => m.t === 'snap' && m.total).pop() as Extract<S2C, { t: 'snap' }>;
    const lbB = b.msgs.filter((m) => m.t === 'snap' && m.total).pop() as Extract<S2C, { t: 'snap' }>;
    assert.equal(lbA.total, lbB.total);
    assert.equal(lbA.total, 4);
    a.ws.close();
    b.ws.close();
  });

  it('código de sala inexistente retorna erro claro', async () => {
    const c = new TestClient();
    await c.open();
    c.send({ t: 'join', name: 'X', mode: 'code', code: 'ZZZZZ' });
    const e = await c.waitFor('error');
    assert.equal(e.code, 'room_not_found');
    c.ws.close();
  });

  it('reconexão com token devolve o mesmo jogador', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'join', name: 'Rita', mode: 'public' });
    const w = await a.waitFor('welcome');
    a.ws.close();
    await sleep(200);
    const a2 = new TestClient();
    await a2.open();
    a2.send({ t: 'join', name: 'Rita', mode: 'public', token: w.token });
    const w2 = await a2.waitFor('welcome');
    assert.equal(w2.reconnected, true);
    assert.equal(w2.you, w.you);
    a2.ws.close();
  });

  it('cliente que inunda mensagens inválidas é desconectado', async () => {
    const c = new TestClient();
    await c.open();
    for (let i = 0; i < 400; i++) c.ws.send('{lixo');
    await sleep(500);
    assert.ok(c.closed || c.msgs.some((m) => m.t === 'kicked'));
  });

  it('mensagens grandes demais derrubam a conexão', async () => {
    const c = new TestClient();
    await c.open();
    c.ws.send(JSON.stringify({ t: 'join', name: 'x'.repeat(5000), mode: 'public' }));
    await sleep(400);
    assert.equal(c.closed, true);
  });
});
