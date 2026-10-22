import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { readConfig } from '../server/src/config.mjs';
import { createApp } from '../server/src/app.mjs';
import { hashPassword, createPasswordVerifier } from '../server/src/passwords.mjs';
import { migrate, readMigrations, checkSchema } from '../server/src/migrations.mjs';
import { assertRuntimeRole } from '../server/src/database.mjs';

const env = {
  NODE_ENV: 'production', API_ORIGIN: 'https://api.nina.example.com',
  FRONTEND_ORIGIN: 'https://nina.example.com',
  DATABASE_URL: 'postgresql://nina_app:synthetic@localhost/nina',
};
const config = readConfig(env);
const password = 'Synthetic-password-2026!';
const userId = randomUUID();
let engine, db, migrations, passwordHash, app;

function adapter(pg) {
  return {
    query: async (text, values = []) => (await pg.query(text, values)).rows,
    exec: text => pg.exec(text),
    transaction: fn => pg.transaction(tx => fn(adapter(tx))),
  };
}

function request(path, { method = 'GET', body, origin = config.frontendOrigin, cookie, headers = {} } = {}) {
  return new Request(`${config.apiOrigin}${path}`, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}), ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function login(overrides = {}) {
  return app(request('/v1/auth/login', { method: 'POST',
    body: { email: 'agent@example.com', password }, ...overrides }));
}
function sessionCookie(response) { return response.headers.get('set-cookie').split(';')[0]; }

before(async () => {
  engine = new PGlite();
  db = adapter(engine);
  migrations = await readMigrations();
  await migrate(db, migrations);
  const grantSQL = await readFile(new URL('../server/sql/runtime-role.sql', import.meta.url), 'utf8');
  // PGlite's database is named postgres. Execute the production grants with only
  // the database name adjusted; all schema/table/role privileges are unchanged.
  await db.exec(grantSQL.replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
  passwordHash = await hashPassword(password);
});

beforeEach(async () => {
  await db.exec(`RESET ROLE;
    TRUNCATE nina_mail.outbox, nina_auth.password_resets, nina_auth.sessions,
      nina_auth.user_roles, nina_auth.users, nina_auth.login_windows;
  `);
  await db.query('INSERT INTO nina_auth.users (id, email, full_name, password_hash) VALUES ($1,$2,$3,$4)',
    [userId, 'agent@example.com', 'Agente de teste', passwordHash]);
  await db.query('INSERT INTO nina_auth.user_roles VALUES ($1,$2)', [userId, 'user']);
  await db.exec('SET ROLE nina_app');
  app = createApp({ db, config, migrations });
});

after(async () => { await engine?.close(); });

test('native API: runtime role is limited and readiness checks schema history', async () => {
  await assertRuntimeRole(db);
  assert.equal((await app(request('/readyz'))).status, 200);
  await db.exec('RESET ROLE');
  await assert.rejects(assertRuntimeRole(db), { code: 'UNSAFE_DATABASE_ROLE' });
  assert.equal((await app(request('/readyz'))).status, 503);
  await db.exec('SET ROLE nina_app');
  const wrongSchema = createApp({ db, config, migrations: [{ ...migrations[0], checksum: 'changed' }] });
  assert.equal((await wrongSchema(request('/readyz'))).status, 503);
});

test('native API: runtime cannot create roles, change identities or escalate privileges', async () => {
  await assert.rejects(db.query('UPDATE nina_auth.users SET email = $1 WHERE id = $2', ['other@example.com', userId]), /permission denied/);
  await assert.rejects(db.query('UPDATE nina_auth.users SET disabled_at = now() WHERE id = $1', [userId]), /permission denied/);
  await assert.rejects(db.query('INSERT INTO nina_auth.user_roles VALUES ($1,$2)', [userId, 'admin']), /permission denied/);
  await assert.rejects(db.exec('CREATE ROLE rogue'), /permission denied/);
  await assert.rejects(db.exec('CREATE TABLE nina_auth.rogue(id integer)'), /permission denied/);
});

test('native API: migrations are idempotent and checksum changes roll back', async () => {
  await db.exec('RESET ROLE');
  assert.deepEqual(await migrate(db, migrations), []);
  await assert.rejects(migrate(db, [{ ...migrations[0], checksum: 'changed' }]), /history differs/);
  assert.equal(await checkSchema(db, migrations), true);
  const broken = { version: '0003_broken.sql', checksum: 'x'.repeat(64),
    sql: 'CREATE TABLE nina_auth.should_rollback(id integer); SELECT missing_column;' };
  await assert.rejects(migrate(db, [...migrations, broken]), /missing_column/);
  assert.equal((await db.query("SELECT to_regclass('nina_auth.should_rollback') AS table_name"))[0].table_name, null);
  assert.equal(await checkSchema(db, migrations), true);
});

test('native API: login uses host-only secure cookies and stores only token hashes', async () => {
  const response = await login({ body: { email: ' AGENT@example.com ', password } });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  for (const flag of ['__Host-nina_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure']) assert.ok(setCookie.includes(flag));
  assert.ok(!setCookie.includes('Domain='));
  const token = sessionCookie(response).split('=')[1];
  const [session] = await db.query('SELECT token_hash FROM nina_auth.sessions');
  assert.notEqual(session.token_hash, token);
  assert.equal(session.token_hash, createHash('sha256').update(token).digest('hex'));
  const body = await response.json();
  assert.deepEqual(body.user.roles, ['user']);
  assert.equal(body.user.id, userId);
  assert.ok(!JSON.stringify(body).includes(passwordHash));
  const who = await app(request('/v1/auth/session', { cookie: sessionCookie(response) }));
  assert.equal(who.status, 200);
  assert.equal((await who.json()).user.email, 'agent@example.com');
});

test('native API: missing, forged, duplicate and expired cookies are rejected', async () => {
  assert.equal((await app(request('/v1/auth/session'))).status, 401);
  assert.equal((await app(request('/v1/auth/session', { cookie: '__Host-nina_session=' + 'a'.repeat(43) }))).status, 401);
  const response = await login();
  const cookie = sessionCookie(response);
  assert.equal((await app(request('/v1/auth/session', { cookie: `${cookie}; ${cookie}` }))).status, 401);
  await db.exec("RESET ROLE; UPDATE nina_auth.sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'; SET ROLE nina_app");
  assert.equal((await app(request('/v1/auth/session', { cookie }))).status, 401);
});

test('native API: logout revokes a session immediately without ending another session', async () => {
  const first = sessionCookie(await login());
  const second = sessionCookie(await login());
  const out = await app(request('/v1/auth/logout', { method: 'POST', cookie: first }));
  assert.equal(out.status, 200);
  assert.ok(out.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal((await app(request('/v1/auth/session', { cookie: first }))).status, 401);
  assert.equal((await app(request('/v1/auth/session', { cookie: second }))).status, 200);
  assert.equal((await app(request('/v1/auth/logout-all', { method: 'POST', cookie: second }))).status, 200);
  assert.equal((await app(request('/v1/auth/session', { cookie: second }))).status, 401);
});

test('native API: role removal and account disablement take effect on existing sessions', async () => {
  const cookie = sessionCookie(await login());
  await db.exec("RESET ROLE; UPDATE nina_auth.user_roles SET role = 'admin'; SET ROLE nina_app");
  assert.deepEqual((await (await app(request('/v1/auth/session', { cookie }))).json()).user.roles, ['admin']);
  await db.exec('RESET ROLE; DELETE FROM nina_auth.user_roles; SET ROLE nina_app');
  assert.equal((await app(request('/v1/auth/session', { cookie }))).status, 401);
  await db.exec("RESET ROLE; INSERT INTO nina_auth.user_roles SELECT id, 'user' FROM nina_auth.users; UPDATE nina_auth.users SET disabled_at = now(); SET ROLE nina_app");
  assert.equal((await app(request('/v1/auth/session', { cookie }))).status, 401);
  assert.equal((await login()).status, 401);
});

test('native API: logout-all cannot revoke another user and sessions are bounded per account', async () => {
  const otherId = randomUUID();
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO nina_auth.users (id, email, password_hash) VALUES ($1,$2,$3)',
    [otherId, 'other@example.com', passwordHash]);
  await db.query('INSERT INTO nina_auth.user_roles VALUES ($1,$2)', [otherId, 'user']);
  await db.exec('SET ROLE nina_app');
  for (let i = 0; i < 10; i++) {
    await db.query(`INSERT INTO nina_auth.sessions (token_hash, user_id, created_at, expires_at)
      VALUES ($1, $2, now() - $3 * interval '1 minute', now() + interval '1 hour')`,
    [createHash('sha256').update(`synthetic-old-token-${i}`).digest('hex'), userId, i + 1]);
  }
  const other = sessionCookie(await login({ body: { email: 'other@example.com', password } }));
  const own = sessionCookie(await login());
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.sessions WHERE user_id = $1', [userId]))[0].total, 10);
  assert.equal((await app(request('/v1/auth/logout-all', { method: 'POST', cookie: own }))).status, 200);
  assert.equal((await app(request('/v1/auth/session', { cookie: other }))).status, 200);
});

test('native API: public signup and generic SQL routes do not exist', async () => {
  assert.equal((await app(request('/v1/auth/signup', { method: 'POST', body: { email: 'new@example.com', password } }))).status, 404);
  assert.equal((await app(request('/v1/sql', { method: 'POST', body: { query: 'select * from nina_auth.users' } }))).status, 404);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.users'))[0].total, 1);
});

test('native API: invalid, nonexistent and unsupported legacy passwords return the same error', async () => {
  const wrong = await login({ body: { email: 'agent@example.com', password: 'incorrect' } });
  const missing = await login({ body: { email: 'missing@example.com', password } });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual((await wrong.json()).error, (await missing.json()).error);
  await db.exec("RESET ROLE; UPDATE nina_auth.users SET password_hash = 'unsupported-legacy-hash'; SET ROLE nina_app");
  assert.equal((await login()).status, 401);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.sessions'))[0].total, 0);
});

test('native API: login limits persist across application instances', async () => {
  for (let i = 0; i < config.loginAccountLimit; i++) {
    const response = await app(request('/v1/auth/login', { method: 'POST', body: { email: 'agent@example.com', password, role: 'admin' } }));
    assert.equal(response.status, 400, 'unrecognized input cannot grant roles');
  }
  // Fill the shared database window to exercise restart/replica persistence
  // without burning CPU hashing ten passwords in this regression test.
  await db.query(`INSERT INTO nina_auth.login_windows (key, window_start, attempts)
    VALUES ($1, floor(extract(epoch FROM now()) / 900)::bigint, $2)`,
  [createHash('sha256').update('agent@example.com').digest('hex'), config.loginAccountLimit]);
  const anotherInstance = createApp({ db, config, migrations });
  const response = await anotherInstance(request('/v1/auth/login', { method: 'POST', body: { email: 'agent@example.com', password } }));
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.sessions'))[0].total, 0);
});

test('native API: global login limit stops attempts across different addresses', async () => {
  await db.query(`INSERT INTO nina_auth.login_windows (key, window_start, attempts)
    VALUES ('global', floor(extract(epoch FROM now()) / 900)::bigint, $1)`, [config.loginGlobalLimit]);
  assert.equal((await login({ body: { email: 'another@example.com', password } })).status, 429);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.login_windows'))[0].total, 1);
});

test('native API: cross-origin, missing-origin and non-JSON login requests are blocked', async () => {
  for (const origin of [null, 'https://evil.example', 'https://another.nina.example.com']) {
    const response = await login({ origin });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await app(new Request(`${config.apiOrigin}/v1/auth/login`, {
    method: 'POST', headers: { origin: config.frontendOrigin, 'content-type': 'text/plain' }, body: '{}',
  }))).status, 415);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.login_windows'))[0].total, 0);
});

test('native API: allowed browser preflight uses the exact origin and credentials', async () => {
  const response = await app(request('/v1/auth/login', { method: 'OPTIONS', headers: {
    'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type',
  } }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), config.frontendOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  const denied = await app(request('/v1/auth/login', { method: 'OPTIONS', headers: {
    'access-control-request-method': 'POST', 'access-control-request-headers': 'x-admin-role',
  } }));
  assert.equal(denied.status, 403);
});

test('native API: malformed/oversized payloads and SQL-like inputs cannot bypass login', async () => {
  const invalid = await app(new Request(`${config.apiOrigin}/v1/auth/login`, {
    method: 'POST', headers: { origin: config.frontendOrigin, 'content-type': 'application/json' }, body: '{broken',
  }));
  assert.equal(invalid.status, 400);
  const huge = await login({ body: { email: 'agent@example.com', password: 'x'.repeat(20000) } });
  assert.equal(huge.status, 413);
  const injection = await login({ body: { email: "x'OR'1'='1@example.com", password } });
  assert.equal(injection.status, 401);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.users'))[0].total, 1);
});

test('native API: unexpected database failures do not expose connection details', async () => {
  const logs = [];
  const broken = createApp({ db: { query: async () => { throw new Error('password=NEVER_EXPOSE url=postgresql://secret'); } },
    config, migrations, log: entry => logs.push(entry) });
  const response = await broken(request('/v1/auth/session', { cookie: '__Host-nina_session=' + 'a'.repeat(43) }));
  assert.equal(response.status, 500);
  assert.ok(!JSON.stringify(await response.json()).includes('NEVER_EXPOSE'));
  assert.ok(!JSON.stringify(logs).includes('secret'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('native API: production configuration rejects insecure origins and ambiguous SSL settings', () => {
  for (const change of [
    { FRONTEND_ORIGIN: 'http://nina.example.com' },
    { API_ORIGIN: 'https://user:secret@api.nina.example.com' },
    { DATABASE_URL: env.DATABASE_URL + '?sslmode=disable' },
    { DATABASE_SSL: 'prefer' }, { SESSION_TTL_SECONDS: '0' }, { NODE_ENV: 'staging' },
  ]) assert.throws(() => readConfig({ ...env, ...change }));
  assert.equal(readConfig({ ...env, NODE_ENV: undefined }).production, true);
  assert.equal(readConfig({ ...env, NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173', API_ORIGIN: 'http://localhost:3000' }).cookieName, 'nina_session');
});

test('native API: password hashing is salted and bounds concurrent verification work', async () => {
  const anotherHash = await hashPassword(password);
  assert.notEqual(anotherHash, passwordHash);
  const verify = createPasswordVerifier(1);
  const first = verify(password, passwordHash);
  await assert.rejects(verify(password, passwordHash), { status: 429, code: 'AUTH_BUSY' });
  assert.equal(await first, true);
  assert.equal(await verify('wrong', passwordHash), false);
});
