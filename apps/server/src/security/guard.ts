import { GAME_CONFIG, TokenBucket } from '@mutant/shared';
import { ENV } from '../env.js';

/** Limite de conexões simultâneas por IP. */
export class IpLimiter {
  private counts = new Map<string, number>();
  constructor(private readonly max = GAME_CONFIG.net.maxConnectionsPerIp) {}
  acquire(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }
  release(ip: string) {
    const n = (this.counts.get(ip) ?? 1) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
  }
}

export function originAllowed(origin: string | undefined): boolean {
  if (!ENV.allowedOrigins.length) return true;
  return !!origin && ENV.allowedOrigins.includes(origin);
}

/** Controle por conexão: frequência de mensagens e contagem de violações. */
export class ConnectionGuard {
  private bucket = new TokenBucket(GAME_CONFIG.net.msgPerSec, GAME_CONFIG.net.msgBurst);
  violations = 0;
  /** Retorna false se a mensagem deve ser descartada. */
  allow(): boolean {
    if (this.bucket.take()) return true;
    this.violations++;
    return false;
  }
  invalid() {
    this.violations++;
  }
  get shouldKick() {
    return this.violations > GAME_CONFIG.net.maxViolations;
  }
}
