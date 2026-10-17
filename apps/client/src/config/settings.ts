import { HYBRID_IDS, MUTATION_IDS, type HybridId, type MutationId } from '@mutant/shared';

export interface Settings {
  name: string;
  volume: number;
  quality: 'auto' | 'alta' | 'baixa';
  music: number;
  vibration: boolean;
  autoFullscreen: boolean;
  leftHanded: boolean;
  showStats: boolean;
}

const KEY = 'mutantio.settings.v2';
const DISC_KEY = 'mutantio.discoveries.v1';

const DEFAULTS: Settings = { name: '', volume: 0.7, music: 0.5, quality: 'auto', leftHanded: false, showStats: false, vibration: true, autoFullscreen: true };

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* armazenamento indisponível: segue sem persistir */
  }
}

export function loadSettings(): Settings {
  const s = { ...DEFAULTS };
  try {
    const raw = JSON.parse(safeGet(KEY) || '{}') as Partial<Settings>;
    if (typeof raw.name === 'string') s.name = raw.name.slice(0, 16);
    if (typeof raw.volume === 'number') s.volume = Math.max(0, Math.min(1, raw.volume));
    if (raw.quality === 'baixa' || raw.quality === 'alta' || raw.quality === 'auto') s.quality = raw.quality;
    if (typeof raw.music === 'number') s.music = Math.max(0, Math.min(1, raw.music));
    if (typeof raw.vibration === 'boolean') s.vibration = raw.vibration;
    if (typeof raw.autoFullscreen === 'boolean') s.autoFullscreen = raw.autoFullscreen;
    if (typeof raw.leftHanded === 'boolean') s.leftHanded = raw.leftHanded;
    if (typeof raw.showStats === 'boolean') s.showStats = raw.showStats;
  } catch {
    /* ignora configurações corrompidas */
  }
  return s;
}

export function saveSettings(s: Settings) {
  safeSet(KEY, JSON.stringify(s));
}

/** Registro local de mutações e híbridos já descobertos neste dispositivo. */
export function loadDiscoveries(): Set<string> {
  try {
    const arr = JSON.parse(safeGet(DISC_KEY) || '[]');
    const valid = new Set<string>([...MUTATION_IDS, ...HYBRID_IDS]);
    return new Set((Array.isArray(arr) ? arr : []).filter((x): x is string => typeof x === 'string' && valid.has(x)));
  } catch {
    return new Set();
  }
}

export function addDiscoveries(ids: (MutationId | HybridId)[]): (MutationId | HybridId)[] {
  const d = loadDiscoveries();
  const fresh = ids.filter((i) => !d.has(i));
  if (fresh.length) {
    for (const i of fresh) d.add(i);
    safeSet(DISC_KEY, JSON.stringify([...d]));
  }
  return fresh;
}
