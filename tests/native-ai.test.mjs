import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { readConfig } from '../server/src/config.mjs';
import { createApp } from '../server/src/app.mjs';
import { migrate, readMigrations } from '../server/src/migrations.mjs';
import { createGeminiTestProvider } from '../server/src/ai-tests.mjs';

const env = { NODE_ENV: 'production', API_ORIGIN: 'https://api.nina.example.com', FRONTEND_ORIGIN: 'https://nina.example.com',
  DATABASE_URL: 'postgresql://nina_app:synthetic@localhost/nina', AI_TESTS_ENABLED: 'true', GEMINI_API_KEY: 'SYNTHETIC_GEMINI_KEY_NOT_REAL' };
const config = readConfig(env), admin = randomUUID(), staff = randomUUID();
const token = 'a'.repeat(43), staffToken = 'b'.repeat(43), cookie = '__Host-nina_session=' + token;
const reply = 'Olá! Qual é o nome do tutor e do animal? A equipe confirmará a disponibilidade.';
const generated = (text = reply, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
let pg, db, migrations, app, calls, logs;
function adapter(engine) { return { query: async (sql, params = []) => (await engine.query(sql, params)).rows,
  exec: sql => engine.exec(sql), transaction: fn => engine.transaction(tx => fn(adapter(tx))) }; }
function request(body, { who = cookie, origin = config.frontendOrigin, path = '/v1/ai/tests' } = {}) {
  return new Request(config.apiOrigin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(who ? { cookie: who } : {}), ...(origin ? { origin } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const makeApp = (overrides = {}) => createApp({ db, config, migrations, log: entry => logs.push(entry),
  aiFetch: async (url, options) => { calls.push({ url, options }); return Response.json(generated()); }, ...overrides });
before(async () => {
  pg = new PGlite(); db = adapter(pg); migrations = await readMigrations(); await migrate(db, migrations);
  await db.exec((await readFile(new URL('../server/sql/runtime-role.sql', import.meta.url), 'utf8')).replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
});
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE nina_auth.sessions,nina_auth.user_roles,nina_auth.users,nina_auth.login_windows CASCADE;');
  for (const [id, role, raw] of [[admin,'admin',token],[staff,'user',staffToken]]) {
    await db.query('INSERT INTO nina_auth.users(id,email,full_name) VALUES($1,$2,$3)', [id, id+'@example.com', 'Pessoa fictícia']);
    await db.query('INSERT INTO nina_auth.user_roles VALUES($1,$2)', [id,role]);
    await db.query("INSERT INTO nina_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(raw).digest('hex'),id]);
  }
  await db.exec('SET ROLE nina_app'); calls=[]; logs=[]; app=makeApp();
});
after(async () => { await pg?.close(); });
test('native AI: anonymous and staff cannot read examples or invoke the provider', async () => {
  for (const body of [undefined,{case_id:'agendamento'}]) {
    assert.equal((await app(request(body,{who:null}))).status,401);
    assert.equal((await app(request(body,{who:'__Host-nina_session='+staffToken}))).status,403);
  }
  assert.equal(calls.length,0);
});
test('native AI: role, disabled account and expired session are rechecked', async () => {
  await db.exec('RESET ROLE'); await db.query("UPDATE nina_auth.user_roles SET role='user' WHERE user_id=$1",[admin]); await db.exec('SET ROLE nina_app');
  assert.equal((await app(request({case_id:'agendamento'}))).status,403);
  await db.exec('RESET ROLE'); await db.query('UPDATE nina_auth.users SET disabled_at=now() WHERE id=$1',[admin]); await db.exec('SET ROLE nina_app');
  assert.equal((await app(request({case_id:'agendamento'}))).status,401);
  await db.exec("RESET ROLE; UPDATE nina_auth.users SET disabled_at=NULL; UPDATE nina_auth.sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'; SET ROLE nina_app");
  assert.equal((await app(request({case_id:'agendamento'}))).status,401); assert.equal(calls.length,0);
});
test('native AI: default disabled mode exposes examples without the secret', async () => {
  const disabled=makeApp({config:readConfig({...env,AI_TESTS_ENABLED:undefined})});
  const response=await disabled(request()); assert.equal(response.status,200); const body=await response.json();
  assert.equal(body.enabled,false); assert.equal(body.cases.length,3); assert.ok(!JSON.stringify(body).includes(env.GEMINI_API_KEY));
  assert.equal((await disabled(request({case_id:'agendamento'}))).status,503); assert.equal(calls.length,0);
});
test('native AI: client text, clinical IDs, model and endpoint cannot be transmitted', async () => {
  for(const body of [null,[],{},{case_id:'missing'},{case_id:'preco',message:'private patient'},
    {case_id:'preco',contact_id:randomUUID()},{case_id:'preco',model:'other'},{case_id:'preco',url:'https://evil.example.com'}]) {
    assert.equal((await app(request(body))).status,400);
  }
  assert.equal((await app(request({case_id:'preco'},{path:'/v1/ai/tests?message=private'}))).status,400);
  assert.equal(calls.length,0); assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_auth.login_windows'))[0].n,0);
});
test('native AI: exact frontend origin is required for provider requests', async () => {
  for(const origin of [null,'https://foreign.example.com']) assert.equal((await app(request({case_id:'preco'},{origin}))).status,403);
  assert.equal(calls.length,0);
});
test('native AI: only one fixed prompt is sent, with header key, output cap and no redirects', async () => {
  const response=await app(request({case_id:'agendamento'})); assert.equal(response.status,200); const result=await response.json();
  assert.equal(result.reply,reply); assert.equal(result.case_id,'agendamento'); assert.equal(calls.length,1);
  const {url,options}=calls[0]; assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(options.headers['x-goog-api-key'],env.GEMINI_API_KEY); assert.equal(options.redirect,'error'); assert.ok(!url.includes(env.GEMINI_API_KEY));
  const payload=JSON.parse(options.body); assert.equal(payload.generationConfig.maxOutputTokens,512); assert.equal(payload.generationConfig.candidateCount,1);
  const scenario=(await (await app(request())).json()).cases.find(c=>c.id==='agendamento');
  assert.deepEqual(payload.contents,[{role:'user',parts:[{text:scenario.message}]}]); assert.ok(!options.body.includes(admin)); assert.ok(!options.body.includes('@example.com'));
  assert.equal(result.model,'gemini-3.5-flash-lite'); assert.ok(result.elapsed_ms>=0); assert.equal(response.headers.get('cache-control'),'no-store'); assert.deepEqual(logs,[]);
  await assert.rejects(db.query('SELECT count(*) FROM nina_clinic.messages'),/permission denied/);
});
test('native AI: minute quota persists across app recreation', async () => {
  for(let i=0;i<3;i++) assert.equal((await app(request({case_id:'preco'}))).status,200);
  app=makeApp(); const response=await app(request({case_id:'preco'})); assert.equal(response.status,429); assert.ok(Number(response.headers.get('retry-after'))>0); assert.equal(calls.length,3);
});
test('native AI: daily clinic quota independently prevents provider requests', async () => {
  await db.query("INSERT INTO nina_auth.login_windows(key,window_start,attempts) VALUES('ai-test-day:global',floor(extract(epoch FROM now())/86400)::bigint,20)");
  assert.equal((await app(request({case_id:'preco'}))).status,429); assert.equal(calls.length,0);
});
test('native AI: failed provider requests count toward quota without leaking diagnostics', async () => {
  let attempts=0; app=makeApp({aiFetch:async()=>{attempts++;return new Response(env.GEMINI_API_KEY+' private diagnostics',{status:403});}});
  for(let i=0;i<3;i++) {const response=await app(request({case_id:'preco'})); assert.equal(response.status,503);assert.ok(!(await response.text()).includes(env.GEMINI_API_KEY));}
  assert.equal((await app(request({case_id:'preco'}))).status,429); assert.equal(attempts,3); assert.deepEqual(logs,[]);
});
test('native AI: invalid configuration fails closed while disabled mode needs no key',()=>{
  assert.equal(readConfig({...env,AI_TESTS_ENABLED:undefined,GEMINI_API_KEY:undefined}).aiTests.enabled,false);
  for(const options of [{AI_TESTS_ENABLED:'1'},{GEMINI_API_KEY:'bad key'},{GEMINI_API_KEY:undefined}]) assert.throws(()=>readConfig({...env,...options}));
});
test('native AI provider: incomplete, blocked, malformed, tool and oversized answers fail closed',async()=>{
  for(const data of [generated('cut short','MAX_TOKENS'),generated(''),{}, {promptFeedback:{blockReason:'SAFETY'},...generated()},
    {candidates:[{finishReason:'STOP',content:{parts:[{functionCall:{name:'send_message'}}]}}]},generated('x'.repeat(6001)),generated('bad\u0000content')]) {
    await assert.rejects(createGeminiTestProvider(config.aiTests,async()=>Response.json(data))({message:'Fictional example'}),{code:'AI_INVALID_RESPONSE'});
  }
  for(const response of [new Response('invalid json'),new Response('x'.repeat(65537)),new Response('{}',{headers:{'content-length':'65537'}})]) {
    await assert.rejects(createGeminiTestProvider(config.aiTests,async()=>response)({message:'Fictional example'}),{code:'AI_INVALID_RESPONSE'});
  }
});
test('native AI provider: thought parts are omitted and text is returned inert',async()=>{
  const data={candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'PRIVATE_THOUGHT'},{text:'<script>alert(1)</script>'}]}}]};
  assert.equal((await createGeminiTestProvider(config.aiTests,async()=>Response.json(data))({message:'Fictional example'})).reply,'<script>alert(1)</script>');
});
test('native AI provider: provider quota, network and timeouts are sanitized without retries',async()=>{
  let attempts=0; const limited=createGeminiTestProvider(config.aiTests,async()=>{attempts++;return new Response('private',{status:429});});
  await assert.rejects(limited({message:'fictional'}),{code:'AI_PROVIDER_LIMIT'}); assert.equal(attempts,1);
  await assert.rejects(createGeminiTestProvider(config.aiTests,async()=>{throw new Error(env.GEMINI_API_KEY);})({message:'fictional'}),{code:'AI_UNAVAILABLE'});
  const timed=createGeminiTestProvider(config.aiTests,async(_url,options)=>{
    await new Promise(resolve=>{const keep=setTimeout(resolve,100);options.signal.addEventListener('abort',()=>{clearTimeout(keep);resolve();},{once:true});});options.signal.throwIfAborted();
  },5);
  await assert.rejects(timed({message:'fictional'}),{code:'AI_UNAVAILABLE'});
});
