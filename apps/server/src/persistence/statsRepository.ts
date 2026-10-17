import type { ResultRow } from '@mutant/shared';

/**
 * Persistência de estatísticas. A implementação em memória é a padrão;
 * a de PostgreSQL deve seguir o esquema em `schema.sql` (etapa de contas).
 * Bots nunca entram nas estatísticas.
 */
export interface StatsRepository {
  recordMatch(roomId: string, matchId: number, rows: ResultRow[]): Promise<void>;
  summary(): Promise<{ matches: number; humanPlayers: number; topScore: number }>;
}

export class MemoryStatsRepository implements StatsRepository {
  private matches = 0;
  private humanPlayers = 0;
  private topScore = 0;
  async recordMatch(_roomId: string, _matchId: number, rows: ResultRow[]) {
    const humans = rows.filter((r) => !r.bot);
    if (!humans.length) return;
    this.matches++;
    this.humanPlayers += humans.length;
    for (const r of humans) this.topScore = Math.max(this.topScore, r.score);
  }
  async summary() {
    return { matches: this.matches, humanPlayers: this.humanPlayers, topScore: this.topScore };
  }
}
