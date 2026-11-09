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
const accountId = 'a'.repeat(24), profileId = 'b'.repeat(24), providerConversation = 'c'.repeat(24);
const origin = 'https://nina.example.test', api = 'https://api.nina.example.test';
const env = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://nina_app@localhost/nina', FRONTEND_ORIGIN: origin, API_ORIGIN: api,
  CHANNEL_PROCESSING_ENABLED: 'true', MEDIA_ENABLED: 'true', MEDIA_STORAGE_DIR: '/tmp/nina-pilot-fixture',
  ZERNIO_WEBHOOK_ENABLED: 'true', ZERNIO_ACCOUNT_ID: accountId, ZERNIO_PROFILE_ID: profileId,
  ZERNIO_WEBHOOK_SECRET: 'fixture-'.repeat(8), ZERNIO_API_KEY: 'fixture-key-'.repeat(5), EMAIL_ENCRYPTION_KEY: 'a'.repeat(64) };
const calls = [];
let pg, db, migrations, app, config, contactId, conversationId, inboundId, adminToken, staffToken, providerStatus = 200;
const provider = async (url, options) => {
  calls.push({ url, options });
  return providerStatus === 200 ? Response.json({ success: true, data: { messageId: 'wamid.fixture', conversationId: providerConversation } })
    : new Response('provider private failure', { status: providerStatus });
};
const build = current => createApp({ db, migrations, config: current, whatsappFetch: provider });

async function user(role) {
  const id = randomUUID(), token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO nina_auth.users(id,email,full_name,password_hash) VALUES($1,$2,$3,$4)',
    [id, id + '@example.test', 'Fixture', '$2b$10$' + 'a'.repeat(53)]);
  await db.query('INSERT INTO nina_auth.user_roles(user_id,role) VALUES($1,$2)', [id, role]);
  await db.query("INSERT INTO nina_auth.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [id, createHash('sha256').update(token).digest('hex')]);
  return token;
}
async function receive() {
  const now = new Date().toISOString();
  const payload = JSON.stringify({ id: randomUUID(), event: 'message.received', timestamp: now,
    account: { accountId, profileId, platform: 'whatsapp' }, conversation: { id: providerConversation, platformConversationId: 'fixture-peer' },
    message: { platform: 'whatsapp', id: randomUUID(), platformMessageId: 'wamid.' + randomUUID(), conversationId: providerConversation,
      direction: 'incoming', sentAt: now, text: 'Mensagem de teste', attachments: [], sender: { id: 'fixture-peer', phoneNumber: '+5511999990000' } } });
  const r = await app(new Request(api+'/v1/webhooks/zernio', { method: 'POST', headers: { 'content-type': 'application/json',
    'x-zernio-signature': createHmac('sha256', env.ZERNIO_WEBHOOK_SECRET).update(payload).digest('hex') }, body: payload }));
  assert.equal(r.status, 200);
  const worker = createChannelWorker({ db, config, archive: { download() { throw Error('unexpected attachment'); } } });
  assert.equal(await worker.runOnce(), true);
  await db.exec('RESET ROLE');
  try {
    const [latest] = await db.query('SELECT c.id AS contact, v.id AS conversation, m.id AS inbound FROM nina_clinic.contacts c JOIN nina_clinic.conversations v ON v.contact_id=c.id JOIN nina_clinic.messages m ON m.conversation_id=v.id ORDER BY m.sent_at DESC LIMIT 1');
    ({ contact: contactId, conversation: conversationId, inbound: inboundId } = latest);
  } finally { await db.exec('SET ROLE nina_app'); }
}
const request = (body, { token = adminToken, target = contactId, requestOrigin = origin } = {}) => new Request(api+`/v1/clinic/contacts/${target}/whatsapp-pilot`, {
  method: body === undefined ? 'GET' : 'POST', headers: { origin: requestOrigin, ...(token ? { cookie: 'nina_session='+token } : {}), 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const reply = () => ({ inbound_id: inboundId, message: '  Recebemos sua mensagem de teste.  ' });

before(async () => {
  pg = new PGlite(); db = adapter(pg); migrations = await readMigrations(); await migrate(db, migrations);
  for (const file of ['runtime-role','clinic-runtime-role','clinic-write-role','zernio-inbox-role','channel-processing-role','whatsapp-pilot-role']) {
    await db.exec((await readFile(new URL(`../server/sql/${file}.sql`, import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));
  }
  adminToken = await user('admin'); staffToken = await user('user');
  await db.query('INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES($1,$2)',[accountId,profileId]);
  await db.exec('SET ROLE nina_app');
  config = readConfig(env); app = build(config); await receive();
  config = readConfig({ ...env, WHATSAPP_PILOT_ENABLED: 'true', WHATSAPP_PILOT_CONTACT_ID: contactId, WHATSAPP_PILOT_CONVERSATION_ID: conversationId });
  app = build(config);
});
after(async () => pg?.close());

test('disabled, unauthenticated, non-admin, foreign origin and unknown contact cannot send', async () => {
  const disabled = build(readConfig(env));
  assert.deepEqual(await (await disabled(request())).json(), { available:false, status:null });
  assert.equal((await disabled(request(reply()))).status,409);
  assert.equal((await app(request(reply(),{token:null}))).status,401);
  assert.equal((await app(request(reply(),{token:staffToken}))).status,409);
  assert.equal((await app(request(reply(),{target:randomUUID()}))).status,409);
  assert.equal((await app(request(reply(),{requestOrigin:'https://other.example.test'}))).status,403);
  assert.equal((await app(request({ ...reply(), to: 'other' }))).status,400);
  assert.equal(calls.length,0);
});

test('admin can send once through the signed WhatsApp route; reload and concurrent requests do not duplicate it', async () => {
  assert.deepEqual(await (await app(request())).json(), { available:true, status:null, inbound_id:inboundId });
  await Promise.all([app(request(reply())), app(request(reply()))]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,`https://zernio.com/api/v1/inbox/conversations/${providerConversation}/messages`);
  assert.equal(calls[0].options.redirect,'error');
  assert.match(calls[0].options.headers['idempotency-key'],/^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(calls[0].options.body),{ accountId, message:'Recebemos sua mensagem de teste.' });
  assert.deepEqual(await (await app(request())).json(),{ available:false, status:'accepted' });
  assert.deepEqual(await (await app(request(reply()))).json(),{ available:false, status:'accepted' });
  assert.equal(calls.length,1);
});

test('stale inbound id cannot trigger a send and an ambiguous provider response is never retried', async () => {
  const previous = reply(); await receive();
  assert.notEqual(inboundId, previous.inbound_id);
  assert.equal((await app(request(previous))).status,409);
  providerStatus = 500;
  assert.deepEqual(await (await app(request(reply()))).json(),{ available:false, status:'uncertain' });
  assert.deepEqual(await (await app(request(reply()))).json(),{ available:false, status:'uncertain' });
  assert.equal(calls.length,2);
});

test('expired window and an ambiguous provider link are blocked before reservation', async () => {
  await db.exec('RESET ROLE');
  await db.query("UPDATE nina_clinic.messages SET sent_at=now()-interval '25 hours'");
  await db.exec('SET ROLE nina_app');
  assert.deepEqual(await (await app(request())).json(),{ available:false, status:null });
  assert.equal((await app(request(reply()))).status,409);
  await receive();
  await db.exec('RESET ROLE');
  await db.query("INSERT INTO nina_channels.conversation_links VALUES ($1,'internal',$2,$3)",[accountId,'d'.repeat(24),conversationId]);
  await db.exec('SET ROLE nina_app');
  assert.equal((await app(request(reply()))).status,409);
  assert.equal(calls.length,2);
});
