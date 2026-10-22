import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';

export function createAttemptLimiter(db, { prefix = '', windowSeconds, globalLimit, identityLimit }) {
  return async identity => {
    await db.query(`DELETE FROM nina_auth.login_windows
      WHERE window_start < floor(extract(epoch FROM now()) / $1)::bigint - 96
        AND (key = $2 OR (key LIKE $3 AND length(key) = $4))`,
    [windowSeconds, `${prefix}global`, `${prefix}%`, prefix.length + 64]);
    const identityHash = createHash('sha256').update(identity).digest('hex');
    for (const [key, limit] of [[`${prefix}global`, globalLimit], [`${prefix}${identityHash}`, identityLimit]]) {
      const [window] = await db.query(`
        INSERT INTO nina_auth.login_windows (key, window_start, attempts)
        VALUES ($1, floor(extract(epoch FROM now()) / $2)::bigint, 1)
        ON CONFLICT (key, window_start) DO UPDATE
          SET attempts = nina_auth.login_windows.attempts + 1
        RETURNING attempts,
          GREATEST(1, ceil((window_start + 1) * $2 - extract(epoch FROM now())))::integer AS retry_after
      `, [key, windowSeconds]);
      if (window.attempts > limit) {
        throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas. Aguarde antes de tentar novamente.', window.retry_after);
      }
    }
  };
}
