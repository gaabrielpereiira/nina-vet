import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, randomUUID,
  timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.mjs';

export const MAX_WEBHOOK_BYTES = 64 * 1024;
export const MAX_INBOX_EVENTS = 5000;
const EVENTS = new Set(['message.received', 'message.sent', 'message.delivered', 'message.read', 'message.failed']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new ApiError(400, 'INVALID_WEBHOOK', 'Evento inválido.');
function unavailable() {
  const error = new ApiError(503, 'WEBHOOK_UNAVAILABLE', 'Recebimento temporariamente indisponível.');
  error.retryAfter = 60;
  return error;
}
const aad = row => Buffer.from(`nina:zernio-inbox:v1:${row.accountId}:${row.eventId}:${row.id}`);

export function encryptInbox(raw, key, row) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(row));
  const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

// For a future worker/operator recovery. The HTTP receiver has no ciphertext SELECT grant.
export function decryptInbox(encoded, key, row) {
  try {
    const parts = encoded.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error();
    const iv = Buffer.from(parts[1], 'base64url'), tag = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad(row)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]);
  } catch { throw new Error('INBOX_DECRYPT_FAILED'); }
}

async function rawBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Envie os dados em JSON.');
  }
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') {
    throw new ApiError(415, 'ENCODING_UNSUPPORTED', 'Codificação não permitida.');
  }
  if (Number(request.headers.get('content-length')) > MAX_WEBHOOK_BYTES) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'Conteúdo muito grande.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'BODY_TOO_LARGE', 'Conteúdo muito grande.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}

function envelope(raw) {
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
  if (!object(payload) || !UUID.test(payload.id ?? '') || typeof payload.event !== 'string' ||
      payload.event.length > 100 || typeof payload.timestamp !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(payload.timestamp) ||
      !Number.isFinite(Date.parse(payload.timestamp)) ||
      (payload.test !== undefined && typeof payload.test !== 'boolean')) throw invalid();
  return payload;
}

function assertScope(payload, config) {
  const account = payload.account;
  if (!object(account) || account.accountId !== config.accountId ||
      (account.id !== undefined && account.id !== config.accountId) ||
      account.profileId !== config.profileId ||
      (payload.profiles !== undefined && (!Array.isArray(payload.profiles) ||
        payload.profiles.length !== 1 || payload.profiles[0]?.id !== config.profileId))) {
    throw new ApiError(403, 'WEBHOOK_SCOPE_DENIED', 'Conta não permitida.');
  }
  // Receipt-only stage: preserve the signed payload; a later worker validates each message shape.
  if (!object(payload.message) || payload.message.platform !== 'whatsapp' ||
      (account.platform !== undefined && account.platform !== 'whatsapp')) throw invalid();
}

export function createZernioWebhook(db, config, log = () => {}) {
  let inFlight = 0;
  return async request => {
    if (!config?.enabled) throw new ApiError(503, 'WEBHOOK_DISABLED', 'Recebimento não ativado.');
    const signature = request.headers.get('x-zernio-signature');
    if (!/^[a-f0-9]{64}$/.test(signature ?? '')) {
      throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Assinatura inválida.');
    }
    const raw = await rawBody(request);
    const expected = createHmac('sha256', config.secret).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
      throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Assinatura inválida.');
    }
    const payload = envelope(raw);
    // These headers are not signed. Never use them for routing or deduplication.
    if (payload.event === 'webhook.test') return { status: 'test_received' };
    if (!EVENTS.has(payload.event)) return { status: 'ignored' };
    assertScope(payload, config);
    if (payload.test === true) return { status: 'test_received' };
    // Leave room in the five-connection pool for staff login and clinical requests.
    if (inFlight >= 2) throw unavailable();
    const eventId = payload.id.toLowerCase();
    const digest = createHash('sha256').update(raw).digest('hex');
    const row = { id: randomUUID(), accountId: config.accountId, eventId };
    const ciphertext = encryptInbox(raw, config.encryptionKey, row);
    inFlight++;
    try {
      return await db.transaction(async tx => {
        await tx.query("SELECT set_config('statement_timeout','2000',true), set_config('lock_timeout','500',true), set_config('nina.webhook_account_id',$1,true)", [config.accountId]);
        // Single short critical section shared by replicas. Backpressure, never acknowledge a dropped event.
        const [lock] = await tx.query('SELECT pg_try_advisory_xact_lock(7251030002) AS locked');
        if (!lock.locked) throw unavailable();
        const [existing] = await tx.query(`SELECT payload_sha256 FROM nina_channels.zernio_inbox
          WHERE account_id=$1 AND event_id=$2`, [config.accountId, eventId]);
        if (existing) {
          if (existing.payload_sha256 !== digest) throw new ApiError(409, 'WEBHOOK_EVENT_CONFLICT', 'Evento conflitante.');
          return { status: 'duplicate' };
        }
        const [size] = await tx.query('SELECT count(account_id)::integer AS total FROM nina_channels.zernio_inbox WHERE account_id=$1', [config.accountId]);
        if (size.total >= MAX_INBOX_EVENTS) throw unavailable();
        await tx.query(`INSERT INTO nina_channels.zernio_inbox
          (id,account_id,event_id,event_type,occurred_at,payload_sha256,payload_encrypted)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, config.accountId, eventId, payload.event, payload.timestamp, digest, ciphertext]);
        return { status: 'queued' };
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Provider body, signatures, IDs, phone numbers and SQL never go to logs.
      log({ event: 'zernio_inbox_unavailable' });
      throw unavailable();
    } finally { inFlight--; }
  };
}
