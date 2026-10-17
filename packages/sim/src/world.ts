import {
  GAME_CONFIG,
  HYBRID_PARAMS,
  HYBRIDS,
  LEVEL_THRESHOLDS,
  MUTATION_IDS,
  MUTATION_PARAMS,
  MUTATIONS,
  SLOW_IMMUNITY_SEC,
  STAT_LIMITS,
  abilitiesFor,
  clamp,
  computeStats,
  createRng,
  dist2,
  levelForBiomass,
  stepMovement,
  type AbilityId,
  type GameConfig,
  type GameEvent,
  type HybridId,
  type MutationId,
  type Rng,
  type S2C,
} from '@mutant/shared';
import { freshStatus, type Decoy, type Hazard, type Pellet, type Player, type Zone } from './entities.js';

export interface LocatedEvent {
  ev: GameEvent;
  x: number;
  y: number;
  /** jogador que deve receber mesmo fora do raio de visão */
  owner?: number;
}

export interface PersonalMsg {
  playerId: number;
  msg: S2C;
}

/** Motivos de recusa de habilidade — úteis para testes e feedback. */
export type AbilityResult =
  | 'ok'
  | 'dead'
  | 'none'
  | 'cooldown'
  | 'busy'
  | 'in_zone'
  | 'disabled';

/**
 * Estado e regras autoritativas de uma partida. Não conhece rede nem clientes:
 * recebe intenções (entrada, habilidade, escolha) e produz estado + eventos.
 */
export class World {
  readonly cfg: GameConfig;
  t = 0;
  tickCount = 0;
  rng: Rng;
  players = new Map<number, Player>();
  pellets = new Map<number, Pellet>();
  zones: Zone[] = [];
  hazards: Hazard[] = [];
  decoys = new Map<number, Decoy>();
  events: LocatedEvent[] = [];
  outbox: PersonalMsg[] = [];
  globalToasts: { text: string; kind: 'info' | 'warn' | 'good' | 'hybrid' }[] = [];
  /** ids de jogadores cujo meta (mutações/nome) mudou */
  metaDirty = new Set<number>();

  combatEnabled = true;
  collectEnabled = true;

  private nextPelletId = 1;
  private nextDecoyId = 1;
  private nextZoneId = 1;
  private nextOfferId = 1;
  private pelletAcc = 0;
  /** id da partida; vai no id das ofertas para invalidar mensagens antigas */
  matchId = 1;

  constructor(seed: number, cfg: GameConfig = GAME_CONFIG) {
    this.cfg = cfg;
    this.rng = createRng(seed);
    this.resetMap(seed);
  }

  get W() {
    return this.cfg.arena.width;
  }
  get H() {
    return this.cfg.arena.height;
  }

  /* ---------------------------------------------------------------- */
  /* Mapa                                                              */
  /* ---------------------------------------------------------------- */

  resetMap(seed: number) {
    this.rng = createRng(seed);
    this.pellets.clear();
    this.decoys.clear();
    this.zones = [];
    this.hazards = [];
    const hz = this.cfg.hazards;
    let guard = 0;
    while (this.hazards.length < hz.count && guard++ < 500) {
      const r = this.rng.range(hz.minRadius, hz.maxRadius);
      const x = this.rng.range(r + 250, this.W - r - 250);
      const y = this.rng.range(r + 250, this.H - r - 250);
      if (this.hazards.some((h) => Math.hypot(h.x - x, h.y - y) < h.r + r + 300)) continue;
      this.hazards.push({ x, y, r });
    }
    for (let i = 0; i < this.cfg.zones.count; i++) this.zones.push(this.makeZone());
    for (let i = 0; i < this.cfg.biomass.maxPellets * 0.85; i++) this.spawnPellet();
  }

  private freePoint(margin: number, avoidPlayers = 0, hazardPad = 20): { x: number; y: number } {
    for (let i = 0; i < 60; i++) {
      const x = this.rng.range(margin, this.W - margin);
      const y = this.rng.range(margin, this.H - margin);
      if (this.inHazard(x, y, hazardPad)) continue;
      if (avoidPlayers > 0) {
        let ok = true;
        for (const p of this.players.values()) {
          if (p.alive && dist2(p.x, p.y, x, y) < avoidPlayers * avoidPlayers) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      return { x, y };
    }
    return { x: this.W / 2, y: this.H / 2 };
  }

  private makeZone(): Zone {
    const zc = this.cfg.zones;
    let pt = this.freePoint(zc.radius + 80);
    for (let i = 0; i < 40; i++) {
      const nearZone = this.zones.some((z) => Math.hypot(z.x - pt.x, z.y - pt.y) < z.r * 3);
      // zonas nunca sobrepõem o ácido (leitura clara do mapa)
      const nearAcid = this.hazards.some((h) => Math.hypot(h.x - pt.x, h.y - pt.y) < h.r + zc.radius + 40);
      if (!nearZone && !nearAcid) break;
      pt = this.freePoint(zc.radius + 80);
    }
    const life = this.rng.range(zc.minLifeSec, zc.maxLifeSec);
    return { id: this.nextZoneId++, x: pt.x, y: pt.y, r: zc.radius, life, maxLife: life };
  }

  inHazard(x: number, y: number, pad = 0): Hazard | null {
    for (const h of this.hazards) if (dist2(h.x, h.y, x, y) < (h.r + pad) * (h.r + pad)) return h;
    return null;
  }

  zoneAt(x: number, y: number): Zone | null {
    for (const z of this.zones) if (dist2(z.x, z.y, x, y) < z.r * z.r) return z;
    return null;
  }

  spawnPellet(x?: number, y?: number, value?: number, kind?: 0 | 1 | 2): Pellet | null {
    const b = this.cfg.biomass;
    if (x === undefined || y === undefined) {
      if (this.pellets.size >= b.maxPellets) return null;
      // 30% nascem perto de zonas de energia (áreas de maior concentração)
      if (this.zones.length && this.rng.next() < 0.3) {
        const z = this.rng.pick(this.zones);
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(z.r * 0.6, z.r * 1.6);
        x = clamp(z.x + Math.cos(a) * d, 30, this.W - 30);
        y = clamp(z.y + Math.sin(a) * d, 30, this.H - 30);
        if (this.inHazard(x, y, 10)) return null;
      } else {
        const pt = this.freePoint(30);
        x = pt.x;
        y = pt.y;
      }
      const rich = this.rng.next() < b.richPelletChance;
      kind = rich ? 1 : 0;
      value = rich ? b.richValue : b.normalValue;
    }
    const p: Pellet = {
      id: this.nextPelletId++,
      x: clamp(x, 10, this.W - 10),
      y: clamp(y, 10, this.H - 10),
      value: value ?? b.normalValue,
      kind: kind ?? 0,
      moved: false,
    };
    this.pellets.set(p.id, p);
    return p;
  }

  /* ---------------------------------------------------------------- */
  /* Jogadores                                                         */
  /* ---------------------------------------------------------------- */

  addPlayer(p: Player) {
    this.players.set(p.id, p);
    this.metaDirty.add(p.id);
  }

  removePlayer(id: number) {
    this.players.delete(id);
    for (const [did, d] of this.decoys) if (d.ownerId === id) this.decoys.delete(did);
    for (const other of this.players.values()) other.thornsIcd.delete(id);
  }

  /** Reinicia progressão para uma nova partida (mantém identidade). */
  resetPlayerForMatch(p: Player) {
    p.biomass = 0;
    p.totalBiomass = 0;
    p.score = 0;
    p.kills = 0;
    p.deaths = 0;
    p.maxLevel = 0;
    p.mutations = [];
    p.hybrids = [];
    p.level = 0;
    p.offer = null;
    p.equipped = 0;
    p.cooldowns = {};
    p.stats = computeStats(0, []);
    p.hp = p.stats.maxHp;
    p.status = freshStatus();
    p.thornsIcd.clear();
    p.lastHitBy = -1;
    p.inputQueue = [];
    this.metaDirty.add(p.id);
  }

  spawn(p: Player, catchUpBiomass = 0) {
    const pt = this.freePoint(120, 350, 90);
    p.x = pt.x;
    p.y = pt.y;
    p.vx = p.vy = 0;
    p.dashT = 0;
    p.alive = true;
    p.status = freshStatus();
    p.status.protectT = this.cfg.spawnProtectionSec;
    p.biteCd = 0.5;
    p.cooldowns = {};
    if (catchUpBiomass > 0) this.gainBiomass(p, catchUpBiomass, false);
    p.hp = p.stats.maxHp;
  }

  /** Proteção para todos quando a partida começa (ninguém é atacado no primeiro segundo). */
  protectAll(sec: number) {
    for (const p of this.players.values()) if (p.alive) p.status.protectT = Math.max(p.status.protectT, sec);
  }

  /** Biomassa média dos jogadores vivos — usada para recuperar quem entra tarde. */
  catchUpFor(): number {
    let sum = 0;
    let n = 0;
    for (const p of this.players.values()) {
      sum += p.biomass;
      n++;
    }
    if (!n) return 0;
    return Math.min(40, Math.floor((sum / n) * 0.25));
  }

  gainBiomass(p: Player, amount: number, countsScore = true) {
    if (amount <= 0) return;
    p.biomass += amount;
    p.totalBiomass += amount;
    if (countsScore) p.score += amount * this.cfg.score.perBiomass;
    this.updateLevel(p);
  }

  updateLevel(p: Player) {
    const lv = levelForBiomass(p.biomass);
    if (lv === p.level) return;
    const prevMax = p.stats.maxHp;
    p.level = lv;
    p.maxLevel = Math.max(p.maxLevel, lv);
    // regressão: remove as mutações mais recentes que excedem o nível
    if (p.mutations.length > lv) {
      p.mutations = p.mutations.slice(0, lv);
      if (p.offer) this.closeOffer(p);
      this.metaDirty.add(p.id);
    }
    this.recompute(p);
    if (p.stats.maxHp > prevMax) p.hp += p.stats.maxHp - prevMax;
    p.hp = Math.min(p.hp, p.stats.maxHp);
  }

  /** Recalcula atributos a partir do zero (sem acúmulo) e notifica híbridos novos. */
  recompute(p: Player) {
    const before = new Set(p.hybrids);
    p.stats = computeStats(p.level, p.mutations);
    p.hybrids = p.stats.hybrids;
    for (const h of p.hybrids) {
      if (!before.has(h)) {
        this.emit({ k: 'hybrid', a: p.id, h }, p.x, p.y, p.id);
        this.globalToasts.push({ text: `${p.name} formou ${HYBRIDS[h].icon} ${HYBRIDS[h].name}!`, kind: 'hybrid' });
      }
    }
    // remove efeitos de híbridos perdidos
    const now = new Set(p.hybrids);
    if (before.has('investida_blindada') && !now.has('investida_blindada')) p.status.armoredT = 0;
    if (before.has('mutante_resistencia') && !now.has('mutante_resistencia')) {
      p.status.healT = 0;
      p.status.healPerSec = 0;
    }
    if (before.has('cacador_aproximacao') && !now.has('cacador_aproximacao')) p.status.pendingPulse = false;
    const abilities = abilitiesFor(p.mutations);
    if (p.equipped >= abilities.length) p.equipped = Math.max(0, abilities.length - 1);
    p.hp = Math.min(p.hp, p.stats.maxHp);
    this.metaDirty.add(p.id);
  }

  abilities(p: Player): AbilityId[] {
    return abilitiesFor(p.mutations);
  }

  /* ---------------------------------------------------------------- */
  /* Evolução                                                          */
  /* ---------------------------------------------------------------- */

  pendingEvolutions(p: Player) {
    const unowned = MUTATION_IDS.length - p.mutations.length;
    return Math.max(0, Math.min(unowned, p.level - p.mutations.length));
  }

  private ensureOffer(p: Player) {
    if (p.offer || this.pendingEvolutions(p) <= 0) return;
    const unowned = MUTATION_IDS.filter((m) => !p.mutations.includes(m));
    const options = this.rng.shuffle([...unowned]).slice(0, 3);
    // id inclui a partida: escolhas de partidas anteriores são rejeitadas
    const id = this.matchId * 100000 + this.nextOfferId++;
    p.offer = { id, options, expiresAt: this.t + this.cfg.offerTimeoutSec };
    this.outbox.push({ playerId: p.id, msg: { t: 'offer', id, opts: options, exp: this.cfg.offerTimeoutSec } });
  }

  private closeOffer(p: Player) {
    if (!p.offer) return;
    this.outbox.push({ playerId: p.id, msg: { t: 'offerClosed', id: p.offer.id } });
    p.offer = null;
  }

  /** Valida e aplica a escolha de mutação. Retorna false para escolhas inválidas/duplicadas. */
  choose(p: Player, offerId: number, m: MutationId): boolean {
    const o = p.offer;
    if (!o || o.id !== offerId) return false;
    if (!o.options.includes(m)) return false;
    if (p.mutations.includes(m)) return false;
    if (p.mutations.length >= p.level) return false;
    p.offer = null;
    p.mutations = [...p.mutations, m];
    this.recompute(p);
    // equipa automaticamente a nova habilidade ativa
    const ab = MUTATIONS[m].ability;
    if (ab) p.equipped = Math.max(0, this.abilities(p).indexOf(ab));
    this.emit({ k: 'evo', a: p.id, m }, p.x, p.y, p.id);
    this.outbox.push({ playerId: p.id, msg: { t: 'offerClosed', id: offerId } });
    return true;
  }

  equip(p: Player, i: number): boolean {
    const n = this.abilities(p).length;
    if (!Number.isInteger(i) || i < 0 || i >= n) return false;
    p.equipped = i;
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Habilidades                                                       */
  /* ---------------------------------------------------------------- */

  private dirOf(p: Player): [number, number] {
    const m = Math.hypot(p.lastInput.x, p.lastInput.y);
    if (m > 0.1) return [p.lastInput.x / m, p.lastInput.y / m];
    return [p.faceX, p.faceY];
  }

  useAbility(p: Player): AbilityResult {
    if (!p.alive) return 'dead';
    if (!this.combatEnabled) return 'disabled';
    const list = this.abilities(p);
    const ab = list[p.equipped];
    if (!ab) return 'none';
    if ((p.cooldowns[ab] ?? 0) > 0) return 'cooldown';
    if (p.dashT > 0) return 'busy';
    const st = p.status;
    const hy = new Set(p.hybrids);
    const [dx, dy] = this.dirOf(p);

    switch (ab) {
      case 'dash': {
        const P = MUTATION_PARAMS.cauda_propulsora;
        p.dashDx = dx;
        p.dashDy = dy;
        p.dashSpeed = this.effMaxSpeed(p) * P.speedMul;
        p.dashT = P.duration;
        st.biteBonusT = P.duration + P.biteBonusWindow;
        if (hy.has('investida_blindada')) st.armoredT = P.duration + HYBRID_PARAMS.investida_blindada.extraWindow;
        this.emit({ k: 'dash', a: p.id }, p.x, p.y);
        break;
      }
      case 'blink': {
        const d = MUTATION_PARAMS.salto_dimensional.distance;
        const r = p.stats.radius;
        const fx = p.x;
        const fy = p.y;
        p.x = clamp(p.x + dx * d, r, this.W - r);
        p.y = clamp(p.y + dy * d, r, this.H - r);
        this.emit({ k: 'blink', a: p.id, fx, fy, tx: p.x, ty: p.y }, p.x, p.y);
        break;
      }
      case 'shield': {
        st.shieldT = MUTATION_PARAMS.escudo_organico.duration;
        if (hy.has('mutante_resistencia')) {
          const H = HYBRID_PARAMS.mutante_resistencia;
          st.healT = H.healDuration;
          st.healPerSec = (p.stats.maxHp * H.healPct) / H.healDuration;
        }
        this.emit({ k: 'shield', a: p.id }, p.x, p.y);
        break;
      }
      case 'pulse': {
        st.cloakT = 0;
        if (hy.has('cacador_aproximacao')) {
          const H = HYBRID_PARAMS.cacador_aproximacao;
          p.dashDx = dx;
          p.dashDy = dy;
          p.dashSpeed = this.effMaxSpeed(p) * H.lungeSpeedMul;
          p.dashT = H.lungeDuration;
          st.pendingPulse = true;
          this.emit({ k: 'dash', a: p.id }, p.x, p.y);
        } else {
          this.pulse(p, MUTATION_PARAMS.pulso_bioeletrico.radius);
        }
        break;
      }
      case 'decoy': {
        const P = MUTATION_PARAMS.isca_biologica;
        let mine = 0;
        for (const [id, d] of this.decoys) {
          if (d.ownerId === p.id) {
            mine++;
            if (mine >= P.maxActive) this.decoys.delete(id);
          }
        }
        const id = this.nextDecoyId++;
        this.decoys.set(id, { id, ownerId: p.id, x: p.x, y: p.y, vx: dx * P.speed, vy: dy * P.speed, ttl: P.duration });
        this.emit({ k: 'decoy', a: p.id }, p.x, p.y);
        break;
      }
      case 'cloak': {
        if (this.zoneAt(p.x, p.y)) return 'in_zone';
        st.cloakT = MUTATION_PARAMS.camuflagem.duration;
        this.emit({ k: 'cloak', a: p.id }, p.x, p.y);
        break;
      }
    }
    // usar habilidade encerra a proteção de nascimento
    st.protectT = 0;
    p.cooldowns[ab] = p.stats.cooldowns[ab];
    return 'ok';
  }

  private pulse(p: Player, radius: number) {
    const P = MUTATION_PARAMS.pulso_bioeletrico;
    this.emit({ k: 'pulse', a: p.id, x: p.x, y: p.y, r: radius }, p.x, p.y);
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      const rr = radius + o.stats.radius;
      if (dist2(o.x, o.y, p.x, p.y) > rr * rr) continue;
      this.damage(o, P.damage, p.id);
      this.applySlow(o, P.slowStrength, P.slowDuration);
    }
    for (const [id, d] of this.decoys) {
      if (d.ownerId !== p.id && dist2(d.x, d.y, p.x, p.y) < radius * radius) this.popDecoy(id);
    }
  }

  applySlow(o: Player, strength: number, duration: number) {
    const st = o.status;
    if (st.shieldT > 0) return;
    if (st.slowT <= 0 && st.slowImmuneT > 0) return;
    const s = Math.min(strength * o.stats.slowStrengthMul, STAT_LIMITS.slowMaxStrength);
    const d = duration * o.stats.slowDurationMul;
    st.slowStrength = Math.max(st.slowT > 0 ? st.slowStrength : 0, s);
    st.slowT = Math.max(st.slowT, d);
  }

  effMaxSpeed(p: Player) {
    return p.stats.maxSpeed * (p.status.slowT > 0 ? 1 - p.status.slowStrength : 1);
  }

  private popDecoy(id: number) {
    const d = this.decoys.get(id);
    if (!d) return;
    this.decoys.delete(id);
    this.emit({ k: 'pop', x: d.x, y: d.y }, d.x, d.y);
  }

  /* ---------------------------------------------------------------- */
  /* Dano                                                              */
  /* ---------------------------------------------------------------- */

  damageMultiplier(p: Player) {
    let m = p.stats.damageTakenMul;
    if (p.status.armoredT > 0) m *= 1 - HYBRID_PARAMS.investida_blindada.damageReduction;
    return Math.max(STAT_LIMITS.damageTakenMulFloor, m);
  }

  /** Aplica dano autoritativo. Retorna o dano efetivo. sourceId -1 = ambiente. */
  damage(target: Player, raw: number, sourceId: number): number {
    if (!target.alive || raw <= 0) return 0;
    const st = target.status;
    if (st.protectT > 0) return 0;
    if (st.shieldT > 0) {
      this.emit({ k: 'blocked', b: target.id }, target.x, target.y);
      return 0;
    }
    const dmg = raw * this.damageMultiplier(target);
    target.hp -= dmg;
    target.lastDamagedAt = this.t;
    st.hurtT = 0.15;
    st.cloakT = 0;
    if (sourceId >= 0) target.lastHitBy = sourceId;
    if (target.hp <= 0) {
      let killer = sourceId;
      if (killer < 0 && target.lastHitBy >= 0 && this.t - target.lastDamagedAt < 5) killer = target.lastHitBy;
      this.kill(target, killer);
    }
    return dmg;
  }

  kill(v: Player, killerId: number) {
    if (!v.alive) return;
    const b = this.cfg.biomass;
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.respawnAt = this.t + this.cfg.respawnDelaySec;
    v.dashT = 0;
    v.vx = v.vy = 0;
    v.status = freshStatus();
    for (const [id, d] of this.decoys) if (d.ownerId === v.id) this.decoys.delete(id);

    // biomassa derrubada
    const drop = v.biomass * b.killDropFraction;
    if (drop >= 1) {
      const n = Math.min(b.maxDropPellets, Math.max(1, Math.ceil(drop / 2)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
        const d = v.stats.radius + this.rng.range(10, 60);
        this.spawnPellet(v.x + Math.cos(a) * d, v.y + Math.sin(a) * d, drop / n, 2);
      }
    }
    v.biomass *= b.deathKeepFraction;
    this.updateLevel(v);
    if (v.offer && this.pendingEvolutions(v) <= 0) this.closeOffer(v);

    const k = killerId >= 0 ? this.players.get(killerId) : undefined;
    this.emit({ k: 'kill', a: killerId, b: v.id, x: v.x, y: v.y }, v.x, v.y, v.id);
    if (k && k !== v) {
      k.kills++;
      k.score += this.cfg.score.killBase + this.cfg.score.killPerVictimLevel * v.level;
      this.globalToasts.push({ text: `${k.name} eliminou ${v.name}`, kind: 'info' });
    } else {
      this.globalToasts.push({ text: `${v.name} foi dissolvido pelo ácido`, kind: 'info' });
    }
  }

  emit(ev: GameEvent, x: number, y: number, owner?: number) {
    this.events.push({ ev, x, y, owner });
  }

  /* ---------------------------------------------------------------- */
  /* Visibilidade                                                      */
  /* ---------------------------------------------------------------- */

  /** Mesma regra para clientes e bots: camuflados só aparecem de perto. */
  canSee(viewer: { x: number; y: number }, target: Player): boolean {
    if (!target.alive) return false;
    const r = target.status.cloakT > 0 ? this.cfg.cloakRevealRadius : this.cfg.viewRadius;
    return dist2(viewer.x, viewer.y, target.x, target.y) <= r * r;
  }

  /* ---------------------------------------------------------------- */
  /* Passo da simulação                                                */
  /* ---------------------------------------------------------------- */

  step(dt: number) {
    this.t += dt;
    this.tickCount++;
    for (const pl of this.pellets.values()) pl.moved = false;

    for (const p of this.players.values()) this.tickTimers(p, dt);

    // renascimento
    for (const p of this.players.values()) {
      if (!p.alive && this.t >= p.respawnAt && (p.connected || p.isBot)) this.spawn(p);
    }

    // escolha automática ao expirar
    for (const p of this.players.values()) {
      if (p.offer && this.t >= p.offer.expiresAt) this.choose(p, p.offer.id, this.rng.pick(p.offer.options));
    }

    // habilidades pedidas
    for (const p of this.players.values()) {
      if (p.wantAbility) {
        p.wantAbility = false;
        this.useAbility(p);
      }
    }

    // movimento
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      let input = p.lastInput;
      if (p.inputQueue.length) {
        // descarta atraso acumulado sem permitir mais de um passo por tick
        while (p.inputQueue.length > 3) p.inputQueue.shift();
        const q = p.inputQueue.shift()!;
        input = { x: q.x, y: q.y };
        p.lastInput = input;
        p.lastSeq = q.seq;
        p.idleTicks = 0;
      } else if (!p.isBot && ++p.idleTicks > 15) {
        // sem entradas por ~0,5 s: para o personagem (evita andar sozinho para o ácido)
        input = { x: 0, y: 0 };
      }
      if (!p.connected && !p.isBot) input = { x: 0, y: 0 };
      const wasDashing = p.dashT > 0;
      stepMovement(
        p,
        input.x,
        input.y,
        { maxSpeed: this.effMaxSpeed(p), accel: p.stats.accel, decel: p.stats.decel, radius: p.stats.radius },
        dt,
        this.W,
        this.H,
      );
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 20) {
        p.faceX = p.vx / sp;
        p.faceY = p.vy / sp;
      }
      if (wasDashing && p.dashT === 0 && p.status.pendingPulse) {
        p.status.pendingPulse = false;
        this.pulse(p, HYBRID_PARAMS.cacador_aproximacao.radius);
      }
    }

    this.separate();
    if (this.combatEnabled) this.bites();
    if (this.combatEnabled) this.hazardDamage(dt);
    this.regen(dt);
    this.updateDecoys(dt);
    if (this.collectEnabled) this.collect(dt);
    this.updateZones(dt);

    if (this.collectEnabled) {
      const bc = this.cfg.biomass;
      this.pelletAcc += (bc.spawnPerSecBase + bc.spawnPerSecPerPlayer * this.players.size) * dt;
      while (this.pelletAcc >= 1) {
        this.pelletAcc -= 1;
        this.spawnPellet();
      }
    }

    for (const p of this.players.values()) this.ensureOffer(p);
  }

  private tickTimers(p: Player, dt: number) {
    const st = p.status;
    for (const k of Object.keys(p.cooldowns) as AbilityId[]) {
      const v = (p.cooldowns[k] ?? 0) - dt;
      if (v <= 0) delete p.cooldowns[k];
      else p.cooldowns[k] = v;
    }
    p.biteCd = Math.max(0, p.biteCd - dt);
    st.shieldT = Math.max(0, st.shieldT - dt);
    st.cloakT = Math.max(0, st.cloakT - dt);
    st.protectT = Math.max(0, st.protectT - dt);
    st.armoredT = Math.max(0, st.armoredT - dt);
    st.biteBonusT = Math.max(0, st.biteBonusT - dt);
    st.hurtT = Math.max(0, st.hurtT - dt);
    st.slowImmuneT = Math.max(0, st.slowImmuneT - dt);
    if (st.slowT > 0) {
      st.slowT -= dt;
      if (st.slowT <= 0) {
        st.slowT = 0;
        st.slowStrength = 0;
        st.slowImmuneT = SLOW_IMMUNITY_SEC;
      }
    }
    for (const [k, v] of p.thornsIcd) {
      if (v - dt <= 0) p.thornsIcd.delete(k);
      else p.thornsIcd.set(k, v - dt);
    }
  }

  private separate() {
    const list = [...this.players.values()].filter((p) => p.alive);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        const rr = a.stats.radius + b.stats.radius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 > 0 ? dx / d : 1;
        const ny = d2 > 0 ? dy / d : 0;
        const overlap = (rr - d) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        // Investida Blindada: empurrão forte em quem for atingido durante a investida
        const K = HYBRID_PARAMS.investida_blindada.knockback;
        if (this.combatEnabled && a.dashT > 0 && a.status.armoredT > 0 && b.status.shieldT <= 0) {
          b.vx += nx * K;
          b.vy += ny * K;
        }
        if (this.combatEnabled && b.dashT > 0 && b.status.armoredT > 0 && a.status.shieldT <= 0) {
          a.vx -= nx * K;
          a.vy -= ny * K;
        }
      }
    }
    for (const p of list) {
      const r = p.stats.radius;
      p.x = clamp(p.x, r, this.W - r);
      p.y = clamp(p.y, r, this.H - r);
    }
  }

  private bites() {
    const T = MUTATION_PARAMS.espinhos_externos;
    const ext = 10;
    for (const p of this.players.values()) {
      if (!p.alive || p.biteCd > 0 || p.status.protectT > 0) continue;
      let best: Player | null = null;
      let bestD = Infinity;
      for (const o of this.players.values()) {
        if (o === p || !o.alive || o.status.protectT > 0) continue;
        const reach = p.stats.radius + o.stats.radius + ext;
        const d = dist2(p.x, p.y, o.x, o.y);
        if (d <= reach * reach && d < bestD) {
          best = o;
          bestD = d;
        }
      }
      let decoyId = -1;
      for (const d of this.decoys.values()) {
        if (d.ownerId === p.id) continue;
        const reach = p.stats.radius + p.stats.radius + ext;
        const dd = dist2(p.x, p.y, d.x, d.y);
        if (dd <= reach * reach && dd < bestD) {
          bestD = dd;
          decoyId = d.id;
          best = null;
        }
      }
      if (decoyId >= 0) {
        this.popDecoy(decoyId);
        p.biteCd = p.stats.biteCooldown;
        p.status.cloakT = 0;
        continue;
      }
      if (!best) continue;
      const o = best;
      let raw = p.stats.biteDamage;
      if (p.status.biteBonusT > 0) {
        raw *= MUTATION_PARAMS.cauda_propulsora.biteBonusMul;
        p.status.biteBonusT = 0;
      }
      p.biteCd = p.stats.biteCooldown;
      p.status.cloakT = 0;
      const ox = o.x;
      const oy = o.y;
      const dealt = this.damage(o, raw, p.id);
      if (dealt > 0) {
        this.emit({ k: 'bite', a: p.id, b: o.id, d: Math.round(dealt), x: ox, y: oy }, ox, oy);
        const d = Math.sqrt(bestD) || 1;
        if (o.alive) {
          o.vx += ((o.x - p.x) / d) * 140;
          o.vy += ((o.y - p.y) / d) * 140;
        }
      }
      // espinhos reagem ao contato da mordida (inclusive bloqueada), com limite por atacante
      if (o.stats.thorns && p.alive && !o.thornsIcd.has(p.id)) {
        o.thornsIcd.set(p.id, T.perAttackerCooldown);
        const refl = clamp(raw * T.reflectFraction, T.minDamage, T.maxDamage);
        const got = this.damage(p, refl, o.id);
        if (got > 0) this.emit({ k: 'thorns', a: o.id, b: p.id, d: Math.round(got) }, p.x, p.y);
      }
    }
  }

  private hazardDamage(dt: number) {
    const dps = this.cfg.hazards.damagePerSec;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (this.inHazard(p.x, p.y)) this.damage(p, dps * dt, -1);
    }
  }

  private regen(dt: number) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const st = p.status;
      const inCombat = this.t - p.lastDamagedAt < MUTATION_PARAMS.gel_regenerativo.combatWindow;
      // Mutante de Resistência: escudo ativo libera a regeneração plena
      const shieldedResist = st.shieldT > 0 && p.hybrids.includes('mutante_resistencia');
      const rate = inCombat && !shieldedResist ? p.stats.inCombatRegenPctPerSec : p.stats.regenPctPerSec;
      let heal = p.stats.maxHp * rate * dt;
      if (st.healT > 0) {
        const step = Math.min(dt, st.healT);
        heal += st.healPerSec * step;
        st.healT -= step;
        if (st.healT <= 0) {
          st.healT = 0;
          st.healPerSec = 0;
        }
      }
      if (heal > 0) p.hp = Math.min(p.stats.maxHp, p.hp + heal);
    }
  }

  private updateDecoys(dt: number) {
    for (const [id, d] of this.decoys) {
      d.ttl -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.ttl <= 0 || d.x < 0 || d.y < 0 || d.x > this.W || d.y > this.H) this.popDecoy(id);
    }
  }

  private collect(dt: number) {
    const pr = this.cfg.biomass.pelletRadius;
    const L = MUTATION_PARAMS.lingua_coletora;
    const CF = HYBRID_PARAMS.coletor_furtivo;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const stealthCollector = p.status.cloakT > 0 && p.hybrids.includes('coletor_furtivo');
      const magnet = stealthCollector ? CF.cloakedRange : p.stats.magnetRange;
      const valueMul = stealthCollector ? CF.cloakedValueMul : 1;
      const reach = p.stats.radius + pr;
      const mr = Math.max(magnet, reach);
      for (const [id, pl] of this.pellets) {
        const dx = p.x - pl.x;
        const dy = p.y - pl.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > mr * mr) continue;
        if (d2 <= reach * reach) {
          // remoção imediata impede coleta dupla no mesmo tick
          this.pellets.delete(id);
          this.gainBiomass(p, pl.value * valueMul);
          this.emit({ k: 'eat', a: p.id, x: pl.x, y: pl.y }, pl.x, pl.y);
        } else if (magnet > 0) {
          const d = Math.sqrt(d2);
          const s = Math.min(d, L.pullSpeed * dt);
          pl.x += (dx / d) * s;
          pl.y += (dy / d) * s;
          pl.moved = true;
        }
      }
    }
  }

  private updateZones(dt: number) {
    const zc = this.cfg.zones;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]!;
      z.life -= dt;
      if (z.life <= 0) {
        this.zones[i] = this.makeZone();
        this.globalToasts.push({ text: 'Uma zona de energia mudou de lugar', kind: 'info' });
      }
    }
    if (!this.collectEnabled) return;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (this.zoneAt(p.x, p.y)) {
        p.status.cloakT = 0;
        p.score += zc.scorePerSec * dt;
        this.gainBiomass(p, zc.biomassPerSec * dt, false);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Utilidades para HUD                                               */
  /* ---------------------------------------------------------------- */

  thresholds(p: Player): [number, number] {
    const prev = p.level > 0 ? LEVEL_THRESHOLDS[p.level - 1]! : 0;
    const next = LEVEL_THRESHOLDS[p.level] ?? prev;
    return [prev, next];
  }
}

export type { HybridId };
