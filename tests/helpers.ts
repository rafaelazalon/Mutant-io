import { GAME_CONFIG, TICK_DT, type GameConfig, type MutationId } from '@mutant/shared';
import { World, createPlayer, type Player } from '@mutant/sim';

let nextId = 1;

/** Mundo de teste vazio (sem biomassa, sem ácido, sem zonas) para isolar regras. */
export function emptyWorld(seed = 1): World {
  const w = new World(seed, GAME_CONFIG);
  w.pellets.clear();
  w.hazards = [];
  w.zones = [];
  w.combatEnabled = true;
  w.collectEnabled = true;
  // sem geração automática de biomassa nos testes
  (w as unknown as { cfg: GameConfig }).cfg = {
    ...GAME_CONFIG,
    biomass: { ...GAME_CONFIG.biomass, spawnPerSecBase: 0, spawnPerSecPerPlayer: 0 },
  };
  return w;
}

export function addPlayer(w: World, x: number, y: number, muts: MutationId[] = [], opts: { level?: number; bot?: boolean } = {}): Player {
  const p = createPlayer({ id: nextId++, clientId: null, name: `P${nextId}`, hue: 0, isBot: opts.bot ?? true, joinOrder: nextId, token: '' });
  w.addPlayer(p);
  p.alive = true;
  p.x = x;
  p.y = y;
  p.level = opts.level ?? Math.max(muts.length, 0);
  p.mutations = [...muts];
  w.recompute(p);
  p.hp = p.stats.maxHp;
  p.status.protectT = 0;
  p.biteCd = 0;
  return p;
}

export function steps(w: World, n: number) {
  for (let i = 0; i < n; i++) w.step(TICK_DT);
}

export function secs(w: World, s: number) {
  steps(w, Math.round(s / TICK_DT));
}
