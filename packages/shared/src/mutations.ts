import { HYBRID_PARAMS, MUTATION_PARAMS } from './balance.js';

export const MUTATION_IDS = [
  'pernas_elasticas',
  'cauda_propulsora',
  'pele_escorregadia',
  'salto_dimensional',
  'carapaca_cristalina',
  'gel_regenerativo',
  'espinhos_externos',
  'escudo_organico',
  'lingua_coletora',
  'pulso_bioeletrico',
  'isca_biologica',
  'camuflagem',
] as const;
export type MutationId = (typeof MUTATION_IDS)[number];

export const HYBRID_IDS = [
  'investida_blindada',
  'coletor_furtivo',
  'cacador_aproximacao',
  'mutante_resistencia',
] as const;
export type HybridId = (typeof HYBRID_IDS)[number];

export const ABILITY_IDS = ['dash', 'blink', 'shield', 'pulse', 'decoy', 'cloak'] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export type MutationCategory = 'mobilidade' | 'defesa' | 'controle';

export interface MutationDef {
  id: MutationId;
  /** Letra usada no código de build compartilhável. */
  code: string;
  name: string;
  category: MutationCategory;
  icon: string;
  color: string;
  description: string;
  effect: string;
  counterplay: string;
  /** Habilidade ativa concedida (botão), se houver. */
  ability?: AbilityId;
}

const P = MUTATION_PARAMS;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export const MUTATIONS: Record<MutationId, MutationDef> = {
  pernas_elasticas: {
    id: 'pernas_elasticas', code: 'A', name: 'Pernas Elásticas', category: 'mobilidade', icon: '🦵', color: '#ffb547',
    description: 'Membros que se esticam como molas.',
    effect: `+${pct(P.pernas_elasticas.accelMul - 1)} aceleração, +${pct(P.pernas_elasticas.speedMul - 1)} velocidade, mas +${pct(P.pernas_elasticas.damageTakenAdd)} dano recebido.`,
    counterplay: 'Corpo mais frágil: pulsos e espinhos punem a aproximação.',
  },
  cauda_propulsora: {
    id: 'cauda_propulsora', code: 'B', name: 'Cauda Propulsora', category: 'mobilidade', icon: '💨', color: '#ff7a45',
    description: 'Uma cauda que dispara o corpo para frente.',
    effect: `Investida em linha reta (${P.cauda_propulsora.duration}s). A próxima mordida causa +${pct(P.cauda_propulsora.biteBonusMul - 1)} de dano. Recarga ${P.cauda_propulsora.cooldown}s.`,
    counterplay: 'Trajetória reta e previsível: desvie para o lado ou use escudo.',
    ability: 'dash',
  },
  pele_escorregadia: {
    id: 'pele_escorregadia', code: 'C', name: 'Pele Escorregadia', category: 'mobilidade', icon: '💧', color: '#4fd1ff',
    description: 'Muco que reduz o atrito.',
    effect: `Lentidões ${pct(1 - P.pele_escorregadia.slowStrengthMul)} mais fracas e ${pct(1 - P.pele_escorregadia.slowDurationMul)} mais curtas. Frenagem mais lenta.`,
    counterplay: 'Não reduz dano: ataque direto continua eficaz.',
  },
  salto_dimensional: {
    id: 'salto_dimensional', code: 'D', name: 'Salto Dimensional', category: 'mobilidade', icon: '🌀', color: '#b07cff',
    description: 'Dobra o espaço por um instante.',
    effect: `Teleporta ${P.salto_dimensional.distance}px na direção do movimento (sem atravessar os limites). Recarga ${P.salto_dimensional.cooldown}s.`,
    counterplay: 'O destino é visível e a recarga é longa: pressione logo após o salto.',
    ability: 'blink',
  },
  carapaca_cristalina: {
    id: 'carapaca_cristalina', code: 'E', name: 'Carapaça Cristalina', category: 'defesa', icon: '💎', color: '#7ef0d8',
    description: 'Placas minerais sobre o corpo.',
    effect: `-${pct(-P.carapaca_cristalina.damageTakenAdd)} dano recebido, -${pct(1 - P.carapaca_cristalina.speedMul)} velocidade máxima.`,
    counterplay: 'Mais lento: fuja ou controle com pulso e áreas ácidas.',
  },
  gel_regenerativo: {
    id: 'gel_regenerativo', code: 'F', name: 'Gel Regenerativo', category: 'defesa', icon: '🧪', color: '#7dff6a',
    description: 'Camada gelatinosa que regenera tecidos.',
    effect: `Regenera ${pct(P.gel_regenerativo.regenPctPerSec)} da vida/s fora de combate (${pct(P.gel_regenerativo.inCombatRegenPctPerSec)}/s em combate).`,
    counterplay: 'Mantenha a pressão: em combate a regeneração quase para.',
  },
  espinhos_externos: {
    id: 'espinhos_externos', code: 'G', name: 'Espinhos Externos', category: 'defesa', icon: '🦔', color: '#ff5f8f',
    description: 'Espinhos que ferem quem morde.',
    effect: `Quem te morde recebe ${pct(P.espinhos_externos.reflectFraction)} do dano (${P.espinhos_externos.minDamage}–${P.espinhos_externos.maxDamage}), no máximo a cada ${P.espinhos_externos.perAttackerCooldown}s por atacante.`,
    counterplay: 'Use pulso e investidas com rajadas curtas, ou simplesmente evite.',
  },
  escudo_organico: {
    id: 'escudo_organico', code: 'H', name: 'Escudo Orgânico', category: 'defesa', icon: '🛡️', color: '#ffe066',
    description: 'Membrana rígida que se fecha em volta do corpo.',
    effect: `Bloqueia todo dano por ${P.escudo_organico.duration}s. Recarga ${P.escudo_organico.cooldown}s.`,
    counterplay: 'Espere o brilho dourado sumir antes de atacar.',
    ability: 'shield',
  },
  lingua_coletora: {
    id: 'lingua_coletora', code: 'I', name: 'Língua Coletora', category: 'controle', icon: '👅', color: '#ff8fd0',
    description: 'Uma língua longa e pegajosa.',
    effect: `Atrai biomassa a até ${P.lingua_coletora.range}px.`,
    counterplay: 'Não afeta combate: dispute as zonas de energia.',
  },
  pulso_bioeletrico: {
    id: 'pulso_bioeletrico', code: 'J', name: 'Pulso Bioelétrico', category: 'controle', icon: '⚡', color: '#5ce1ff',
    description: 'Descarga elétrica em área.',
    effect: `Causa ${P.pulso_bioeletrico.damage} de dano e ${pct(P.pulso_bioeletrico.slowStrength)} de lentidão por ${P.pulso_bioeletrico.slowDuration}s em ${P.pulso_bioeletrico.radius}px. Recarga ${P.pulso_bioeletrico.cooldown}s.`,
    counterplay: 'Alcance curto; após uma lentidão você fica imune por alguns instantes.',
    ability: 'pulse',
  },
  isca_biologica: {
    id: 'isca_biologica', code: 'K', name: 'Isca Biológica', category: 'controle', icon: '🎭', color: '#ffa3a3',
    description: 'Solta um clone oco de si mesmo.',
    effect: `Cria um chamariz que segue em frente por ${P.isca_biologica.duration}s e estoura com uma mordida. Recarga ${P.isca_biologica.cooldown}s.`,
    counterplay: 'A isca anda em linha reta e não coleta biomassa.',
    ability: 'decoy',
  },
  camuflagem: {
    id: 'camuflagem', code: 'L', name: 'Camuflagem', category: 'controle', icon: '🦎', color: '#9be564',
    description: 'Cromatóforos que imitam o ambiente.',
    effect: `Fica quase invisível por ${P.camuflagem.duration}s. Atacar, sofrer dano ou entrar numa zona de energia revela. Recarga ${P.camuflagem.cooldown}s.`,
    counterplay: `Visível de perto (${'≤'}260px); não dá invulnerabilidade.`,
    ability: 'cloak',
  },
};

export interface HybridDef {
  id: HybridId;
  name: string;
  icon: string;
  color: string;
  requires: [MutationId, MutationId];
  effect: string;
}

const H = HYBRID_PARAMS;
export const HYBRIDS: Record<HybridId, HybridDef> = {
  investida_blindada: {
    id: 'investida_blindada', name: 'Investida Blindada', icon: '🦏', color: '#7ef0d8',
    requires: ['cauda_propulsora', 'carapaca_cristalina'],
    effect: `Durante a investida e por ${H.investida_blindada.extraWindow}s depois: -${pct(H.investida_blindada.damageReduction)} dano recebido e empurrão forte ao colidir.`,
  },
  coletor_furtivo: {
    id: 'coletor_furtivo', name: 'Coletor Furtivo', icon: '🥷', color: '#ff8fd0',
    requires: ['lingua_coletora', 'camuflagem'],
    effect: `Camuflado: língua alcança ${H.coletor_furtivo.cloakedRange}px e a biomassa vale +${pct(H.coletor_furtivo.cloakedValueMul - 1)}.`,
  },
  cacador_aproximacao: {
    id: 'cacador_aproximacao', name: 'Caçador de Aproximação', icon: '🐆', color: '#5ce1ff',
    requires: ['pernas_elasticas', 'pulso_bioeletrico'],
    effect: `O pulso vira "Bote": avanço rápido seguido do pulso no ponto de chegada. Recarga ${H.cacador_aproximacao.cooldown}s.`,
  },
  mutante_resistencia: {
    id: 'mutante_resistencia', name: 'Mutante de Resistência', icon: '🐢', color: '#7dff6a',
    requires: ['gel_regenerativo', 'escudo_organico'],
    effect: `O escudo também cura ${pct(H.mutante_resistencia.healPct)} da vida em ${H.mutante_resistencia.healDuration}s. Recarga do escudo ${H.mutante_resistencia.cooldown}s.`,
  },
};

export const ABILITY_LABEL: Record<AbilityId, string> = {
  dash: 'Investida',
  blink: 'Salto',
  shield: 'Escudo',
  pulse: 'Pulso',
  decoy: 'Isca',
  cloak: 'Camuflar',
};

export function isMutationId(v: unknown): v is MutationId {
  return typeof v === 'string' && (MUTATION_IDS as readonly string[]).includes(v);
}

/** Híbridos ativos para um conjunto de mutações. */
export function hybridsFor(mutations: readonly MutationId[]): HybridId[] {
  const set = new Set(mutations);
  return HYBRID_IDS.filter((h) => HYBRIDS[h].requires.every((r) => set.has(r)));
}

/** Híbridos que seriam completados ao adicionar `candidate`. */
export function hybridsCompletedBy(owned: readonly MutationId[], candidate: MutationId): HybridId[] {
  const before = new Set(hybridsFor(owned));
  return hybridsFor([...owned, candidate]).filter((h) => !before.has(h));
}

/** Habilidades ativas na ordem em que as mutações foram adquiridas. */
export function abilitiesFor(mutations: readonly MutationId[]): AbilityId[] {
  const out: AbilityId[] = [];
  for (const m of mutations) {
    const a = MUTATIONS[m].ability;
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * Código de build compartilhável, ex.: "MX-BEJ" (letras na ordem de aquisição).
 * Permite reproduzir combinações compatíveis.
 */
export function encodeBuild(mutations: readonly MutationId[]): string {
  return 'MX-' + (mutations.map((m) => MUTATIONS[m].code).join('') || '0');
}

export function decodeBuild(code: string): MutationId[] | null {
  const m = /^MX-([A-L]{1,12}|0)$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const letters = m[1] ?? '0';
  if (letters === '0') return [];
  const out: MutationId[] = [];
  for (const ch of letters) {
    const id = MUTATION_IDS.find((x) => MUTATIONS[x].code === ch);
    if (!id || out.includes(id)) return null;
    out.push(id);
  }
  return out;
}
