import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/src/app.mjs';
import { readConfig } from '../server/src/config.mjs';
import { createChannelWorker } from '../server/src/channel-worker.mjs';
import { migrate, readMigrations } from '../server/src/migrations.mjs';

const adapter = pg => ({ query: async (sql, args = []) => (await pg.query(sql, args)).rows,
  exec: sql => pg.exec(sql), transaction: fn => pg.transaction(tx => fn(adapter(tx))) });
const accountId = 'a'.repeat(24), profileId = 'b'.repeat(24), api = 'https://api.nina.example.test', origin = 'https://nina.example.test';
const env = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://nina_app@localhost/nina', FRONTEND_ORIGIN: origin, API_ORIGIN: api,
  CHANNEL_PROCESSING_ENABLED: 'true', MEDIA_ENABLED: 'true', MEDIA_STORAGE_DIR: '/tmp/nina-chat-fixture', ZERNIO_WEBHOOK_ENABLED: 'true',
  ZERNIO_ACCOUNT_ID: accountId, ZERNIO_PROFILE_ID: profileId, ZERNIO_WEBHOOK_SECRET: 'fixture-'.repeat(8), ZERNIO_API_KEY: 'fixture-key-'.repeat(5),
  EMAIL_ENCRYPTION_KEY: 'a'.repeat(64), WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_INBOX_WRITES_ENABLED: 'true' };
const config = readConfig(env);
let pg, db, migrations, app, ana, bia, providerId, beforeAnswer, calls = 0;
const provider = async (url) => {
  calls++;
  await beforeAnswer?.();
  return Response.json({ success: true, data: { messageId: providerId, conversationId: url.split('/').at(-2) } });
};
const owner = async (sql, args) => { await db.exec('RESET ROLE'); try { return await db.query(sql, args); } finally { await db.exec('SET ROLE nina_app'); } };
async function user(name) {
  const id = randomUUID(), token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO nina_auth.users(id,email,full_name) VALUES($1,$2,$3)', [id, id + '@example.test', name]);
  await db.query("INSERT INTO nina_auth.user_roles(user_id,role) VALUES($1,'user')", [id]);
  await db.query("INSERT INTO nina_auth.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [id, createHash('sha256').update(token).digest('hex')]);
  return token;
}
async function deliver(event) {
  const body = JSON.stringify({ id: randomUUID(), timestamp: new Date().toISOString(), account: { accountId, profileId, platform: 'whatsapp' }, ...event });
  const response = await app(new Request(api + '/v1/webhooks/zernio', { method: 'POST', body, headers: { 'content-type': 'application/json',
    'x-zernio-signature': createHmac('sha256', env.ZERNIO_WEBHOOK_SECRET).update(body).digest('hex') } }));
  assert.equal(response.status, 200);
  const worker = createChannelWorker({ db, config, archive: { download() { throw Error('unexpected attachment'); } } });
  while (await worker.runOnce());
  assert.deepEqual(await owner("SELECT last_error_code FROM nina_channels.zernio_inbox WHERE status<>'processed'"), []);
}
const conversation = n => String(n).repeat(24);
const inbound = (n, text) => deliver({ event: 'message.received', conversation: { id: conversation(n) }, message: { platform: 'whatsapp',
  platformMessageId: 'wamid.in' + randomUUID().replaceAll('-', ''), conversationId: conversation(n), direction: 'incoming', sentAt: new Date().toISOString(),
  text, attachments: [], sender: { id: 'peer-' + n, phoneNumber: '+551199990000' + n, name: 'Tutor ' + n } } });
const echo = (n, id, text) => deliver({ event: 'message.sent', conversation: { id: conversation(n) }, message: { platform: 'whatsapp', platformMessageId: id,
  conversationId: conversation(n), direction: 'outgoing', sentAt: new Date().toISOString(), text, attachments: [], sentVia: 'api' } });
const status = (kind, id) => deliver({ event: 'message.' + kind, statusAt: new Date().toISOString(), message: { platform: 'whatsapp', platformMessageId: id } });
async function call(token, path, body, handler = app) {
  const response = await handler(new Request(api + '/v1/inbox' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json',
    ...(token ? { cookie: 'nina_session=' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: response.status, body: await response.json() };
}
const list = async (token, query = '') => (await call(token, '/conversations' + query)).body.data;
const row = async (token, n) => (await list(token)).find(item => item.name === 'Tutor ' + n);
const thread = async (token, id) => (await call(token, '/conversations/' + id)).body;
const badge = async token => (await call(token, '/unread')).body.conversations;
const reply = (token, id, message, operation_id = randomUUID()) => call(token, `/conversations/${id}/reply`, { operation_id, message });
// Replies to one conversation are spaced by 3 seconds; tests move the clock instead.
const pass = () => owner("UPDATE nina_channels.inbox_replies SET created_at=created_at-interval '1 minute'");

before(async () => {
  pg = new PGlite(); db = adapter(pg); migrations = await readMigrations(); await migrate(db, migrations);
  for (const file of ['runtime-role', 'clinic-runtime-role', 'clinic-write-role', 'zernio-inbox-role', 'channel-processing-role', 'whatsapp-pilot-role',
    'staff-inbox-role', 'staff-inbox-write-role', 'chat-role', 'chat-write-role']) {
    await db.exec((await readFile(new URL(`../server/sql/${file}.sql`, import.meta.url), 'utf8')).replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
  }
  ana = await user('Ana Fictícia'); bia = await user('Bia Fictícia');
  await db.query('INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES($1,$2)', [accountId, profileId]);
  await db.exec('SET ROLE nina_app');
  app = createApp({ db, migrations, config, whatsappFetch: provider });
});
after(async () => { await pg.close(); });

test('chat: opening clears the counter for one person, a reply clears it for the team', async () => {
  assert.equal((await app(new Request(api + '/readyz'))).status, 200);
  await inbound(1, 'Oi'); await inbound(1, 'Tudo bem?');
  assert.equal((await row(ana, 1)).unread, 2);
  assert.equal((await row(ana, 1)).last_direction, 'in');
  assert.equal(await badge(ana), 1);
  const { id } = await row(ana, 1);
  const newest = (await thread(ana, id)).data[0];
  assert.deepEqual((await call(ana, `/conversations/${id}/read`, { message_id: newest.id })).body, { status: 'ok' });
  assert.equal((await row(ana, 1)).unread, 0);
  assert.equal((await row(bia, 1)).unread, 2);
  assert.deepEqual([await badge(ana), await badge(bia)], [0, 1]);
  assert.deepEqual((await list(ana, '?filter=unread')).length, 0);
  assert.deepEqual((await list(bia, '?filter=unread')).map(item => item.id), [id]);
  await inbound(1, 'Mais uma');
  assert.equal((await row(ana, 1)).unread, 1);
  // Reading an older message cannot move the position back.
  await call(ana, `/conversations/${id}/read`, { message_id: (await thread(ana, id)).data[0].id });
  await call(ana, `/conversations/${id}/read`, { message_id: newest.id });
  assert.equal((await row(ana, 1)).unread, 0);
  assert.equal((await call(ana, `/conversations/${id}/assume`, {})).status, 200);
  assert.equal(await badge(bia), 0);
  providerId = 'wamid.reply1';
  assert.deepEqual((await reply(ana, id, 'Bom dia!')).body, { status: 'accepted' });
  assert.equal((await row(bia, 1)).unread, 0);
  assert.equal((await row(bia, 1)).last_direction, 'out');
  await owner("UPDATE nina_clinic.messages SET sent_at=sent_at-interval '8 days',created_at=created_at-interval '8 days' WHERE from_type<>'user'");
  await owner("UPDATE nina_clinic.messages SET sent_at=sent_at-interval '7 days 1 hour',created_at=created_at-interval '7 days 1 hour' WHERE from_type='user'");
  assert.equal((await row(bia, 1)).unread, 0);
});

test('chat: an accepted reply is in the history at once, with its author, and the echo never duplicates it', async () => {
  await inbound(2, 'Preciso de ajuda');
  const { id } = await row(ana, 2);
  assert.equal((await call(ana, `/conversations/${id}/assume`, {})).status, 200);
  providerId = 'wamid.reply2';
  const operation = randomUUID();
  assert.deepEqual((await reply(ana, id, '  Claro!  ', operation)).body, { status: 'accepted' });
  let [latest] = (await thread(bia, id)).data;
  assert.deepEqual([latest.content, latest.from_type, latest.author, latest.status, latest.operation_id], ['Claro!', 'human', 'Ana Fictícia', 'sent', operation]);
  await echo(2, 'wamid.reply2', 'Claro!'); await status('delivered', 'wamid.reply2'); await status('read', 'wamid.reply2');
  const opened = await thread(bia, id);
  assert.equal(opened.data.filter(m => m.content === 'Claro!').length, 1);
  assert.equal(opened.data[0].status, 'read');
  assert.deepEqual((await reply(ana, id, 'Claro!', operation)).body, { status: 'accepted' });
  assert.equal((await thread(bia, id)).data.length, 2);
  assert.ok(!JSON.stringify(opened).includes(conversation(2)) && !JSON.stringify(opened).includes('wamid'));
});

test('chat: an echo and receipts that arrive before the provider answer keep a single message', async () => {
  await inbound(3, 'Olá');
  const { id } = await row(ana, 3);
  await call(ana, `/conversations/${id}/assume`, {});
  providerId = 'wamid.reply3';
  beforeAnswer = async () => { await echo(3, 'wamid.reply3', 'Resposta rápida'); };
  assert.deepEqual((await reply(ana, id, 'Resposta rápida')).body, { status: 'accepted' });
  let data = (await thread(ana, id)).data;
  assert.deepEqual(data.map(m => [m.content, m.from_type]), [['Resposta rápida', 'human'], ['Olá', 'user']]);
  await pass();
  providerId = 'wamid.reply3b';
  beforeAnswer = async () => { await status('delivered', 'wamid.reply3b'); };
  assert.deepEqual((await reply(ana, id, 'Outra')).body, { status: 'accepted' });
  data = (await thread(ana, id)).data;
  assert.deepEqual([data[0].content, data[0].status], ['Outra', 'delivered']);
  // Imported history may already hold the provider ID without a channel link.
  await pass();
  providerId = 'wamid.reply3c';
  beforeAnswer = async () => { await owner("INSERT INTO nina_clinic.messages(conversation_id,whatsapp_message_id,from_type,content) VALUES($1,'wamid.reply3c','human','Importada')", [id]); };
  assert.deepEqual((await reply(ana, id, 'Importada')).body, { status: 'accepted' });
  beforeAnswer = undefined;
  assert.equal((await thread(ana, id)).data.filter(m => m.content === 'Importada').length, 1);
});

test('chat: a reply the provider accepted but the database did not record is uncertain, never "not sent"', async () => {
  const { id } = await row(ana, 3), before = calls;
  await pass();
  providerId = 'wamid.unrecorded';
  const finish = allowed => owner(`${allowed ? 'GRANT' : 'REVOKE'} EXECUTE ON FUNCTION nina_channels.staff_chat_finish(text,text,uuid,uuid,text,text,text) ${allowed ? 'TO' : 'FROM'} nina_app`);
  beforeAnswer = () => finish(false);
  const operation = randomUUID();
  assert.deepEqual((await reply(ana, id, 'Saiu mesmo assim', operation)).body, { status: 'uncertain' });
  beforeAnswer = undefined;
  await finish(true);
  assert.deepEqual((await reply(ana, id, 'Saiu mesmo assim', operation)).body, { status: 'sending' });
  assert.equal(calls, before + 1);
  await echo(3, 'wamid.unrecorded', 'Saiu mesmo assim');
  assert.equal((await thread(ana, id)).data.filter(m => m.content === 'Saiu mesmo assim').length, 1);
});

test('chat: only the owner replies; length and positions are validated; nothing is sent on refusal', async () => {
  const { id } = await row(ana, 3);
  await pass();
  const sent = calls;
  assert.equal((await reply(bia, id, 'Sou outra pessoa')).body.error.code, 'INBOX_OWNERSHIP');
  assert.equal((await call(bia, `/conversations/${id}/assume`, {})).body.error.code, 'INBOX_OWNERSHIP');
  assert.equal((await reply(ana, id, 'x'.repeat(4001))).status, 400);
  assert.equal(calls, sent);
  providerId = 'wamid.long';
  assert.deepEqual((await reply(ana, id, 'x'.repeat(4000))).body, { status: 'accepted' });
  assert.equal((await reply(ana, id, 'cedo demais')).body.error.code, 'INBOX_BUSY');
  assert.equal(calls, sent + 1);
  const other = (await row(ana, 2)).id;
  const foreign = (await thread(ana, other)).data[0].id;
  assert.equal((await call(ana, `/conversations/${id}/read`, { message_id: foreign })).status, 404);
  assert.equal((await call(ana, `/conversations/${id}/read`, { message_id: 'x' })).status, 400);
  assert.equal((await call(ana, `/conversations/${id}/read`, { message_id: foreign, at: '2030-01-01' })).status, 400);
  assert.equal((await call(null, '/unread')).status, 401);
  assert.equal((await call(null, `/conversations/${id}/read`, { message_id: foreign })).status, 401);
  assert.equal((await call(ana, '/conversations?filter=archived')).status, 400);
});

test('chat: search finds formatted phone numbers and full names', async () => {
  assert.deepEqual((await list(ana, '?q=' + encodeURIComponent('(11) 99990-0002'))).map(i => i.name), ['Tutor 2']);
  assert.deepEqual((await list(ana, '?q=tutor%203')).map(i => i.name), ['Tutor 3']);
});

test('chat: read-only mode moves the read position but cannot assume, release or reply', async () => {
  await inbound(2, 'Mais uma dúvida');
  const handler = createApp({ db, migrations, config: readConfig({ ...env, WHATSAPP_INBOX_WRITES_ENABLED: 'false' }), whatsappFetch: provider });
  const { id } = await row(ana, 2), sent = calls;
  assert.equal((await call(ana, `/conversations/${id}/read`, { message_id: (await thread(ana, id)).data[0].id }, handler)).status, 200);
  assert.equal((await row(ana, 2)).unread, 0);
  for (const action of ['assume', 'release']) assert.equal((await call(ana, `/conversations/${id}/${action}`, {}, handler)).body.error.code, 'INBOX_DISABLED');
  assert.equal((await call(ana, `/conversations/${id}/reply`, { operation_id: randomUUID(), message: 'não' }, handler)).body.error.code, 'INBOX_DISABLED');
  assert.equal(calls, sent);
  const off = createApp({ db, migrations, config: readConfig({ ...env, WHATSAPP_INBOX_ENABLED: 'false', WHATSAPP_INBOX_WRITES_ENABLED: 'false' }) });
  assert.deepEqual((await call(ana, '/unread', undefined, off)).body, { enabled: false, conversations: 0 });
});

test('chat: the API role only reaches positions and history through the checked functions', async () => {
  for (const sql of ['SELECT * FROM nina_channels.inbox_reads', "UPDATE nina_channels.inbox_reads SET read_at=now()", 'DELETE FROM nina_channels.inbox_reads',
    'SELECT nina_channels.inbox_unread(gen_random_uuid())', "INSERT INTO nina_clinic.messages(conversation_id,from_type) VALUES(gen_random_uuid(),'human')"]) {
    await assert.rejects(db.exec(sql), /permission denied|row-level security/);
  }
  // Without a signed-in person in the transaction there is nothing to list or move.
  assert.deepEqual(await db.query("SELECT * FROM nina_channels.staff_chat_list($1,$2,'all','',0)", [accountId, profileId]), []);
  assert.equal((await db.query('SELECT nina_channels.staff_chat_unread($1,$2) n', [accountId, profileId]))[0].n, 0);
  assert.equal((await db.query('SELECT nina_channels.staff_chat_read($1,$2,gen_random_uuid(),gen_random_uuid()) s', [accountId, profileId]))[0].s, 'denied');
  assert.equal((await db.query("SELECT nina_channels.staff_chat_finish($1,$2,gen_random_uuid(),gen_random_uuid(),'accepted','wamid.x','x') ok", [accountId, profileId]))[0].ok, false);
});

test('chat: a missing migration or grant disables only the chat and recovers without a restart', async () => {
  const isolated = new PGlite(), staged = adapter(isolated);
  try {
    await migrate(staged, migrations.slice(0, 9));
    const sql = async (...names) => { await staged.exec('RESET ROLE'); for (const name of names) await staged.exec((await readFile(new URL(`../server/${name}.sql`, import.meta.url), 'utf8')).replace('ON DATABASE nina TO', 'ON DATABASE postgres TO')); await staged.exec('SET ROLE nina_app'); };
    await sql('sql/runtime-role', 'sql/clinic-runtime-role', 'sql/clinic-write-role', 'sql/zernio-inbox-role', 'sql/channel-processing-role', 'sql/staff-inbox-role', 'sql/staff-inbox-write-role');
    await staged.exec('RESET ROLE');
    const token = randomBytes(32).toString('base64url'), id = randomUUID();
    await staged.query("INSERT INTO nina_auth.users(id,email) VALUES($1,'x@example.test')", [id]);
    await staged.query("INSERT INTO nina_auth.user_roles(user_id,role) VALUES($1,'user')", [id]);
    await staged.query("INSERT INTO nina_auth.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [id, createHash('sha256').update(token).digest('hex')]);
    await staged.query('INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES($1,$2)', [accountId, profileId]);
    await staged.exec('SET ROLE nina_app');
    let sends = 0;
    const handler = createApp({ db: staged, migrations, config, whatsappFetch: async () => { sends++; return new Response('{}', { status: 500 }); } });
    const state = async () => { const { body } = await call(token, '/conversations', undefined, handler); return [(await handler(new Request(api + '/readyz'))).status, body.enabled, body.writable]; };
    const send = async () => (await call(token, `/conversations/${randomUUID()}/reply`, { operation_id: randomUUID(), message: 'oi' }, handler)).body.error.code;
    assert.deepEqual(await state(), [200, false, false]);
    assert.deepEqual((await call(token, '/unread', undefined, handler)).body, { enabled: false, conversations: 0 });
    assert.equal(await send(), 'INBOX_DISABLED');
    await staged.exec('RESET ROLE'); await migrate(staged, migrations); await staged.exec('SET ROLE nina_app');
    assert.deepEqual(await state(), [200, false, false]);
    await sql('sql/chat-role');
    assert.deepEqual(await state(), [200, true, false]);
    assert.equal(await send(), 'INBOX_DISABLED');
    await sql('sql/chat-write-role');
    assert.deepEqual(await state(), [200, true, true]);
    assert.equal(await send(), 'NOT_FOUND');
    // An emergency revoke closes sending at once, without publishing or restarting.
    await staged.exec(`RESET ROLE; REVOKE EXECUTE ON FUNCTION nina_channels.staff_inbox_reserve(text,text,uuid,uuid,text) FROM nina_app; SET ROLE nina_app`);
    assert.equal(await send(), 'INBOX_DISABLED');
    assert.deepEqual(await state(), [200, true, false]);
    assert.equal(sends, 0);
  } finally { await isolated.close(); }
});

test('chat: the worker drains a burst without waiting between events', async () => {
  const handled = [];
  const worker = createChannelWorker({ config: { ...config, channelProcessing: { enabled: true, pollMilliseconds: 60000 } }, archive: null, db: { query: async sql => {
    if (sql.includes('claim_job')) return [{ job: handled.length < 5 ? (handled.push(1), { id: randomUUID(), account_id: accountId, event_id: randomUUID(), payload_encrypted: 'x' }) : null }];
    return [{ ok: true }];
  } } });
  worker.start();
  await new Promise(resolve => setTimeout(resolve, 400));
  await worker.stop();
  assert.equal(handled.length, 5);
});
