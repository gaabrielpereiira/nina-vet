import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiError } from './errors.mjs';
import { createAttemptLimiter } from './attempt-limiter.mjs';
import { createPasswordHasher } from './passwords.mjs';
import { encryptMail, recoveryEmail } from './mail.mjs';

export const credentialFingerprint = user => createHash('sha256')
  .update(`${user.email}\n${user.password_hash ?? ''}`).digest('hex');
const digest = token => createHash('sha256').update(token).digest('hex');
const genericMessage = Object.freeze({ message: 'Se houver uma conta ativa com esse e-mail, enviaremos um link para redefinir sua senha.' });
const invalidLink = () => new ApiError(400, 'RESET_LINK_INVALID', 'Link inválido ou expirado. Solicite um novo link.');

function onlyFields(input, fields) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).every(key => fields.includes(key));
}

export function createPasswordRecovery(db, config) {
  const hashPassword = createPasswordHasher();
  const requestLimit = createAttemptLimiter(db, { prefix: 'reset-request:', windowSeconds: 900,
    globalLimit: 20, identityLimit: 3 });
  const consumeLimit = createAttemptLimiter(db, { prefix: 'reset-consume:', windowSeconds: 900,
    globalLimit: 200, identityLimit: 5 });
  const requireEnabled = () => {
    if (!config.email?.enabled) throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'A recuperação de senha está temporariamente indisponível.');
  };

  return {
    async request(input) {
      requireEnabled();
      if (!onlyFields(input, ['email']) || typeof input.email !== 'string' || input.email.length > 320 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
        throw new ApiError(400, 'INVALID_EMAIL', 'Informe um e-mail válido.');
      }
      const started = Date.now();
      const email = input.email.trim().toLowerCase();
      await requestLimit(email);
      await db.transaction(async tx => {
        await tx.query('DELETE FROM nina_auth.password_resets WHERE expires_at <= now()');
        const [found] = await tx.query('SELECT id FROM nina_auth.users WHERE email = $1', [email]);
        if (!found) return;
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [found.id]);
        const [user] = await tx.query(`SELECT u.id, u.email, u.password_hash FROM nina_auth.users u
          WHERE u.id = $1 AND u.email = $2 AND u.disabled_at IS NULL
            AND EXISTS (SELECT 1 FROM nina_auth.user_roles r WHERE r.user_id = u.id)`, [found.id, email]);
        if (!user) return;
        const resetId = randomUUID(), jobId = randomUUID();
        const token = randomBytes(32).toString('base64url');
        const link = new URL('/auth/set-password', config.frontendOrigin);
        // A fragment keeps the bearer token out of web server access logs/referrers.
        link.hash = `token=${token}`;
        const ciphertext = encryptMail(recoveryEmail(config.email.from, user.email, link.href),
          config.email.encryptionKey, jobId);
        const [reset] = await tx.query(`INSERT INTO nina_auth.password_resets
          (id, token_hash, user_id, credential_fingerprint, expires_at)
          VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second') RETURNING expires_at`,
        [resetId, digest(token), user.id, credentialFingerprint(user), config.email.resetTtlSeconds]);
        await tx.query(`INSERT INTO nina_mail.outbox (id, reset_id, payload_ciphertext, expires_at)
          VALUES ($1, $2, $3, $4)`, [jobId, resetId, ciphertext, reset.expires_at]);
      });
      // Outbound network work happens in the worker, never in this response.
      // A floor hides ordinary lookup/queue latency; rate limits also cover unknown accounts.
      await delay(Math.max(0, 200 - (Date.now() - started)));
      return genericMessage;
    },

    async reset(input) {
      requireEnabled();
      if (!onlyFields(input, ['token', 'password']) || typeof input.token !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw invalidLink();
      if (typeof input.password !== 'string' || input.password.length < 12 || Buffer.byteLength(input.password) > 1024) {
        throw new ApiError(400, 'WEAK_PASSWORD', 'Use uma senha com pelo menos 12 caracteres e até 1024 bytes.');
      }
      await consumeLimit(input.token);
      const tokenHash = digest(input.token);
      const [candidate] = await db.query(`SELECT r.user_id FROM nina_auth.password_resets r
        JOIN nina_auth.users u ON u.id = r.user_id
        WHERE r.token_hash = $1 AND r.expires_at > now() AND u.disabled_at IS NULL
          AND r.credential_fingerprint = encode(sha256(convert_to(u.email || E'\n' || coalesce(u.password_hash, ''), 'UTF8')), 'hex')
          AND EXISTS (SELECT 1 FROM nina_auth.user_roles ur WHERE ur.user_id = u.id)`, [tokenHash]);
      if (!candidate) throw invalidLink();
      const newHash = await hashPassword(input.password);
      await db.transaction(async tx => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [candidate.user_id]);
        const [consumed] = await tx.query(`DELETE FROM nina_auth.password_resets r USING nina_auth.users u
          WHERE r.user_id = u.id AND r.token_hash = $1 AND r.expires_at > now() AND u.disabled_at IS NULL
            AND r.credential_fingerprint = encode(sha256(convert_to(u.email || E'\n' || coalesce(u.password_hash, ''), 'UTF8')), 'hex')
            AND EXISTS (SELECT 1 FROM nina_auth.user_roles ur WHERE ur.user_id = u.id)
          RETURNING r.user_id`, [tokenHash]);
        if (!consumed) throw invalidLink();
        await tx.query('UPDATE nina_auth.users SET password_hash = $1 WHERE id = $2', [newHash, consumed.user_id]);
        await tx.query('DELETE FROM nina_auth.sessions WHERE user_id = $1', [consumed.user_id]);
        await tx.query('DELETE FROM nina_auth.password_resets WHERE user_id = $1', [consumed.user_id]);
      });
      return { ok: true, message: 'Senha atualizada. Entre novamente com sua nova senha.' };
    },
  };
}
