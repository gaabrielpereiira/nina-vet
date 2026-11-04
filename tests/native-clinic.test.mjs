import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/src/app.mjs';
import { readConfig } from '../server/src/config.mjs';
import { migrate, readMigrations } from '../server/src/migrations.mjs';

const config = readConfig({ NODE_ENV: 'production', API_ORIGIN: 'https://api.nina.example.com',
  FRONTEND_ORIGIN: 'https://nina.example.com', DATABASE_URL: 'postgresql://nina_app:synthetic@localhost/nina' });
const userId = randomUUID(), first = randomUUID(), second = randomUUID(), animalId = randomUUID(), procedureId = randomUUID();
const conversationId = randomUUID(), oldConversationId = randomUUID();
const token = 'x'.repeat(43);
let pg, db, app;
function adapter(engine) {
  return { query: async (sql, values = []) => (await engine.query(sql, values)).rows,
    exec: sql => engine.exec(sql), transaction: fn => engine.transaction(tx => fn(adapter(tx))) };
}
function request(path, { authenticated = true, method = 'GET', origin = config.frontendOrigin } = {}) {
  return new Request(config.apiOrigin + path, { method, headers: {
    origin, ...(authenticated ? { cookie: config.cookieName + '=' + token } : {}),
  } });
}
before(async () => {
  pg = new PGlite(); db = adapter(pg);
  const migrations = await readMigrations(); await migrate(db, migrations);
  // Match the existing native API harness: PGlite cannot grant on template1.
  await db.exec((await readFile(new URL('../server/sql/runtime-role.sql', import.meta.url), 'utf8'))
    .replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
  await db.exec(await readFile(new URL('../server/sql/clinic-runtime-role.sql', import.meta.url), 'utf8'));
  app = createApp({ db, config, migrations });
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE nina_clinic.contacts, nina_clinic.animals,
    nina_clinic.procedures, nina_clinic.appointments, nina_clinic.conversations,
    nina_clinic.messages, nina_auth.users, nina_auth.user_roles, nina_auth.sessions CASCADE;`);
  await db.query('INSERT INTO nina_auth.users (id,email) VALUES ($1,$2)', [userId, 'staff@example.com']);
  await db.query('INSERT INTO nina_auth.user_roles VALUES ($1,$2)', [userId, 'user']);
  await db.query("INSERT INTO nina_auth.sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
    [createHash('sha256').update(token).digest('hex'), userId]);
  await db.query(`INSERT INTO nina_clinic.contacts (id,name,phone_number,email,client_memory,created_at)
    VALUES ($1,'Tutor A','551100000001','tutor@example.com','{"private":"DO_NOT_EXPOSE"}', '2026-10-22'),
    ($2,'Tutor B','551100000002',NULL,'{}','2026-10-21')`, [first, second]);
  await db.query("INSERT INTO nina_clinic.animals (id,contact_id,name,birth_date,notes) VALUES ($1,$2,'Pet A','2020-03-01','Histórico preservado')", [animalId, first]);
  await db.query("INSERT INTO nina_clinic.procedures (id,name) VALUES ($1,'Consulta')", [procedureId]);
  await db.query(`INSERT INTO nina_clinic.appointments (id,title,date,time,contact_id,animal_id,procedure_id)
    VALUES ($1,'Retorno','2026-10-22','09:30',$2,$3,$4)`, [randomUUID(), first, animalId, procedureId]);
  await db.query(`INSERT INTO nina_clinic.conversations (id,contact_id,last_message_at)
    VALUES ($1,$2,'2026-10-22'), ($3,$2,'2026-10-20')`, [conversationId, first, oldConversationId]);
  await db.query(`INSERT INTO nina_clinic.messages (id,conversation_id,from_type,content,sent_at,created_at)
    VALUES ($1,$2,'user','Recente','2026-10-22','2026-10-20'), ($3,$4,'human','Anterior','2026-10-20','2026-10-22')`,
  [randomUUID(), conversationId, randomUUID(), oldConversationId]);
  await db.exec('SET ROLE nina_app');
});
after(async () => { await pg?.close(); });

test('clinic: every read requires a live native session and allowed origin', async () => {
  for (const path of ['/contacts', '/procedures', '/appointments', `/contacts/${first}/animals`, `/contacts/${first}/messages`]) {
    assert.equal((await app(request('/v1/clinic' + path, { authenticated: false }))).status, 401);
    assert.equal((await app(request('/v1/clinic' + path, { origin: 'https://evil.example' }))).status, 403);
  }
  await db.exec('RESET ROLE; UPDATE nina_auth.users SET disabled_at = now(); SET ROLE nina_app;');
  assert.equal((await app(request('/v1/clinic/contacts'))).status, 401);
});

test('clinic: shared staff scope matches the source without exposing private metadata', async () => {
  const response = await app(request('/v1/clinic/contacts'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 2); assert.equal(body.next_offset, null);
  assert.ok(!JSON.stringify(body).includes('DO_NOT_EXPOSE'));
  assert.ok(!('user_id' in body.data[0]));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('clinic: pagination is bounded and literal search cannot become SQL or wildcards', async () => {
  const firstPage = await (await app(request('/v1/clinic/contacts?limit=1'))).json();
  const secondPage = await (await app(request('/v1/clinic/contacts?limit=1&offset=1'))).json();
  assert.equal(firstPage.data[0].id, first); assert.equal(firstPage.next_offset, 1);
  assert.equal(secondPage.data[0].id, second); assert.equal(secondPage.next_offset, null);
  for (const q of ["' OR true;--", '%', '_']) {
    const response = await app(request('/v1/clinic/contacts?q=' + encodeURIComponent(q)));
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, []);
  }
  const found = await (await app(request('/v1/clinic/contacts?q=TUTOR%20A'))).json();
  assert.equal(found.data[0].id, first);
});

test('clinic: contact history retains animal, procedure and all conversation links', async () => {
  const pet = await (await app(request(`/v1/clinic/contacts/${first}/animals`))).json();
  assert.equal(pet.data[0].id, animalId); assert.equal(pet.data[0].birth_date, '2020-03-01');
  assert.equal(pet.data[0].notes, 'Histórico preservado');
  const visits = await (await app(request(`/v1/clinic/contacts/${first}/appointments`))).json();
  assert.equal(visits.data[0].procedure_name, 'Consulta'); assert.equal(visits.data[0].animal_name, 'Pet A');
  assert.equal(visits.data[0].date, '2026-10-22'); assert.equal(visits.data[0].time, '09:30:00');
  const history = await (await app(request(`/v1/clinic/contacts/${first}/messages`))).json();
  assert.deepEqual(history.data.map(m => m.content), ['Recente', 'Anterior']);
  assert.deepEqual((await (await app(request(`/v1/clinic/contacts/${second}/animals`))).json()).data, []);
  assert.equal((await app(request('/v1/clinic/contacts/' + randomUUID()))).status, 404);
});

test('clinic: invalid filters fail without leaving an identity on the pooled connection', async () => {
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'limit=1&limit=2', 'user_id=' + userId, 'q=' + 'x'.repeat(121)]) {
    assert.equal((await app(request('/v1/clinic/contacts?' + query))).status, 400, query);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n, 0);
  }
  for (const query of ['from=2026-02-30', 'from=0000-01-01', 'from=invalid', 'from=2026-10-23&to=2026-10-22']) {
    assert.equal((await app(request('/v1/clinic/appointments?' + query))).status, 400);
  }
  assert.equal((await app(request('/v1/clinic/contacts/not-a-uuid/animals'))).status, 400);
  assert.equal((await app(request('/v1/clinic/contacts'))).status, 200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n, 0);
});

test('clinic: dates filter appointments and unknown routes cannot expose other tables', async () => {
  const empty = await (await app(request('/v1/clinic/appointments?from=2026-10-23'))).json();
  assert.deepEqual(empty.data, []);
  const result = await (await app(request('/v1/clinic/appointments?from=2026-10-22&to=2026-10-22'))).json();
  assert.equal(result.data.length, 1);
  const procedures = await (await app(request('/v1/clinic/procedures?q=consulta'))).json();
  assert.equal(procedures.data[0].id, procedureId);
  assert.equal((await app(request('/v1/clinic/nina_settings'))).status, 404);
  assert.equal((await app(request('/v1/clinic/contacts', { method: 'POST' }))).status, 415);
});

test('clinic: RLS denies missing, unassigned and disabled identities, including direct SQL', async () => {
  assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n, 0);
  for (const change of ['DELETE FROM nina_auth.user_roles', 'UPDATE nina_auth.users SET disabled_at = now()']) {
    await db.exec('RESET ROLE; ' + change + '; SET ROLE nina_app;');
    await db.transaction(async tx => {
      await tx.query("SELECT set_config('nina.user_id',$1,true)", [userId]);
      assert.equal((await tx.query('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n, 0);
    });
    assert.equal((await app(request('/v1/clinic/contacts'))).status, 401);
  }
});

test('clinic: API runtime cannot mutate history, import data or own the clinic schema', async () => {
  for (const sql of ['DELETE FROM nina_clinic.contacts', "UPDATE nina_clinic.contacts SET name='wrong'",
    "INSERT INTO nina_clinic.contacts(phone_number) VALUES ('0')", 'CREATE TABLE nina_clinic.rogue(id int)',
    'INSERT INTO nina_meta.data_imports VALUES (repeat(\'a\',64), now(), \'{}\')']) {
    await assert.rejects(db.exec(sql), /permission denied/);
  }
});
