import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { createPasswordVerifier } from './passwords.mjs';
import { createAttemptLimiter } from './attempt-limiter.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const unauthorized = () => new ApiError(401, 'UNAUTHENTICATED', 'Entre novamente para continuar.');

function sessionToken(request, config) {
  const cookies = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim());
  const matches = cookies.filter(part => part.startsWith(`${config.cookieName}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(config.cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function cookie(config, token, maxAge) {
  return `${config.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` +
    (config.production ? '; Secure' : '');
}

function publicUser(user) {
  return { id: user.id, email: user.email, full_name: user.full_name, roles: user.roles };
}

export function createAuth(db, config) {
  const verifyPassword = createPasswordVerifier();

  const takeLoginAttempt = createAttemptLimiter(db, { windowSeconds: config.loginWindowSeconds,
    globalLimit: config.loginGlobalLimit, identityLimit: config.loginAccountLimit });

  async function authenticate(request) {
    const token = sessionToken(request, config);
    if (!token) throw unauthorized();
    const [user] = await db.query(`
      SELECT u.id, u.email, u.full_name, s.expires_at,
        ARRAY(SELECT r.role FROM nina_auth.user_roles r WHERE r.user_id = u.id ORDER BY r.role) AS roles
      FROM nina_auth.sessions s JOIN nina_auth.users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL
    `, [digest(token)]);
    if (!user || user.roles.length === 0) throw unauthorized();
    return { user: publicUser(user), expires_at: user.expires_at, tokenHash: digest(token) };
  }

  return {
    authenticate,
    clearCookie: () => cookie(config, '', 0),
    async login(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some(key => !['email', 'password'].includes(key)) ||
          typeof input.email !== 'string' || typeof input.password !== 'string' ||
          input.email.length > 320 || !input.password || Buffer.byteLength(input.password) > 1024) {
        throw new ApiError(400, 'INVALID_CREDENTIALS_FORMAT', 'Informe e-mail e senha válidos.');
      }
      const email = input.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ApiError(400, 'INVALID_CREDENTIALS_FORMAT', 'Informe e-mail e senha válidos.');
      }
      await takeLoginAttempt(email);
      const [user] = await db.query(`
        SELECT u.id, u.email, u.full_name, u.password_hash, u.disabled_at,
          ARRAY(SELECT r.role FROM nina_auth.user_roles r WHERE r.user_id = u.id ORDER BY r.role) AS roles
        FROM nina_auth.users u WHERE u.email = $1
      `, [email]);
      const verified = await verifyPassword(input.password, user?.password_hash);
      if (!verified || user.disabled_at || user.roles.length === 0) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
      }
      const token = randomBytes(32).toString('base64url');
      // Serializing per user bounds sessions across replicas, including concurrent logins.
      const expiresAt = await db.transaction(async tx => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.id]);
        const [current] = await tx.query('SELECT disabled_at, password_hash FROM nina_auth.users WHERE id = $1', [user.id]);
        if (!current || current.disabled_at || current.password_hash !== user.password_hash) throw unauthorized();
        await tx.query('DELETE FROM nina_auth.sessions WHERE expires_at <= now()');
        await tx.query(`DELETE FROM nina_auth.sessions WHERE token_hash IN (
          SELECT token_hash FROM nina_auth.sessions WHERE user_id = $1
          ORDER BY created_at DESC, token_hash LIMIT ALL OFFSET 9
        )`, [user.id]);
        const [session] = await tx.query(`INSERT INTO nina_auth.sessions (token_hash, user_id, expires_at)
          VALUES ($1, $2, now() + $3 * interval '1 second') RETURNING expires_at`,
        [digest(token), user.id, config.sessionTtlSeconds]);
        return session.expires_at;
      });
      return {
        body: { user: publicUser(user), expires_at: expiresAt },
        cookie: cookie(config, token, config.sessionTtlSeconds),
      };
    },
    async session(request) {
      const { user, expires_at } = await authenticate(request);
      return { user, expires_at };
    },
    async logout(request, all = false) {
      const session = await authenticate(request);
      await db.query(all ? 'DELETE FROM nina_auth.sessions WHERE user_id = $1' :
        'DELETE FROM nina_auth.sessions WHERE token_hash = $1',
      [all ? session.user.id : session.tokenHash]);
      return { body: { ok: true }, cookie: cookie(config, '', 0) };
    },
  };
}
