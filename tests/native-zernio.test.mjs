import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { request as httpRequest } from 'node:http';
import { createHttpServer } from '../server/src/http.mjs';
import { readConfig } from '../server/src/config.mjs';
import { createApp } from '../server/src/app.mjs';
import { readMigrations, migrate } from '../server/src/migrations.mjs';
import { createZernioWebhook, encryptInbox, decryptInbox, MAX_WEBHOOK_BYTES, MAX_INBOX_EVENTS } from '../server/src/zernio-webhook.mjs';

const env = { NODE_ENV: 'production', API_ORIGIN: 'https://api.nina.example.invalid',
  FRONTEND_ORIGIN: 'https://nina.example.invalid', DATABASE_URL: 'postgresql://nina_app:synthetic@localhost/nina',
  ZERNIO_WEBHOOK_ENABLED: 'true', ZERNIO_WEBHOOK_SECRET: 'synthetic-signing-secret-'.repeat(3),
  ZERNIO_ACCOUNT_ID: 'a'.repeat(24), ZERNIO_PROFILE_ID: 'b'.repeat(24), EMAIL_ENCRYPTION_KEY: '11'.repeat(32) };
const config = readConfig(env);
let pg, db, app, migrations, logs, sqlClient;
function adapter(engine) { return { query: async (sql, values = []) => (await engine.query(sql, values)).rows,
  exec: sql => engine.exec(sql), transaction: fn => engine.transaction(tx => fn(adapter(tx))) }; }
function pgAdapter(client) { return { query: (sql, values = []) => client.unsafe(sql, values),
  exec: sql => client.unsafe(sql).simple(), transaction: fn => client.begin(tx => fn(pgAdapter(tx))) }; }
function event(overrides = {}) { return { id: randomUUID(), event: 'message.received', timestamp: '2026-10-22T12:00:00Z',
  profiles: [{ id: env.ZERNIO_PROFILE_ID, externalId: null }],
  account: { accountId: env.ZERNIO_ACCOUNT_ID, id: env.ZERNIO_ACCOUNT_ID, profileId: env.ZERNIO_PROFILE_ID, platform: 'whatsapp' },
  message: { id: 'synthetic-message', conversationId: 'synthetic-conversation', platform: 'whatsapp',
    platformMessageId: 'synthetic-platform-message', direction: 'incoming', text: 'CONTEUDO_FICTICIO_PRIVADO', attachments: [],
    sender: { id: 'synthetic-bsuid', businessScopedUserId: 'synthetic-bsuid' } }, ...overrides }; }
function request(payload = event(), { raw = JSON.stringify(payload), headers = {}, origin, path = '/v1/webhooks/zernio', method = 'POST', secret = config.zernio.secret } = {}) {
  return new Request(config.apiOrigin + path, { method, headers: { 'content-type': 'application/json',
    ...(origin ? { origin } : {}), 'x-zernio-signature': createHmac('sha256', secret).update(raw).digest('hex'), ...headers },
    ...(method === 'POST' ? { body: raw } : {}) });
}
async function owner(sql, args = []) { await db.exec('RESET ROLE');
  try { return await db.query(sql, args); } finally { await db.exec('SET ROLE nina_app'); } }
const count = async () => (await owner('SELECT count(*)::int AS n FROM nina_channels.zernio_inbox'))[0].n;
before(async () => {
  const socket = process.env.NINA_WEBHOOK_TEST_POSTGRES_SOCKET;
  if (socket) {
    // Isolated local test cluster only. Never accept an arbitrary connection URL.
    assert.ok(socket.startsWith('/private/tmp/nina-zernio-test-'));
    sqlClient = postgres({ host: socket, database: 'nina_zernio_test', max: 1, onnotice: () => {} });
    db = pgAdapter(sqlClient);
  } else { pg = new PGlite(); db = adapter(pg); }
  migrations = await readMigrations(); await migrate(db, migrations);
  for (const file of ['runtime-role.sql', 'clinic-runtime-role.sql', 'zernio-inbox-role.sql']) {
    const sql = await readFile(new URL('../server/sql/' + file, import.meta.url), 'utf8');
    await db.exec(sql.replace('ON DATABASE nina TO', `ON DATABASE ${socket ? 'nina_zernio_test' : 'postgres'} TO`));
  }
});
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE nina_channels.zernio_inbox; SET ROLE nina_app');
  logs = []; app = createApp({ db, config, migrations, log: value => logs.push(value) });
});
after(async () => { await pg?.close(); await sqlClient?.end(); });

test('zernio: disabled by default; enabling requires signing secret, exact scope and root encryption key', () => {
  assert.equal(readConfig({ ...env, ZERNIO_WEBHOOK_ENABLED: undefined }).zernio.enabled, false);
  for (const changes of [{ ZERNIO_WEBHOOK_ENABLED: 'yes' }, { ZERNIO_WEBHOOK_SECRET: '' }, { ZERNIO_WEBHOOK_SECRET: 'x\n'.repeat(32) },
    { ZERNIO_ACCOUNT_ID: '' }, { ZERNIO_PROFILE_ID: 'invalid' }, { EMAIL_ENCRYPTION_KEY: '' }]) assert.throws(() => readConfig({ ...env, ...changes }));
  assert.notEqual(config.zernio.encryptionKey.toString('hex'), env.EMAIL_ENCRYPTION_KEY);
  assert.deepEqual(readConfig({ ...env, EMAIL_ENABLED: 'false' }).zernio.encryptionKey, config.zernio.encryptionKey);
});
test('zernio: disabled endpoint never touches SQL even with a valid signed body', async () => {
  const disabled = createApp({ db: { ...db, transaction: () => { throw Error('SQL must not run'); } },
    config: readConfig({ ...env, ZERNIO_WEBHOOK_ENABLED: 'false' }), migrations });
  assert.equal((await disabled(request())).status, 503); assert.equal(await count(), 0);
});
test('zernio: missing, malformed and wrong HMAC fail before any database access or JSON parsing', async () => {
  for (const signature of ['', 'not-a-signature', 'a'.repeat(64), 'a'.repeat(65), 'A'.repeat(64)]) {
    assert.equal((await app(request(null, { raw: 'not json', headers: { 'x-zernio-signature': signature } }))).status, 401);
  }
  assert.equal((await app(request(event(), { secret: 'wrong-secret' }))).status, 401);
  assert.equal(await count(), 0); assert.deepEqual(logs, []);
});
test('zernio: signature binds exact bytes, including whitespace, unicode and body changes', async () => {
  const raw = JSON.stringify(event({ message: { platform: 'whatsapp', text: 'Olá 🐾' } }), null, 2);
  assert.equal((await app(request(null, { raw }))).status, 200);
  const signature = createHmac('sha256', config.zernio.secret).update(raw).digest('hex');
  assert.equal((await app(request(null, { raw: raw + '\n', headers: { 'x-zernio-signature': signature } }))).status, 401);
  assert.equal(await count(), 1);
});
test('zernio: malformed envelope, wrong content type, encoding and oversized streaming bodies are rejected', async () => {
  for (const raw of ['{', 'null', '[]', JSON.stringify(event({ id: 'not-uuid' })), JSON.stringify(event({ timestamp: 'yesterday' })), JSON.stringify(event({ test: 'true' }))]) {
    assert.equal((await app(request(null, { raw }))).status, 400);
  }
  assert.equal((await app(request(event(), { headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await app(request(event(), { headers: { 'content-encoding': 'gzip' } }))).status, 415);
  assert.equal((await app(request(event(), { headers: { 'content-length': String(MAX_WEBHOOK_BYTES + 1) } }))).status, 413);
  assert.equal((await app(request(null, { raw: 'x'.repeat(MAX_WEBHOOK_BYTES + 1) }))).status, 413);
  assert.equal(await count(), 0);
});
test('zernio: scope uses signed account and profile, rejecting missing, conflicting or foreign identities', async () => {
  for (const changes of [{ account: null }, { account: { ...event().account, accountId: 'c'.repeat(24) } },
    { account: { ...event().account, id: 'c'.repeat(24) } }, { account: { ...event().account, profileId: undefined } },
    { account: { ...event().account, profileId: 'c'.repeat(24) } }, { profiles: [] },
    { profiles: [{ id: 'c'.repeat(24) }] }]) assert.equal((await app(request(event(changes)))).status, 403);
  assert.equal((await app(request(event({ message: { platform: 'instagram' } })))).status, 400);
  assert.equal(await count(), 0);
});
test('zernio: test and unsupported events are acknowledged without clinical or inbox writes', async () => {
  for (const payload of [event({ event: 'webhook.test', account: undefined, profiles: undefined, message: 'Provider test' }),
    event({ test: true }), event({ event: 'reaction.received' })]) assert.equal((await app(request(payload))).status, 200);
  assert.equal(await count(), 0);
});
test('zernio: signed incoming event is durable, encrypted and bound to its row; private content never logged or returned', async () => {
  const payload = event(); const raw = JSON.stringify(payload);
  const response = await app(request(payload)); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'queued' });
  const [row] = await owner('SELECT * FROM nina_channels.zernio_inbox');
  assert.equal(row.status, 'pending'); assert.equal(row.event_id, payload.id);
  assert.equal(row.payload_sha256, createHash('sha256').update(raw).digest('hex'));
  assert.ok(!row.payload_encrypted.includes(payload.message.text));
  const identity = { id: row.id, accountId: row.account_id, eventId: row.event_id };
  assert.equal(decryptInbox(row.payload_encrypted, config.zernio.encryptionKey, identity).toString(), raw);
  for (const changed of [{ id: randomUUID() }, { accountId: 'c'.repeat(24) }, { eventId: randomUUID() }]) {
    assert.throws(() => decryptInbox(row.payload_encrypted, config.zernio.encryptionKey, { ...identity, ...changed }));
  }
  assert.throws(() => decryptInbox(row.payload_encrypted, Buffer.alloc(32), identity));
  const parts = row.payload_encrypted.split('.'); parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  assert.throws(() => decryptInbox(parts.join('.'), config.zernio.encryptionKey, identity));
  assert.notEqual(encryptInbox(Buffer.from(raw), config.zernio.encryptionKey, identity), row.payload_encrypted);
  assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n, 0);
  assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.messages'))[0].n, 0);
  assert.deepEqual(logs, []);
});
test('zernio: each supported delivery lifecycle event is staged without sending or advancing clinical state', async () => {
  for (const name of ['message.received', 'message.sent', 'message.delivered', 'message.read', 'message.failed']) {
    assert.equal((await app(request(event({ event: name })))).status, 200);
  }
  assert.equal(await count(), 5);
});
test('zernio: retries remain idempotent across app instances; unsigned event header cannot bypass deduplication', async () => {
  const payload = event();
  assert.equal((await app(request(payload))).status, 200);
  const secondApp = createApp({ db, config, migrations });
  const duplicate = await secondApp(request(payload, { headers: { 'x-zernio-event-id': randomUUID(), 'x-zernio-event': 'message.sent' } }));
  assert.deepEqual(await duplicate.json(), { status: 'duplicate' }); assert.equal(await count(), 1);
  assert.equal((await app(request({ ...payload, message: { ...payload.message, text: 'Changed' } }))).status, 409);
  assert.equal(await count(), 1);
});
test('zernio: receipt RLS hides other account metadata and cannot leak ciphertext, update/delete or change clinical grants', async () => {
  await app(request());
  assert.equal((await db.query('SELECT account_id FROM nina_channels.zernio_inbox')).length, 0);
  await db.transaction(async tx => {
    await tx.query("SELECT set_config('nina.webhook_account_id',$1,true)", [config.zernio.accountId]);
    assert.equal((await tx.query('SELECT event_id FROM nina_channels.zernio_inbox')).length, 1);
  });
  assert.equal((await db.query('SELECT event_id FROM nina_channels.zernio_inbox')).length, 0);
  for (const sql of ['SELECT payload_encrypted FROM nina_channels.zernio_inbox', 'SELECT * FROM nina_channels.zernio_inbox',
    'UPDATE nina_channels.zernio_inbox SET status=\'pending\'', 'DELETE FROM nina_channels.zernio_inbox',
    'TRUNCATE nina_channels.zernio_inbox', 'CREATE TABLE nina_channels.rogue(id int)',
    "INSERT INTO nina_clinic.messages(conversation_id) VALUES(null)"]) await assert.rejects(db.exec(sql), /permission denied/);
  const sql = `INSERT INTO nina_channels.zernio_inbox(id,account_id,event_id,event_type,occurred_at,payload_sha256,payload_encrypted)
    VALUES($1,$2,$3,'message.received',now(),$4,$5)`;
  const row = { id: randomUUID(), accountId: config.zernio.accountId, eventId: randomUUID() };
  await assert.rejects(db.query(sql, [row.id, row.accountId, row.eventId, 'a'.repeat(64), encryptInbox(Buffer.from('{}'), config.zernio.encryptionKey, row)]), /row-level security/);
});
test('zernio: only exact webhook route bypasses missing-origin protection; browser CORS and methods remain strict', async () => {
  for (const path of ['/v1/webhooks/zernio/', '/v1/webhooks/zernio/extra', '/v1/auth/login', '/v1/clinic/contacts']) {
    assert.equal((await app(request(event(), { path }))).status, 403);
  }
  assert.equal((await app(request(event(), { origin: 'https://untrusted.example' }))).status, 403);
  assert.equal((await app(request(event(), { method: 'GET' }))).status, 404);
  assert.equal((await app(request(event(), { method: 'DELETE' }))).status, 405);
  assert.equal(await count(), 0);
});
test('zernio: bounded queue refuses new events at capacity but still acknowledges committed retries', async () => {
  const payload = event(); await app(request(payload));
  await owner(`INSERT INTO nina_channels.zernio_inbox(id,account_id,event_id,event_type,occurred_at,payload_sha256,payload_encrypted)
    SELECT gen_random_uuid(),$1,gen_random_uuid(),'message.received',now(),repeat('a',64),$2 FROM generate_series(1,$3)`,
  [config.zernio.accountId, encryptInbox(Buffer.from('Synthetic capacity fixture'), config.zernio.encryptionKey,
    { id: randomUUID(), accountId: config.zernio.accountId, eventId: randomUUID() }), MAX_INBOX_EVENTS - 1]);
  const response = await app(request()); assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(await count(), MAX_INBOX_EVENTS);
  assert.deepEqual(await (await app(request(payload))).json(), { status: 'duplicate' });
});
test('zernio: failed persistence, unavailable lock or lost privileges never acknowledges a new event and logs no payload', async () => {
  const failure = { transaction: async () => { throw Error('PRIVATE_DATABASE_DETAILS'); } };
  const receive = createZernioWebhook(failure, config.zernio, value => logs.push(value));
  await assert.rejects(receive(request()), { status: 503 });
  assert.deepEqual(logs, [{ event: 'zernio_inbox_unavailable' }]);
  const busy = createZernioWebhook({ transaction: fn => fn({ query: async sql =>
    sql.includes('pg_try_advisory_xact_lock') ? [{ locked: false }] : [] }) }, config.zernio);
  await assert.rejects(busy(request()), { status: 503 });
  await db.exec('RESET ROLE; REVOKE INSERT(id,account_id,event_id,event_type,occurred_at,payload_sha256,payload_encrypted) ON nina_channels.zernio_inbox FROM nina_app; SET ROLE nina_app');
  try { assert.equal((await app(request())).status, 503); assert.equal(await count(), 0); }
  finally { await db.exec('RESET ROLE; GRANT INSERT(id,account_id,event_id,event_type,occurred_at,payload_sha256,payload_encrypted) ON nina_channels.zernio_inbox TO nina_app; SET ROLE nina_app'); }
});

test('zernio: actual HTTP adapter preserves raw bytes and returns bounded-body errors for chunked requests', async () => {
  const server = createHttpServer(app, config);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const send = raw => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path: '/v1/webhooks/zernio', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zernio-signature': createHmac('sha256', config.zernio.secret).update(raw).digest('hex') } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(5000, () => req.destroy(Error('HTTP test timeout'))); req.on('error', reject);
    req.write(raw.slice(0, 50)); req.end(raw.slice(50));
  });
  try {
    const raw = JSON.stringify(event({ message: { platform: 'whatsapp', text: 'Olá 🐾' } }), null, 2);
    assert.equal((await send(raw)).status, 200);
    assert.equal((await send('x'.repeat(MAX_WEBHOOK_BYTES + 1))).status, 413);
    assert.equal(await count(), 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('zernio: intake limits simultaneous database transactions to preserve staff capacity', async () => {
  let release, entered, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const receive = createZernioWebhook({ transaction: async () => {
    if (++calls === 2) entered(); await gate; return { status: 'queued' };
  } }, config.zernio);
  const pending = [receive(request()), receive(request())];
  try {
    await started;
    await assert.rejects(receive(request()), { status: 503 }); assert.equal(calls, 2);
  } finally { release(); await Promise.all(pending); }
  assert.deepEqual(await receive(request()), { status: 'queued' }); assert.equal(calls, 3);
});
