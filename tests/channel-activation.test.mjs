import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {prepareChannelActivation} from '../server/scripts/prepare-channel-activation.mjs';
import {readMigrations,migrate,checkSchema} from '../server/src/migrations.mjs';
const adapter=e=>({query:async(s,p=[]) =>(await e.query(s,p)).rows,exec:s=>e.exec(s),transaction:fn=>e.transaction(tx=>fn(adapter(tx)))});
test('channel activation: generated SQL validates prior history, applies grants and pins one scope atomically',async()=>{
 const pg=new PGlite(),db=adapter(pg);try{
  const migrations=await readMigrations();await migrate(db,migrations.slice(0,5));
  for(const f of ['runtime-role.sql','clinic-runtime-role.sql','clinic-write-role.sql','zernio-inbox-role.sql'])await db.exec((await readFile(new URL('../server/sql/'+f,import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));
  const sql=await prepareChannelActivation('a'.repeat(24),'b'.repeat(24));assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\nBEGIN;'));
  // PGlite has no psql metacommands; substitute only its observed database name.
  const [{name}]=await db.query('SELECT current_database() AS name');
  const executable=sql.replace('\\set ON_ERROR_STOP on\n','').replace("current_database()<>'nina'","current_database()<>'"+name+"'");
  await db.query('UPDATE nina_meta.schema_migrations SET checksum=$1 WHERE version=$2',['0'.repeat(64),migrations[4].version]);
  await assert.rejects(db.exec(executable),/UNEXPECTED_MIGRATION_HISTORY/);await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='nina_channel_processor'"))[0].n,0);
  await db.query('UPDATE nina_meta.schema_migrations SET checksum=$1 WHERE version=$2',[migrations[4].checksum,migrations[4].version]);
  await db.exec(executable);
  assert.equal(await checkSchema(db,migrations,['0007_agent_settings.sql']),true);await db.exec('SET ROLE nina_app');
  const [r]=await db.query('SELECT nina_channels.runtime_status($1,$2) AS status',['a'.repeat(24),'b'.repeat(24)]);assert.equal(r.status.scope_matches,true);
  await assert.rejects(db.exec('SELECT payload_encrypted FROM nina_channels.zernio_inbox'),/permission denied/);
 }finally{await pg.close();}
});
test('channel activation: scope IDs reject SQL injection and missing values before producing an artifact',async()=>{
 for(const value of ['',undefined,"a';DROP TABLE",'A'.repeat(24)])await assert.rejects(prepareChannelActivation(value,'b'.repeat(24)),/INVALID_CHANNEL_SCOPE/);
});
