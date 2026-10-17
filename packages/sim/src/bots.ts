import { HYBRIDS, MUTATION_PARAMS, dist2, hybridsCompletedBy, type AbilityId, type MutationId } from '@mutant/shared';
import type { Player } from './entities.js';
import type { World } from './world.js';

export type BotDifficulty = 'facil' | 'normal' | 'dificil';

const PROFILE: Record<BotDifficulty, { think: number; aggression: number; abilityUse: number; pickDelay: number; noise: number }> = {
  facil: { think: 0.6, aggression: 0.25, abilityUse: 0.3, pickDelay: 4, noise: 0.5 },
  normal: { think: 0.35, aggression: 0.6, abilityUse: 0.6, pickDelay: 2.5, noise: 0.25 },
  dificil: { think: 0.2, aggression: 0.75, abilityUse: 0.9, pickDelay: 1.2, noise: 0.08 },
};

export const BOT_NAMES = [
  'Ameba Ágil', 'Protozorro', 'Glóbulo', 'Mixomiceto', 'Tardígrado', 'Paramécio', 'Bactériox', 'Esporo',
  'Cílio Veloz', 'Plasmódio', 'Rotífero', 'Diatomácea', 'Hidra', 'Vorticela', 'Nematoide', 'Euglena',
];

/**
 * Cérebro de bot. Usa só o que um cliente legítimo veria (World.canSee) e
 * age pelas mesmas portas que um jogador: entrada, habilidade, escolha.
 */
export class BotBrain {
  private thinkT = 0;
  private pickT = 0;
  private goal: { x: number; y: number } | null = null;
  private mode: 'collect' | 'chase' | 'flee' | 'zone' = 'collect';
  private targetId = -1;
  readonly prof: (typeof PROFILE)[BotDifficulty];

  constructor(
    readonly difficulty: BotDifficulty,
    private readonly rand: () => number,
  ) {
    this.prof = PROFILE[difficulty];
  }

  update(w: World, p: Player, dt: number) {
    if (p.offer) {
      this.pickT += dt;
      if (this.pickT >= this.prof.pickDelay) {
        this.pickT = 0;
        w.choose(p, p.offer.id, this.preferredPick(p, p.offer.options));
      }
    }
    if (!p.alive) return;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.prof.think * (0.7 + this.rand() * 0.6);
      this.decide(w, p);
    }
    this.steer(w, p);
  }

  private preferredPick(p: Player, options: MutationId[]): MutationId {
    // prioriza completar um híbrido; senão escolhe aleatoriamente
    for (const o of options) if (hybridsCompletedBy(p.mutations, o).length) return o;
    for (const o of options) {
      for (const h of Object.values(HYBRIDS)) if (h.requires.includes(o) && h.requires.some((r) => p.mutations.includes(r))) return o;
    }
    return options[Math.floor(this.rand() * options.length)]!;
  }

  private decide(w: World, p: Player) {
    let threat: Player | null = null;
    let prey: Player | null = null;
    let threatD = Infinity;
    let preyD = Infinity;
    for (const o of w.players.values()) {
      if (o === p || !w.canSee(p, o)) continue;
      const d = dist2(p.x, p.y, o.x, o.y);
      const stronger = o.level > p.level + 1 || (o.hp > p.hp * 1.6 && o.level >= p.level);
      if (stronger && d < 420 * 420 && d < threatD) {
        threat = o;
        threatD = d;
      } else if (!stronger && d < 520 * 520 && d < preyD && o.status.protectT <= 0) {
        prey = o;
        preyD = d;
      }
    }
    const hpFrac = p.hp / p.stats.maxHp;
    if (threat && (hpFrac < 0.6 || this.rand() > this.prof.aggression)) {
      this.mode = 'flee';
      this.targetId = threat.id;
      this.tryAbility(w, p, ['shield', 'blink', 'decoy', 'cloak', 'dash'], Math.sqrt(threatD));
    } else if (prey && hpFrac > 0.35 && this.rand() < this.prof.aggression + 0.2) {
      this.mode = 'chase';
      this.targetId = prey.id;
      const d = Math.sqrt(preyD);
      if (d < 280) this.tryAbility(w, p, ['pulse', 'dash'], d);
      if (hpFrac < 0.5) this.tryAbility(w, p, ['shield'], d);
    } else {
      this.targetId = -1;
      const zone = w.zones[0] && p.level >= 2 && this.rand() < this.prof.aggression ? this.nearestZone(w, p) : null;
      if (zone) {
        this.mode = 'zone';
        this.goal = zone;
      } else {
        this.mode = 'collect';
        this.goal = this.nearestPellet(w, p);
        if (this.rand() < 0.05) this.tryAbility(w, p, ['cloak'], 999);
      }
    }
  }

  private tryAbility(w: World, p: Player, prefs: AbilityId[], dist: number) {
    if (this.rand() > this.prof.abilityUse) return;
    const list = w.abilities(p);
    for (const a of prefs) {
      const i = list.indexOf(a);
      if (i < 0 || (p.cooldowns[a] ?? 0) > 0) continue;
      if (a === 'pulse' && dist > MUTATION_PARAMS.pulso_bioeletrico.radius + 40 && !p.hybrids.includes('cacador_aproximacao')) continue;
      w.equip(p, i);
      if (w.useAbility(p) === 'ok') return;
    }
  }

  private nearestPellet(w: World, p: Player) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const pl of w.pellets.values()) {
      if (w.inHazard(pl.x, pl.y, 30)) continue;
      const d = dist2(p.x, p.y, pl.x, pl.y) / (pl.value + 0.5);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    return best ? { x: best.x, y: best.y } : { x: w.W / 2, y: w.H / 2 };
  }

  private nearestZone(w: World, p: Player) {
    let best = w.zones[0]!;
    for (const z of w.zones) if (dist2(p.x, p.y, z.x, z.y) < dist2(p.x, p.y, best.x, best.y)) best = z;
    return { x: best.x, y: best.y };
  }

  private steer(w: World, p: Player) {
    let tx = 0;
    let ty = 0;
    const target = this.targetId >= 0 ? w.players.get(this.targetId) : undefined;
    if (target && w.canSee(p, target)) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const s = this.mode === 'flee' ? -1 : 1;
      tx = (dx / d) * s;
      ty = (dy / d) * s;
    } else if (this.goal) {
      const dx = this.goal.x - p.x;
      const dy = this.goal.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      tx = dx / d;
      ty = dy / d;
      if (d < 20) this.thinkT = 0;
    }
    // evitar ácido
    for (const h of w.hazards) {
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const d = Math.hypot(dx, dy) || 1;
      const m = h.r + p.stats.radius + 70;
      if (d < m) {
        const k = ((m - d) / m) * 2.5;
        tx += (dx / d) * k;
        ty += (dy / d) * k;
      }
    }
    // evitar paredes
    const edge = 120;
    if (p.x < edge) tx += (edge - p.x) / edge;
    if (p.x > w.W - edge) tx -= (p.x - (w.W - edge)) / edge;
    if (p.y < edge) ty += (edge - p.y) / edge;
    if (p.y > w.H - edge) ty -= (p.y - (w.H - edge)) / edge;
    tx += (this.rand() - 0.5) * this.prof.noise;
    ty += (this.rand() - 0.5) * this.prof.noise;
    const m = Math.hypot(tx, ty);
    p.lastInput = m > 0.01 ? { x: tx / Math.max(1, m), y: ty / Math.max(1, m) } : { x: 0, y: 0 };
  }
}
