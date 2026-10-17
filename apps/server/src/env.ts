/** Configuração privada do servidor via variáveis de ambiente (ver .env.example). */
function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const ENV = {
  port: num('PORT', 2567),
  host: process.env.HOST || '0.0.0.0',
  /** Origens permitidas separadas por vírgula; vazio = qualquer origem (só para desenvolvimento). */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  botFill: num('BOT_FILL', 8),
  botDifficulty: (['facil', 'normal', 'dificil'].includes(process.env.BOT_DIFFICULTY || '')
    ? process.env.BOT_DIFFICULTY
    : 'normal') as 'facil' | 'normal' | 'dificil',
  maxRooms: num('MAX_ROOMS', 50),
  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn',
  /** Pasta com o cliente compilado. */
  staticDir: process.env.STATIC_DIR || '',
  /** Confiar no cabeçalho X-Forwarded-For (atrás de proxy reverso). */
  trustProxy: process.env.TRUST_PROXY === '1',
  databaseUrl: process.env.DATABASE_URL || '',
  /** Pasta para o armazenamento em arquivo (usado quando não há DATABASE_URL). */
  dataDir: process.env.DATA_DIR || './data',
  /** Endereço público do jogo (https://...), usado nos links de retorno e no aviso de pagamento. */
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  /** mercadopago | fake (só testes locais) | off */
  paymentsMode: (['mercadopago', 'fake', 'off'].includes(process.env.PAYMENTS_MODE || '')
    ? process.env.PAYMENTS_MODE
    : process.env.MP_ACCESS_TOKEN
      ? 'mercadopago'
      : 'off') as 'mercadopago' | 'fake' | 'off',
  mpAccessToken: process.env.MP_ACCESS_TOKEN || '',
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',
  mpApiBase: (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/$/, ''),
  production: process.env.NODE_ENV === 'production',
};
