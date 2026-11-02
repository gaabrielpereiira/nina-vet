import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { readConfig } from '../server/src/config.mjs';
import { createApp } from '../server/src/app.mjs';
import { hashPassword } from '../server/src/passwords.mjs';
import { migrate, readMigrations } from '../server/src/migrations.mjs';
import { createMailer, encryptMail, decryptMail, MailError } from '../server/src/mail.mjs';
import { createMailWorker } from '../server/src/mail-worker.mjs';

const baseEnv = { NODE_ENV: 'production', API_ORIGIN: 'https://api.nina.example.com',
  FRONTEND_ORIGIN: 'https://nina.example.com', DATABASE_URL: 'postgresql://nina_app:synthetic@localhost/nina' };
const emailEnv = { ...baseEnv, EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_SYNTHETIC_NOT_A_REAL_KEY',
  EMAIL_FROM: 'Nina Vet <acesso@nina.example.com>', EMAIL_ENCRYPTION_KEY: '42'.repeat(32) };
const config = readConfig(emailEnv);
const oldPassword = 'Synthetic-previous-password!', newPassword = 'Synthetic-new-password-2026!';
const userId = randomUUID();
const bcrypt = createRequire(new URL('../server/package.json', import.meta.url))('bcryptjs');
let engine, db, migrations, passwordHash, legacyPasswordHash, app;

function adapter(pg) {
  return { query: async (text, values = []) => (await pg.query(text, values)).rows,
    exec: text => pg.exec(text), transaction: fn => pg.transaction(tx => fn(adapter(tx))) };
}
function request(path, body, cookie, origin = config.frontendOrigin) {
  return new Request(`${config.apiOrigin}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(origin ? { origin } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const forgot = (email = 'agent@example.com', origin) => app(request('/v1/auth/forgot-password', { email }, undefined, origin));
const finish = (token, password = newPassword) => app(request('/v1/auth/reset-password', { token, password }));
const login = password => app(request('/v1/auth/login', { email: 'agent@example.com', password }));
async function queuedToken() {
  const [job] = await db.query('SELECT id, payload_ciphertext FROM nina_mail.outbox ORDER BY created_at LIMIT 1');
  const payload = decryptMail(job.payload_ciphertext, config.email.encryptionKey, job.id);
  const link = new URL(payload.text.match(/https:\/\/[^\s]+/)[0]);
  return { token: new URLSearchParams(link.hash.slice(1)).get('token'), job, payload, link };
}
const noSend = { send: async () => { throw new Error('Unexpected outbound mail in this test'); } };

before(async () => {
  engine = new PGlite(); db = adapter(engine);
  migrations = await readMigrations(); await migrate(db, migrations);
  await db.exec((await readFile(new URL('../server/sql/runtime-role.sql', import.meta.url), 'utf8'))
    .replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
  passwordHash = await hashPassword(oldPassword);
  legacyPasswordHash = await bcrypt.hash(oldPassword, 10);
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE nina_mail.outbox, nina_auth.password_resets, nina_auth.sessions,
    nina_auth.user_roles, nina_auth.users, nina_auth.login_windows CASCADE;`);
  await db.query('INSERT INTO nina_auth.users (id,email,full_name,password_hash) VALUES ($1,$2,$3,$4)',
    [userId, 'agent@example.com', 'Agente sintético', passwordHash]);
  await db.query('INSERT INTO nina_auth.user_roles VALUES ($1,$2)', [userId, 'user']);
  await db.exec('SET ROLE nina_app');
  app = createApp({ db, config, migrations });
});
after(async () => { await engine?.close(); });

test('native mail: recovery queues encrypted mail, sends through Resend and resets once', async () => {
  const previousSession = (await login(oldPassword)).headers.get('set-cookie').split(';')[0];
  const response = await forgot(); assert.equal(response.status, 202);
  const responseText = await response.text();
  const { token, job, link } = await queuedToken();
  assert.equal(link.origin, config.frontendOrigin); assert.equal(link.pathname, '/auth/set-password');
  assert.equal(link.search, ''); assert.equal(token.length, 43);
  assert.ok(!responseText.includes(token));
  assert.ok(!job.payload_ciphertext.includes(token));
  assert.ok(!job.payload_ciphertext.includes('agent@example.com'));
  assert.equal((await db.query('SELECT token_hash FROM nina_auth.password_resets'))[0].token_hash,
    createHash('sha256').update(token).digest('hex'));
  const calls = [];
  const mailer = createMailer(config.email, async (url, options) => {
    calls.push({ url, options }); return Response.json({ id: randomUUID() });
  });
  const worker = createMailWorker({ db, config, mailer });
  assert.equal(await worker.runOnce(), true);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${emailEnv.RESEND_API_KEY}`);
  assert.equal(calls[0].options.headers['idempotency-key'], `password-reset/${job.id}`);
  assert.deepEqual(JSON.parse(calls[0].options.body).to, ['agent@example.com']);
  assert.equal(JSON.parse(calls[0].options.body).from, emailEnv.EMAIL_FROM);
  const [sent] = await db.query('SELECT status, payload_ciphertext FROM nina_mail.outbox');
  assert.equal(sent.status, 'sent'); assert.equal(sent.payload_ciphertext, null);
  const changed = await finish(token); assert.equal(changed.status, 200);
  assert.ok(changed.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal((await app(request('/v1/auth/session', undefined, previousSession))).status, 401);
  assert.equal((await login(oldPassword)).status, 401);
  assert.equal((await login(newPassword)).status, 200);
  assert.equal((await finish(token)).status, 400);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.password_resets'))[0].total, 0);
});

test('native mail: unknown and disabled accounts receive the same generic response', async () => {
  const known = await forgot(); const unknown = await forgot('unknown@example.com');
  assert.equal(known.status, 202); assert.equal(unknown.status, 202);
  assert.deepEqual(await known.json(), await unknown.json());
  await db.exec('RESET ROLE; UPDATE nina_auth.users SET disabled_at=now(); SET ROLE nina_app');
  const disabled = await forgot(); assert.equal(disabled.status, 202);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_mail.outbox'))[0].total, 1);
  let sends = 0;
  const worker = createMailWorker({ db, config, mailer: { send: async () => { sends++; return randomUUID(); } } });
  assert.equal(await worker.runOnce(), false); assert.equal(sends, 0);
  assert.equal((await db.query('SELECT status FROM nina_mail.outbox'))[0].status, 'cancelled');
});

test('native mail: recovery upgrades migrated bcrypt and passwordless accounts without sending real email', async () => {
  for (const encoded of [legacyPasswordHash, null]) {
    await db.exec('RESET ROLE; DELETE FROM nina_auth.password_resets; DELETE FROM nina_auth.sessions;');
    await db.query('UPDATE nina_auth.users SET password_hash = $1 WHERE id = $2', [encoded, userId]);
    await db.exec('SET ROLE nina_app');
    const previous = await login(oldPassword);
    assert.equal(previous.status, encoded ? 200 : 401);
    const previousCookie = previous.headers.get('set-cookie')?.split(';')[0];
    assert.equal((await forgot()).status, 202);
    const { token } = await queuedToken();
    assert.equal((await finish(token)).status, 200);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM nina_auth.sessions'))[0].total, 0);
    if (previousCookie) assert.equal((await app(request('/v1/auth/session', undefined, previousCookie))).status, 401);
    assert.ok((await db.query('SELECT password_hash FROM nina_auth.users WHERE id = $1', [userId]))[0].password_hash.startsWith('scrypt$'));
    const current = await login(newPassword);
    assert.equal(current.status, 200);
    assert.deepEqual((await current.json()).user.roles, ['user']);
    assert.equal((await login(oldPassword)).status, 401);
  }
});

test('native mail: disabled email feature fails closed without creating jobs', async () => {
  const disabled = createApp({ db, config: readConfig(baseEnv), migrations });
  assert.equal((await disabled(request('/v1/auth/forgot-password', { email: 'agent@example.com' }))).status, 503);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_mail.outbox'))[0].total, 0);
});

test('native mail: request origin, redirect injection and per-account limits are enforced', async () => {
  assert.equal((await forgot('agent@example.com', null)).status, 403);
  assert.equal((await forgot('agent@example.com', 'https://evil.example')).status, 403);
  assert.equal((await app(request('/v1/auth/forgot-password', {
    email: 'agent@example.com', redirectTo: 'https://evil.example' }))).status, 400);
  for (let i = 0; i < 3; i++) assert.equal((await forgot()).status, 202);
  assert.equal((await forgot()).status, 429);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_mail.outbox'))[0].total, 3);
});

test('native mail: expired links and their queued mail cannot be used or delivered', async () => {
  await forgot(); const { token } = await queuedToken();
  await db.query("DELETE FROM nina_auth.login_windows WHERE key LIKE 'reset-consume:%'");
  await db.exec("RESET ROLE; UPDATE nina_auth.password_resets SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'; SET ROLE nina_app");
  assert.equal((await finish(token)).status, 400);
  assert.equal(await createMailWorker({ db, config, mailer: noSend }).runOnce(), false);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_mail.outbox'))[0].total, 0);
});

test('native mail: email/password/role changes invalidate previously issued reset links', async () => {
  await forgot(); const { token } = await queuedToken();
  await db.exec("RESET ROLE; UPDATE nina_auth.users SET email='changed@example.com'; SET ROLE nina_app");
  assert.equal((await finish(token)).status, 400);
  assert.equal(await createMailWorker({ db, config, mailer: noSend }).runOnce(), false);
  assert.equal((await db.query('SELECT status FROM nina_mail.outbox'))[0].status, 'cancelled');
  await db.exec("RESET ROLE; UPDATE nina_auth.users SET email='agent@example.com'; DELETE FROM nina_auth.user_roles; SET ROLE nina_app");
  assert.equal((await finish(token)).status, 400);
});

test('native mail: a successful reset invalidates every outstanding reset link', async () => {
  await forgot(); const first = await queuedToken();
  await forgot();
  const jobs = await db.query('SELECT id, payload_ciphertext FROM nina_mail.outbox');
  const other = jobs.find(job => job.id !== first.job.id);
  const payload = decryptMail(other.payload_ciphertext, config.email.encryptionKey, other.id);
  const otherToken = new URLSearchParams(new URL(payload.text.match(/https:\/\/[^\s]+/)[0]).hash.slice(1)).get('token');
  assert.equal((await finish(first.token)).status, 200);
  assert.equal((await finish(otherToken)).status, 400);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_mail.outbox'))[0].total, 0);
});

test('native mail: forged tokens and weak passwords do not consume a valid reset link', async () => {
  await forgot(); const { token } = await queuedToken();
  assert.equal((await finish('a'.repeat(43))).status, 400);
  assert.equal((await finish(token, 'short')).status, 400);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.password_resets'))[0].total, 1);
  assert.equal((await finish(token)).status, 200);
});

test('native mail: simultaneous reset attempts consume the token exactly once', async () => {
  await forgot(); const { token } = await queuedToken();
  const responses = await Promise.all([finish(token, newPassword), finish(token, newPassword + '2')]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  const winner = responses[0].status === 200 ? newPassword : newPassword + '2';
  assert.equal((await login(winner)).status, 200);
});

test('native mail: a password change cannot race with an already verified old-password login', async () => {
  const changedHash = await hashPassword(newPassword);
  let intercept = true;
  const racingDb = { ...db, transaction: async fn => {
    if (intercept) { intercept = false; await db.query('UPDATE nina_auth.users SET password_hash=$1 WHERE id=$2', [changedHash,userId]); }
    return db.transaction(fn);
  } };
  const racingApp = createApp({ db: racingDb, config, migrations });
  assert.equal((await racingApp(request('/v1/auth/login', { email:'agent@example.com', password: oldPassword }))).status, 401);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.sessions'))[0].total, 0);
});

test('native mail: retries survive worker restart and reuse the exact body/idempotency key', async () => {
  await forgot(); const { job } = await queuedToken();
  const calls = [], logs = [];
  const mailer = createMailer(config.email, async (url, options) => {
    calls.push(options);
    if (calls.length === 1) throw new Error('private recipient agent@example.com and secret content');
    return Response.json({ id: randomUUID() });
  });
  await createMailWorker({ db, config, mailer, log: entry => logs.push(entry) }).runOnce();
  const [pending] = await db.query('SELECT * FROM nina_mail.outbox');
  assert.equal(pending.status, 'pending'); assert.equal(pending.attempts, 1);
  assert.equal(pending.payload_ciphertext, job.payload_ciphertext);
  await db.query("UPDATE nina_mail.outbox SET available_at=now()-interval '1 second'");
  await createMailWorker({ db, config, mailer, log: entry => logs.push(entry) }).runOnce();
  assert.equal(calls.length, 2); assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key']);
  assert.equal((await db.query('SELECT status FROM nina_mail.outbox'))[0].status, 'sent');
  assert.ok(!JSON.stringify(logs).includes('agent@example.com'));
  assert.ok(!JSON.stringify(logs).includes(config.email.key));
});

test('native mail: permanent provider failures erase payloads and do not retry', async () => {
  await forgot(); let sends = 0;
  const mailer = createMailer(config.email, async () => { sends++; return Response.json({ message: 'sensitive detail' }, { status: 401 }); });
  const worker = createMailWorker({ db, config, mailer });
  await worker.runOnce(); await worker.runOnce();
  const [failed] = await db.query('SELECT * FROM nina_mail.outbox');
  assert.equal(sends, 1); assert.equal(failed.status, 'failed');
  assert.equal(failed.payload_ciphertext, null); assert.equal(failed.last_error_code, 'MAIL_HTTP_401');
});

test('native mail: provider 429 and in-progress idempotent requests can retry, conflicts cannot', async () => {
  const payload = { from: emailEnv.EMAIL_FROM, to: ['synthetic@example.com'], subject:'synthetic', text:'synthetic' };
  const limited = createMailer(config.email, async () => Response.json({}, { status:429, headers: {'retry-after':'120'} }));
  await assert.rejects(limited.send(payload, randomUUID()), error => error instanceof MailError && error.retryable && error.retryAfter === 120);
  const concurrent = createMailer(config.email, async () => Response.json({ name:'concurrent_idempotent_requests' }, { status:409 }));
  await assert.rejects(concurrent.send(payload, randomUUID()), error => error.retryable);
  const conflict = createMailer(config.email, async () => Response.json({ name:'invalid_idempotent_request' }, { status:409 }));
  await assert.rejects(conflict.send(payload, randomUUID()), error => !error.retryable);
});

test('native mail: queue leases prevent a second worker from sending the same active job', async () => {
  await forgot(); let complete, started, sends = 0;
  const began = new Promise(resolve => { started = resolve; });
  const mailer = { send: async () => { sends++; started(); return new Promise(resolve => { complete = resolve; }); } };
  const first = createMailWorker({ db, config, mailer }).runOnce();
  await began;
  assert.equal(await createMailWorker({ db, config, mailer }).runOnce(), false);
  complete(randomUUID()); await first;
  assert.equal(sends, 1);
});

test('native mail: stale workers cannot overwrite the result of a new lease', async () => {
  await forgot(); let complete, started;
  const began = new Promise(resolve => { started = resolve; });
  const first = createMailWorker({ db, config, mailer: { send: async () => {
    started(); return new Promise(resolve => { complete = resolve; });
  } } }).runOnce();
  await began;
  await db.query("UPDATE nina_mail.outbox SET lease_until=now()-interval '1 second'");
  const secondProviderId = randomUUID();
  await createMailWorker({ db, config, mailer:{ send:async () => secondProviderId } }).runOnce();
  complete(randomUUID()); await first;
  assert.equal((await db.query('SELECT provider_id FROM nina_mail.outbox'))[0].provider_id, secondProviderId);
});

test('native mail: exhausted delivery attempts cannot cause an unbounded retry loop', async () => {
  await forgot();
  await db.query('UPDATE nina_mail.outbox SET attempts=$1', [config.email.maxAttempts]);
  assert.equal(await createMailWorker({ db, config, mailer: noSend }).runOnce(), false);
  const [job] = await db.query('SELECT status,payload_ciphertext FROM nina_mail.outbox');
  assert.equal(job.status, 'cancelled'); assert.equal(job.payload_ciphertext, null);
});

test('native mail: corrupted/wrong-key payloads fail closed without contacting Resend', async () => {
  await forgot(); const { job } = await queuedToken();
  assert.throws(() => decryptMail(job.payload_ciphertext, Buffer.alloc(32,7), job.id), { code: 'MAIL_DECRYPT_FAILED' });
  assert.throws(() => decryptMail(job.payload_ciphertext, config.email.encryptionKey, randomUUID()), { code: 'MAIL_DECRYPT_FAILED' });
  await db.query('UPDATE nina_mail.outbox SET payload_ciphertext=$1', ['v1.AA.BB.CC']);
  await createMailWorker({ db, config, mailer: noSend }).runOnce();
  const [failed] = await db.query('SELECT status, payload_ciphertext, last_error_code FROM nina_mail.outbox');
  assert.equal(failed.status, 'failed'); assert.equal(failed.payload_ciphertext, null);
  assert.equal(failed.last_error_code, 'MAIL_DECRYPT_FAILED');
  const sample = encryptMail({ text:'private' }, config.email.encryptionKey, 'synthetic-job');
  assert.deepEqual(decryptMail(sample, config.email.encryptionKey, 'synthetic-job'), { text:'private' });
});

test('native mail: queue insertion failure rolls back the reset token', async () => {
  const broken = { ...db, transaction: fn => db.transaction(tx => fn({ ...tx,
    query: async (sql, values) => { if (sql.startsWith('INSERT INTO nina_mail.outbox')) throw new Error('synthetic failure'); return tx.query(sql, values); },
  })) };
  const brokenApp = createApp({ db: broken, config, migrations });
  assert.equal((await brokenApp(request('/v1/auth/forgot-password',{email:'agent@example.com'}))).status, 500);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM nina_auth.password_resets'))[0].total, 0);
});

test('native mail: configuration requires an independent encryption key before enabling', () => {
  assert.equal(readConfig(baseEnv).email.enabled, false);
  for (const overrides of [{ EMAIL_ENCRYPTION_KEY:'' }, { RESEND_API_KEY:'' },
    { EMAIL_FROM:'Nina\r\nBcc: other@example.com' }, { EMAIL_FROM:'Nina <broken@example.com' }, { EMAIL_ENABLED:'yes' }]) {
    assert.throws(() => readConfig({ ...emailEnv, ...overrides }));
  }
});
