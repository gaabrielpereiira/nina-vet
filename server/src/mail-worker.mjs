import { randomUUID } from 'node:crypto';
import { createMailer, decryptMail, MailError } from './mail.mjs';
import { credentialFingerprint } from './password-recovery.mjs';

export function createMailWorker({ db, config, mailer = createMailer(config.email), log = () => {} }) {
  let timer, running, stopped = true;

  async function runOnce() {
    if (!config.email.enabled) return false;
    const leaseToken = randomUUID();
    const job = await db.transaction(async tx => {
      await tx.query('DELETE FROM nina_auth.password_resets WHERE expires_at <= now()');
      await tx.query(`UPDATE nina_mail.outbox SET status = 'cancelled', payload_ciphertext = NULL,
        lease_until = NULL, lease_token = NULL
        WHERE status IN ('pending','sending') AND expires_at <= now() + interval '30 seconds'`);
      const [next] = await tx.query(`SELECT j.*, u.email, u.password_hash, u.disabled_at,
          r.credential_fingerprint,
          EXISTS (SELECT 1 FROM nina_auth.user_roles ur WHERE ur.user_id = u.id) AS has_role
        FROM nina_mail.outbox j
        JOIN nina_auth.password_resets r ON r.id = j.reset_id
        JOIN nina_auth.users u ON u.id = r.user_id
        WHERE ((j.status = 'pending' AND j.available_at <= now()) OR
          (j.status = 'sending' AND j.lease_until <= now()))
          AND j.expires_at > now() + interval '30 seconds'
        ORDER BY j.available_at, j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
      if (!next) return null;
      if (next.attempts >= config.email.maxAttempts || next.disabled_at || !next.has_role ||
          credentialFingerprint(next) !== next.credential_fingerprint) {
        await tx.query(`UPDATE nina_mail.outbox SET status = 'cancelled', payload_ciphertext = NULL,
          lease_until = NULL, lease_token = NULL WHERE id = $1`, [next.id]);
        return null;
      }
      await tx.query(`UPDATE nina_mail.outbox SET status = 'sending', attempts = attempts + 1,
        lease_until = now() + interval '60 seconds', lease_token = $2 WHERE id = $1`, [next.id, leaseToken]);
      return { ...next, attempts: next.attempts + 1 };
    });
    if (!job) return false;

    try {
      const payload = decryptMail(job.payload_ciphertext, config.email.encryptionKey, job.id);
      const providerId = await mailer.send(payload, job.id);
      const acknowledged = await db.query(`UPDATE nina_mail.outbox SET status = 'sent', sent_at = now(), provider_id = $2,
        payload_ciphertext = NULL, lease_until = NULL, lease_token = NULL, last_error_code = NULL
        WHERE id = $1 AND lease_token = $3 AND status = 'sending' RETURNING id`, [job.id, providerId, leaseToken]);
      if (acknowledged.length) log({ event: 'mail_sent', job_id: job.id });
    } catch (error) {
      const code = error instanceof MailError ? error.code : 'MAIL_INTERNAL_ERROR';
      const retry = error instanceof MailError && error.retryable && job.attempts < config.email.maxAttempts;
      const seconds = Math.max(Math.min(300, 5 * 3 ** (job.attempts - 1)), error instanceof MailError ? error.retryAfter : 0);
      const updated = await db.query(`UPDATE nina_mail.outbox SET status = $2,
        payload_ciphertext = CASE WHEN $3::boolean THEN payload_ciphertext ELSE NULL END,
        available_at = now() + $4 * interval '1 second', lease_until = NULL, lease_token = NULL,
        last_error_code = $5 WHERE id = $1 AND lease_token = $6 AND status = 'sending' RETURNING id`,
      [job.id, retry ? 'pending' : 'failed', retry, seconds, code, leaseToken]);
      if (updated.length) log({ event: retry ? 'mail_retry_scheduled' : 'mail_failed', job_id: job.id, code });
    }
    return true;
  }

  async function tick() {
    if (stopped) return;
    running = runOnce();
    try { await running; }
    catch { log({ event: 'mail_worker_failed', code: 'MAIL_WORKER_ERROR' }); }
    finally {
      running = null;
      if (!stopped) { timer = setTimeout(tick, config.email.pollMilliseconds); timer.unref(); }
    }
  }
  return {
    runOnce,
    start() { if (stopped && config.email.enabled) { stopped = false; timer = setTimeout(tick, 0); timer.unref(); } },
    async stop() { stopped = true; clearTimeout(timer); await running?.catch(() => {}); },
  };
}
