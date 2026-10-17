import { ENV } from './env.js';

const order = { debug: 0, info: 1, warn: 2 } as const;
type Level = keyof typeof order;

/** Logs estruturados em JSON (uma linha por evento) para diagnóstico. */
export function log(level: Level, msg: string, data?: Record<string, unknown>) {
  if (order[level] < order[ENV.logLevel]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data });
  if (level === 'warn') console.warn(line);
  else console.log(line);
}
