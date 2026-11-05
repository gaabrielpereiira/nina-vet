import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { readConfig } from '../server/src/config.mjs';
import { createApp } from '../server/src/app.mjs';
import { migrate, readMigrations } from '../server/src/migrations.mjs';

const config = readConfig({ NODE_ENV: 'production', API_ORIGIN: 'https://api.nina.example.com', FRONTEND_ORIGIN: 'https://nina.example.com',
  DATABASE_URL: 'postgresql://nina_app:synthetic@localhost/nina', AI_TESTS_ENABLED: 'true', GEMINI_API_KEY: 'SYNTHETIC_GEMINI_KEY_NOT_REAL' });
const admin = randomUUID(), staff = randomUUID(), token = 'a'.repeat(43), staffToken = 'b'.repeat(43);
let pg, db, migrations, app, calls;
const adapter = engine => ({ query: async (sql, params = []) => (await engine.query(sql, params)).rows,
  exec: sql => engine.exec(sql), transaction: fn => engine.transaction(tx => fn(adapter(tx))) });
function request(body, { who = token, origin = config.frontendOrigin, path = '/v1/ai/rehearsals' } = {}) {
  return new Request(config.apiOrigin + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(who ? { cookie: '__Host-nina_session=' + who } : {}), ...(origin ? { origin } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
before(async () => {
  pg = new PGlite(); db = adapter(pg); migrations = await readMigrations(); await migrate(db, migrations);
  await db.exec((await readFile(new URL('../server/sql/runtime-role.sql', import.meta.url), 'utf8')).replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
});
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE nina_auth.sessions,nina_auth.user_roles,nina_auth.users,nina_auth.login_windows CASCADE;');
  for (const [id, role, raw] of [[admin, 'admin', token], [staff, 'user', staffToken]]) {
    await db.query('INSERT INTO nina_auth.users(id,email,full_name) VALUES($1,$2,$3)', [id, id + '@example.com', 'Fictional']);
    await db.query('INSERT INTO nina_auth.user_roles VALUES($1,$2)', [id, role]);
    await db.query("INSERT INTO nina_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [createHash('sha256').update(raw).digest('hex'), id]);
  }
  await db.exec('SET ROLE nina_app'); calls = [];
  app = createApp({ db, config, migrations, aiFetch: async (url, options) => {
    calls.push({ url, options }); return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Resposta fictícia para revisão.' }] } }] });
  } });
});
after(async () => { await pg?.close(); });
test('native rehearsals: anonymous, staff, removed role and revoked session cannot invoke', async () => {
  for (const body of [undefined, { case_id: 'contexto' }]) {
    assert.equal((await app(request(body, { who: null }))).status, 401);
    assert.equal((await app(request(body, { who: staffToken }))).status, 403);
  }
  await db.exec('RESET ROLE'); await db.query("UPDATE nina_auth.user_roles SET role='user' WHERE user_id=$1", [admin]); await db.exec('SET ROLE nina_app');
  assert.equal((await app(request({ case_id: 'contexto' }))).status, 403);
  await db.exec('RESET ROLE; DELETE FROM nina_auth.sessions; SET ROLE nina_app');
  assert.equal((await app(request({ case_id: 'contexto' }))).status, 401); assert.equal(calls.length, 0);
});
test('native rehearsals: ten fixed fictional cases, arbitrary context, IDs and origin denied', async () => {
  const result = await (await app(request())).json(); assert.equal(result.cases.length, 10);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_GEMINI_KEY'));
  for (const body of [null, [], {}, { case_id: 'missing' }, { case_id: 'contexto', contact_id: randomUUID() },
    { case_id: 'contexto', message: 'PRIVATE' }, { case_id: 'contexto', settings: {} }, { case_id: 'contexto', model: 'other' }]) assert.equal((await app(request(body))).status, 400);
  assert.equal((await app(request({ case_id: 'contexto' }, { path: '/v1/ai/rehearsals?contact=private' }))).status, 400);
  for (const origin of [null, 'https://evil.example.com']) assert.equal((await app(request({ case_id: 'contexto' }, { origin }))).status, 403);
  assert.equal(calls.length, 0);
});
test('native rehearsals: pause/block are checked without provider, quota or clinical writes', async () => {
  for (const case_id of ['pausado', 'bloqueado', 'reagendamento_ambiguo']) {
    const response = await app(request({ case_id })); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.provider_called, false); assert.equal(result.proposed_action, null);
    assert.equal(result.clinical_writes, 0); assert.equal(result.outbound_messages, 0); assert.equal(result.model, null);
  }
  assert.equal(calls.length, 0); assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_auth.login_windows'))[0].n, 0);
});
test('native rehearsals: provider receives only fixed fictional context; no clinical DB reads', async () => {
  const response = await app(request({ case_id: 'contexto' })); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.simulated, true); assert.equal(result.provider_called, true);
  assert.equal(result.clinical_writes, 0); assert.equal(result.outbound_messages, 0); assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].options.body); assert.match(payload.contents[1].parts[0].text, /Luna/);
  assert.ok(!calls[0].options.body.includes(admin)); assert.ok(!calls[0].options.body.includes('@example.com'));
  assert.ok(!calls[0].url.includes('lovable')); assert.equal(response.headers.get('cache-control'), 'no-store');
  await assert.rejects(db.query('SELECT count(*) FROM nina_clinic.messages'), /permission denied/);
});
test('native rehearsals: paid quotas are shared with original tests, not multiplied', async () => {
  for (const path of ['/v1/ai/tests', '/v1/ai/rehearsals', '/v1/ai/tests']) {
    assert.equal((await app(request({ case_id: path.endsWith('tests') ? 'preco' : 'valor' }, { path }))).status, 200);
  }
  assert.equal((await app(request({ case_id: 'humano' }))).status, 429); assert.equal(calls.length, 3);
});
test('native rehearsals: daily limit and disabled connection prevent requests; pause check remains local', async () => {
  await db.query("INSERT INTO nina_auth.login_windows(key,window_start,attempts) VALUES('ai-test-day:global',floor(extract(epoch FROM now())/86400)::bigint,20)");
  assert.equal((await app(request({ case_id: 'contexto' }))).status, 429); assert.equal(calls.length, 0);
  const disabled = createApp({ db, config: { ...config, aiTests: { enabled: false } }, migrations, aiFetch: async () => { throw Error('must not call'); } });
  assert.equal((await disabled(request({ case_id: 'contexto' }))).status, 503);
  assert.equal((await disabled(request({ case_id: 'pausado' }))).status, 200);
});
