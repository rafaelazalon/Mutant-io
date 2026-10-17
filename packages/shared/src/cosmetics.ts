/**
 * Aparências (cosméticos) do mutante. São apenas visuais: nenhuma altera atributos,
 * velocidade, tamanho de colisão ou visibilidade — não dão vantagem na partida.
 */
export type CosmeticSlot = 'cor' | 'padrao' | 'olhos' | 'acessorio' | 'rastro';

export const SLOTS: readonly CosmeticSlot[] = ['cor', 'padrao', 'olhos', 'acessorio', 'rastro'];

export const SLOT_LABEL: Record<CosmeticSlot, string> = {
  cor: 'Cores',
  padrao: 'Padrões',
  olhos: 'Olhos',
  acessorio: 'Acessórios',
  rastro: 'Rastros',
};

export interface CosmeticDef {
  id: string;
  slot: CosmeticSlot;
  name: string;
  /** preço em centavos de real; 0 = grátis */
  priceCents: number;
  /** cor de destaque usada na vitrine */
  accent: string;
}

/** Preço padrão de cada aparência paga: R$ 1,00. */
export const ITEM_PRICE_CENTS = 100;

const P = ITEM_PRICE_CENTS;

export const COSMETICS: readonly CosmeticDef[] = [
  // cores
  { id: 'cor.natural', slot: 'cor', name: 'Natural', priceCents: 0, accent: '#7dff6a' },
  { id: 'cor.neon', slot: 'cor', name: 'Neon', priceCents: P, accent: '#ff3df2' },
  { id: 'cor.ouro', slot: 'cor', name: 'Ouro', priceCents: P, accent: '#ffcf33' },
  { id: 'cor.lava', slot: 'cor', name: 'Lava', priceCents: P, accent: '#ff5a1f' },
  { id: 'cor.gelo', slot: 'cor', name: 'Gelo', priceCents: P, accent: '#9eeaff' },
  { id: 'cor.toxico', slot: 'cor', name: 'Tóxico', priceCents: P, accent: '#b6ff1a' },
  { id: 'cor.galaxia', slot: 'cor', name: 'Galáxia', priceCents: P, accent: '#7b4dff' },
  { id: 'cor.sombra', slot: 'cor', name: 'Sombra', priceCents: P, accent: '#5a5f7a' },
  { id: 'cor.algodao', slot: 'cor', name: 'Algodão-doce', priceCents: P, accent: '#ffb3e1' },
  // padrões
  { id: 'padrao.liso', slot: 'padrao', name: 'Liso', priceCents: 0, accent: '#94a6c9' },
  { id: 'padrao.listras', slot: 'padrao', name: 'Listras', priceCents: P, accent: '#ffe066' },
  { id: 'padrao.bolinhas', slot: 'padrao', name: 'Bolinhas', priceCents: P, accent: '#ff8fd0' },
  { id: 'padrao.tigre', slot: 'padrao', name: 'Tigre', priceCents: P, accent: '#ff9a3c' },
  { id: 'padrao.escamas', slot: 'padrao', name: 'Escamas', priceCents: P, accent: '#5ce1ff' },
  { id: 'padrao.circuito', slot: 'padrao', name: 'Circuito', priceCents: P, accent: '#7dff6a' },
  // olhos
  { id: 'olhos.padrao', slot: 'olhos', name: 'Curiosos', priceCents: 0, accent: '#ffffff' },
  { id: 'olhos.raivoso', slot: 'olhos', name: 'Raivosos', priceCents: P, accent: '#ff4d6d' },
  { id: 'olhos.sonolento', slot: 'olhos', name: 'Sonolentos', priceCents: P, accent: '#b9a6ff' },
  { id: 'olhos.coracao', slot: 'olhos', name: 'Apaixonados', priceCents: P, accent: '#ff5f8f' },
  { id: 'olhos.robo', slot: 'olhos', name: 'Robóticos', priceCents: P, accent: '#ff2a2a' },
  { id: 'olhos.estrela', slot: 'olhos', name: 'Estrelados', priceCents: P, accent: '#ffe066' },
  // acessórios
  { id: 'acessorio.nenhum', slot: 'acessorio', name: 'Nenhum', priceCents: 0, accent: '#94a6c9' },
  { id: 'acessorio.coroa', slot: 'acessorio', name: 'Coroa', priceCents: P, accent: '#ffcf33' },
  { id: 'acessorio.cartola', slot: 'acessorio', name: 'Cartola', priceCents: P, accent: '#2b2f45' },
  { id: 'acessorio.aureola', slot: 'acessorio', name: 'Auréola', priceCents: P, accent: '#fff6b0' },
  { id: 'acessorio.bone', slot: 'acessorio', name: 'Boné', priceCents: P, accent: '#3d7bff' },
  { id: 'acessorio.flor', slot: 'acessorio', name: 'Flor', priceCents: P, accent: '#ff7ab8' },
  { id: 'acessorio.antena', slot: 'acessorio', name: 'Antena alien', priceCents: P, accent: '#7dff6a' },
  // rastros
  { id: 'rastro.nenhum', slot: 'rastro', name: 'Nenhum', priceCents: 0, accent: '#94a6c9' },
  { id: 'rastro.fogo', slot: 'rastro', name: 'Fogo', priceCents: P, accent: '#ff7a1a' },
  { id: 'rastro.arcoiris', slot: 'rastro', name: 'Arco-íris', priceCents: P, accent: '#ff5fd0' },
  { id: 'rastro.bolhas', slot: 'rastro', name: 'Bolhas', priceCents: P, accent: '#9eeaff' },
  { id: 'rastro.estrelas', slot: 'rastro', name: 'Estrelas', priceCents: P, accent: '#ffe066' },
  { id: 'rastro.raios', slot: 'rastro', name: 'Raios', priceCents: P, accent: '#5ce1ff' },
];

export const COSMETIC_BY_ID: ReadonlyMap<string, CosmeticDef> = new Map(COSMETICS.map((c) => [c.id, c]));

/** Aparência equipada: um item por espaço. */
export type Look = Record<CosmeticSlot, string>;

export const DEFAULT_LOOK: Look = {
  cor: 'cor.natural',
  padrao: 'padrao.liso',
  olhos: 'olhos.padrao',
  acessorio: 'acessorio.nenhum',
  rastro: 'rastro.nenhum',
};

export function isFree(id: string): boolean {
  return COSMETIC_BY_ID.get(id)?.priceCents === 0;
}

/** Só aceita ids conhecidos e no espaço certo; o resto volta ao padrão. */
export function sanitizeLook(raw: unknown): Look {
  const out: Look = { ...DEFAULT_LOOK };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const s of SLOTS) {
    const v = r[s];
    if (typeof v === 'string' && COSMETIC_BY_ID.get(v)?.slot === s) out[s] = v;
  }
  return out;
}

/** Remove da aparência tudo que o jogador não possui (itens grátis sempre valem). */
export function restrictLook(look: Look, owned: ReadonlySet<string>): Look {
  const out: Look = { ...DEFAULT_LOOK };
  for (const s of SLOTS) {
    const id = look[s];
    if (isFree(id) || owned.has(id)) out[s] = id;
  }
  return out;
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
