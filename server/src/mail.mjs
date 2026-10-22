import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class MailError extends Error {
  constructor(code, retryable = false, retryAfter = 0) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

export function encryptMail(payload, key, jobId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(jobId));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptMail(encoded, key, jobId) {
  try {
    const parts = encoded.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAAD(Buffer.from(jobId));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8'));
  } catch { throw new MailError('MAIL_DECRYPT_FAILED'); }
}

export function createMailer(config, fetcher = globalThis.fetch) {
  return {
    async send(payload, jobId) {
      let response;
      try {
        response = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json',
            'idempotency-key': `password-reset/${jobId}` },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
          redirect: 'error',
        });
      } catch { throw new MailError('MAIL_NETWORK_ERROR', true); }
      let body;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) {
        const transient = [408, 429].includes(response.status) || response.status >= 500 ||
          (response.status === 409 && body?.name === 'concurrent_idempotent_requests');
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new MailError(`MAIL_HTTP_${response.status}`, transient,
          Number.isFinite(retryAfter) ? Math.min(300, Math.max(0, retryAfter)) : 0);
      }
      if (typeof body?.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.id)) {
        throw new MailError('MAIL_INVALID_RESPONSE', true);
      }
      return body.id;
    },
  };
}

const escapeHtml = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function recoveryEmail(from, recipient, link) {
  return {
    from, to: [recipient], subject: 'Redefinir sua senha — Nina Vet',
    text: `Você solicitou uma nova senha para a Nina Vet.\n\nAbra este link em até 20 minutos:\n${link}\n\nSe não foi você, ignore esta mensagem. Sua senha continua a mesma.`,
    html: `<div lang="pt-BR"><h1>Redefinir sua senha</h1><p>Você solicitou uma nova senha para a Nina Vet.</p><p><a href="${escapeHtml(link)}">Escolher uma nova senha</a></p><p>O link vale por 20 minutos e pode ser usado uma única vez.</p><p>Se não foi você, ignore esta mensagem. Sua senha continua a mesma.</p></div>`,
  };
}
