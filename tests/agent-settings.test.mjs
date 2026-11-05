import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateAgentSettings } from '../server/src/agent-settings.mjs';
import { prepareAgentSettingsImport } from '../server/scripts/prepare-agent-settings.mjs';
import { readMigrations, migrate } from '../server/src/migrations.mjs';
import { createApp } from '../server/src/app.mjs';
import { readConfig } from '../server/src/config.mjs';
import { fictionalSettings } from './support/agent-settings-fixture.mjs';

const env = { NODE_ENV: 'production', API_ORIGIN: 'https://api.nina.example.com', FRONTEND_ORIGIN: 'https://nina.example.com', DATABASE_URL: 'postgresql://nina_app:synthetic@localhost/nina' };
const config = readConfig(env), admin = randomUUID(), staff = randomUUID(), token = 'x'.repeat(43), staffToken = 'y'.repeat(43);
const adapter = pg => ({ query: async (sql, args = []) => (await pg.query(sql, args)).rows, exec: sql => pg.exec(sql), transaction: fn => pg.transaction(tx => fn(adapter(tx))) });
let pg, db, migrations, app;
function request({ who = token, path = '/v1/agent/settings', post = false } = {}) {
  return new Request(config.apiOrigin + path, { method: post ? 'POST' : 'GET', headers: { origin: config.frontendOrigin,
    ...(who ? { cookie: '__Host-nina_session=' + who } : {}), ...(post ? { 'content-type': 'application/json' } : {}) }, ...(post ? { body: '{}' } : {}) });
}
before(async () => {
  pg = new PGlite(); db = adapter(pg); migrations = await readMigrations(); await migrate(db, migrations);
  for (const file of ['runtime-role.sql','agent-settings-role.sql']) await db.exec((await readFile(new URL('../server/sql/' + file, import.meta.url), 'utf8')).replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
});
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE nina_auth.sessions,nina_auth.user_roles,nina_auth.users,nina_agent.settings CASCADE;');
  for (const [id, role, raw] of [[admin,'admin',token],[staff,'user',staffToken]]) {
    await db.query('INSERT INTO nina_auth.users(id,email,full_name) VALUES($1,$2,$3)', [id,id+'@example.com','Fictional']);
    await db.query('INSERT INTO nina_auth.user_roles VALUES($1,$2)', [id,role]);
    await db.query("INSERT INTO nina_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [createHash('sha256').update(raw).digest('hex'),id]);
  }
  await db.query(`INSERT INTO nina_agent.settings(payload,source_snapshot_sha256,source_payload_sha256,payload_sha256)
   SELECT p,$2,$2,encode(sha256(convert_to(p::text,'UTF8')),'hex') FROM(SELECT $1::jsonb p) input`, [JSON.stringify(fictionalSettings),'a'.repeat(64)]);
  await db.exec('SET ROLE nina_app'); app = createApp({ db, config, migrations, aiFetch: () => { throw Error('No provider calls allowed'); } });
});
after(async () => { await pg.close(); });
test('agent settings: anonymous/staff cannot read; admin receives only business data with automation off', async () => {
  assert.equal((await app(request({ who: null }))).status,401); assert.equal((await app(request({ who: staffToken }))).status,403);
  const result = await (await app(request())).json(); assert.deepEqual(result.settings,fictionalSettings);
  assert.equal(result.automatic_replies_enabled,false); assert.equal(result.appointment_actions_enabled,false);
  assert.equal(result.configured,true); assert.match(result.payload_sha256,/^[a-f0-9]{64}$/);
});
test('agent settings: RLS requires active admin identity and grants never allow writes or schema creation', async () => {
  assert.equal((await db.query('SELECT count(*)::int n FROM nina_agent.settings'))[0].n,0);
  await db.transaction(async tx => { await tx.query("SELECT set_config('nina.user_id',$1,true)",[staff]); assert.equal((await tx.query('SELECT count(*)::int n FROM nina_agent.settings'))[0].n,0); });
  assert.equal((await db.query('SELECT count(*)::int n FROM nina_agent.settings'))[0].n,0);
  for(const sql of ["UPDATE nina_agent.settings SET imported_at=now()",'DELETE FROM nina_agent.settings','CREATE TABLE nina_agent.unapproved(id int)']) await assert.rejects(db.exec(sql),/permission denied/);
  await db.exec('RESET ROLE'); await db.query('UPDATE nina_auth.users SET disabled_at=now() WHERE id=$1',[admin]); await db.exec('SET ROLE nina_app');
  assert.equal((await app(request())).status,401);
});
test('agent settings: revoked admin, query injection, writes and unconfigured state do not expose settings', async () => {
  assert.equal((await app(request({ path:'/v1/agent/settings?include=secrets' }))).status,400);
  assert.equal((await app(request({ post:true }))).status,404);
  await db.exec('RESET ROLE; DELETE FROM nina_agent.settings; SET ROLE nina_app');
  const empty = await (await app(request())).json(); assert.equal(empty.configured,false); assert.equal(empty.settings,null);
  await db.exec('RESET ROLE'); await db.query("UPDATE nina_auth.user_roles SET role='user' WHERE user_id=$1",[admin]); await db.exec('SET ROLE nina_app');
  assert.equal((await app(request())).status,403);
});
test('agent settings: malformed payload or credentials are never returned or logged', async () => {
  for (const patch of [{ zernio_api_key:'SYNTHETIC_PRIVATE_KEY' }, { scheduling_policy:'automatic' }, { business_hours_end:'24:00' },
    { business_days:[1,1] }, { source_automation_active:'false' }, { response_delay_min:9000 },
    { system_prompt:'api_key: SYNTHETIC_PRIVATE_KEY' }, { review_notes:['Bearer SYNTHETIC_PRIVATE_KEY'] }]) assert.throws(()=>validateAgentSettings({...fictionalSettings,...patch}),/INVALID_AGENT_SETTINGS/);
  await db.exec('RESET ROLE');
  const bad={...fictionalSettings,scheduling_policy:'automatic'};
  await db.query("UPDATE nina_agent.settings SET payload=$1::jsonb,payload_sha256=encode(sha256(convert_to(($1::jsonb)::text,'UTF8')),'hex')",[JSON.stringify(bad)]);
  await db.exec('SET ROLE nina_app'); const response=await app(request()); assert.equal(response.status,503); assert.ok(!(await response.text()).includes('system_prompt'));
});
test('agent settings: additive code remains ready with six migrations, before settings exist', async () => {
  const isolated=new PGlite(), staged=adapter(isolated); try {
    await migrate(staged,migrations.slice(0,6)); await staged.exec((await readFile(new URL('../server/sql/runtime-role.sql',import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));
    await staged.query('INSERT INTO nina_auth.users(id,email) VALUES($1,$2)',[admin,'admin@example.com']); await staged.query("INSERT INTO nina_auth.user_roles VALUES($1,'admin')",[admin]);
    await staged.query("INSERT INTO nina_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),admin]); await staged.exec('SET ROLE nina_app');
    const handle=createApp({db:staged,config,migrations});
    assert.equal((await handle(request({path:'/readyz',who:null}))).status,200);
    const result=await (await handle(request())).json(); assert.equal(result.configured,false); assert.equal(result.settings,null);
  }finally{await isolated.close();}
});
test('agent settings import: identical rehearsal/apply cores, no source SQL, secrets or replay', async () => {
  const candidate={snapshot_sha256:'a'.repeat(64),settings:fictionalSettings};
  const rehearsal=await prepareAgentSettingsImport(candidate,candidate.snapshot_sha256);
  const apply=await prepareAgentSettingsImport(candidate,candidate.snapshot_sha256,{commit:true});
  assert.equal(rehearsal.replace('ROLLBACK;','COMMIT;'),apply);
  assert.ok(!/DELETE FROM|TRUNCATE|UPDATE nina_clinic|INSERT INTO nina_clinic/.test(apply));
  const isolated=new PGlite(), staged=adapter(isolated);try{
    await migrate(staged,migrations.slice(0,6)); await staged.exec((await readFile(new URL('../server/sql/runtime-role.sql',import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));
    await staged.query('INSERT INTO nina_auth.users(id,email) VALUES($1,$2)',[admin,'admin@example.com']); await staged.query("INSERT INTO nina_auth.user_roles VALUES($1,'admin')",[admin]);
    const [{name,owner}]=await staged.query('SELECT current_database() name,current_user owner');
    const exec=s=>staged.exec(s.replace('\\set ON_ERROR_STOP on\n','').replace("current_database()<>'nina'","current_database()<>'"+name+"'").replace("current_user<>'nina_owner'","current_user<>'"+owner+"'"));
    await exec(rehearsal); assert.equal((await staged.query("SELECT to_regnamespace('nina_agent')::text n"))[0].n,null);
    await exec(apply); assert.equal((await staged.query('SELECT count(*)::int n FROM nina_agent.settings'))[0].n,1);
    await assert.rejects(exec(apply),/SETTINGS_SCHEMA_CHANGED/);await staged.exec('ROLLBACK');
  }finally{await isolated.close();}
  await assert.rejects(prepareAgentSettingsImport({...candidate,unexpected:'secret'},candidate.snapshot_sha256),/INVALID_SETTINGS_SOURCE/);
});
