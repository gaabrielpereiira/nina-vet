import { hkdfSync } from 'node:crypto';
import { isAbsolute } from 'node:path';

function flag(env,name) {
  if(!['true','false',undefined].includes(env[name]))throw new Error('Invalid '+name);
  return env[name]==='true';
}

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

function aiTestConfig(env) {
  if (!['true', 'false', undefined].includes(env.AI_TESTS_ENABLED)) throw new Error('Invalid AI_TESTS_ENABLED');
  if (env.AI_TESTS_ENABLED !== 'true') return Object.freeze({ enabled: false });
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(env.GEMINI_API_KEY ?? '')) throw new Error('Missing or invalid GEMINI_API_KEY');
  return Object.freeze({ enabled: true, key: env.GEMINI_API_KEY });
}

function vetsoftReadOnlyConfig(env) {
  if (!flag(env, 'VETSOFT_READ_ONLY_ENABLED')) return Object.freeze({ enabled: false });
  const tenant = env.VETSOFT_TENANT;
  const email = env.VETSOFT_EMAIL?.trim();
  const encoded = env.VETSOFT_PASSWORD_BASE64;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(tenant ?? '')) throw new Error('Invalid VETSOFT_TENANT');
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid VETSOFT_EMAIL');
  if (typeof encoded !== 'string' || encoded.length > 1400 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid VETSOFT_PASSWORD_BASE64');
  const bytes = Buffer.from(encoded, 'base64');
  const password = bytes.toString('utf8');
  if (!bytes.length || bytes.length > 1024 || bytes.toString('base64') !== encoded ||
      !Buffer.from(password).equals(bytes) || password.includes('\u0000')) throw new Error('Invalid VETSOFT_PASSWORD_BASE64');
  return Object.freeze({ enabled: true, tenant, email, password });
}

function zernioConfig(env, processing = false) {
  if (!['true', 'false', undefined].includes(env.ZERNIO_WEBHOOK_ENABLED)) throw new Error('Invalid ZERNIO_WEBHOOK_ENABLED');
  const enabled=env.ZERNIO_WEBHOOK_ENABLED==='true';
  if (!enabled&&!processing) return Object.freeze({ enabled: false });
  if (!/^[\x21-\x7e]{32,256}$/.test(env.ZERNIO_WEBHOOK_SECRET ?? '')) throw new Error('Invalid ZERNIO_WEBHOOK_SECRET');
  for (const name of ['ZERNIO_ACCOUNT_ID', 'ZERNIO_PROFILE_ID']) {
    if (!/^[a-f0-9]{24}$/.test(env[name] ?? '')) throw new Error(`Invalid ${name}`);
  }
  if (!/^[a-fA-F0-9]{64}$/.test(env.EMAIL_ENCRYPTION_KEY ?? '')) throw new Error('Invalid EMAIL_ENCRYPTION_KEY');
  // Domain-separated subkey: never encrypt stored data with a secret shared with Zernio.
  const encryptionKey = Buffer.from(hkdfSync('sha256', Buffer.from(env.EMAIL_ENCRYPTION_KEY, 'hex'),
    'nina-channels-v1', 'zernio-inbox-payload', 32));
  if(processing&&(!/^[\x21-\x7e]{32,512}$/.test(env.ZERNIO_API_KEY??'')||/^https?:/i.test(env.ZERNIO_API_KEY)||env.ZERNIO_API_KEY.includes('...')))throw new Error('Invalid ZERNIO_API_KEY');
  return Object.freeze({ enabled, secret: env.ZERNIO_WEBHOOK_SECRET, apiKey:env.ZERNIO_API_KEY,
    accountId: env.ZERNIO_ACCOUNT_ID, profileId: env.ZERNIO_PROFILE_ID, encryptionKey });
}

function whatsappPilotConfig(env, processing) {
  if (!flag(env, 'WHATSAPP_PILOT_ENABLED')) return Object.freeze({ enabled: false });
  if (!processing || env.ZERNIO_WEBHOOK_ENABLED !== 'true') throw new Error('WhatsApp pilot requires active channel processing');
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  if (!uuid.test(env.WHATSAPP_PILOT_CONTACT_ID ?? '') || !uuid.test(env.WHATSAPP_PILOT_CONVERSATION_ID ?? '')) {
    throw new Error('WhatsApp pilot requires one explicit contact and conversation');
  }
  return Object.freeze({ enabled: true, contactId: env.WHATSAPP_PILOT_CONTACT_ID, conversationId: env.WHATSAPP_PILOT_CONVERSATION_ID });
}

export function readConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'production';
  if (!['production', 'development', 'test'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  const production = nodeEnv === 'production';
  const processing=flag(env,'CHANNEL_PROCESSING_ENABLED');
  const mediaEnabled=flag(env,'MEDIA_ENABLED');
  if(processing&&!mediaEnabled)throw new Error('Channel processing requires MEDIA_ENABLED');
  if(mediaEnabled&&(!isAbsolute(env.MEDIA_STORAGE_DIR??'')||env.MEDIA_STORAGE_DIR==='/'))throw new Error('Invalid MEDIA_STORAGE_DIR');
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
    aiTests: aiTestConfig(env),
    vetsoftReadOnly: vetsoftReadOnlyConfig(env),
    whatsappPilot: whatsappPilotConfig(env, processing),
    zernio: zernioConfig(env,processing),
    channelProcessing:Object.freeze({enabled:processing,pollMilliseconds:5000,heartbeatMilliseconds:30000}),
    media:Object.freeze(mediaEnabled?{enabled:true,directory:env.MEDIA_STORAGE_DIR,requireMarker:production,
      maxBytes:integer(env.MEDIA_MAX_FILE_BYTES,104857600,1024,134217728,'MEDIA_MAX_FILE_BYTES'),
      minFreeBytes:integer(env.MEDIA_MIN_FREE_BYTES,2147483648,0,1099511627776,'MEDIA_MIN_FREE_BYTES')}:{enabled:false}),
  });
}
