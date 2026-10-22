function integer(value, fallback, min, max, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid configuration: ${name}`);
  }
  return parsed;
}

function origin(value, name, production) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid configuration: ${name}`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !production))) {
    throw new Error(`Invalid configuration: ${name}`);
  }
  return url.origin;
}

export function databaseConfig(env, variable = 'DATABASE_URL') {
  let url;
  try { url = new URL(env[variable]); } catch { throw new Error(`Missing or invalid ${variable}`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      !url.username || url.pathname === '/' || !url.pathname || url.search || url.hash) {
    throw new Error(`Invalid configuration: ${variable}`);
  }
  const ssl = env.DATABASE_SSL ?? 'disable';
  if (!['disable', 'verify-full'].includes(ssl)) throw new Error('Invalid DATABASE_SSL');
  return {
    url: url.href,
    ssl: ssl === 'verify-full' ? { rejectUnauthorized: true } : false,
    max: integer(env.DATABASE_POOL_SIZE, 5, 1, 20, 'DATABASE_POOL_SIZE'),
  };
}

function emailConfig(env) {
  if (!['true', 'false', undefined].includes(env.EMAIL_ENABLED)) throw new Error('Invalid EMAIL_ENABLED');
  if (env.EMAIL_ENABLED !== 'true') return Object.freeze({ enabled: false });
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM?.trim();
  const addressMatch = from?.match(/^(?:[^<>]+\s+<([^<>]+)>|([^<>]+))$/);
  const address = addressMatch?.[1] ?? addressMatch?.[2];
  if (!key || !/^re_[A-Za-z0-9_-]+$/.test(key)) throw new Error('Missing or invalid RESEND_API_KEY');
  if (!from || from.length > 320 || /[\r\n]/.test(from) || !address ||
      !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(address)) throw new Error('Invalid EMAIL_FROM');
  if (!/^[a-fA-F0-9]{64}$/.test(env.EMAIL_ENCRYPTION_KEY ?? '')) throw new Error('Invalid EMAIL_ENCRYPTION_KEY');
  return Object.freeze({ enabled: true, key, from,
    encryptionKey: Buffer.from(env.EMAIL_ENCRYPTION_KEY, 'hex'), resetTtlSeconds: 1200,
    pollMilliseconds: 5000, maxAttempts: 5 });
}

export function readConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'production';
  if (!['production', 'development', 'test'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  const production = nodeEnv === 'production';
  return Object.freeze({
    production,
    port: integer(env.PORT, 3000, 1, 65535, 'PORT'),
    apiOrigin: origin(env.API_ORIGIN, 'API_ORIGIN', production),
    frontendOrigin: origin(env.FRONTEND_ORIGIN, 'FRONTEND_ORIGIN', production),
    database: databaseConfig(env),
    sessionTtlSeconds: integer(env.SESSION_TTL_SECONDS, 28800, 300, 604800, 'SESSION_TTL_SECONDS'),
    cookieName: production ? '__Host-nina_session' : 'nina_session',
    loginWindowSeconds: 900,
    loginAccountLimit: 10,
    loginGlobalLimit: 200,
    email: emailConfig(env),
  });
}
