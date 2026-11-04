import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrate,readMigrations} from '../server/src/migrations.mjs';
import {legacyMediaPlan,copyLegacyMedia,prepareLegacyMediaSql} from '../server/src/legacy-media.mjs';
import {ChannelMediaError,mediaId} from '../server/src/channel-media.mjs';
const accountId='a'.repeat(24),origin='https://'+'s'.repeat(20)+'.supabase.co';
const source=()=>({id:randomUUID(),whatsapp_message_id:'wamid-'+randomUUID(),media_url:origin+'/storage/v1/object/public/audio-messages/inbound/legacy.jpg',file_name:'PRIVATE_NAME.jpg'});
const archive={download:async({accountId,messageId,attachment})=>({id:mediaId(accountId,messageId,attachment.index),bytes:123,sha256:'a'.repeat(64),mime:'image/jpeg'})};
async function manifest(rows){return{version:1,run_id:randomUUID(),account_id:accountId,...await copyLegacyMedia(legacyMediaPlan(rows,{origin,accountId}),{archive,pause:async()=>{}})};}
let pg,db,migrations,contact,conversation,message,original;
const adapter=e=>({query:async(s,p=[]) =>(await e.query(s,p)).rows,exec:s=>e.exec(s),transaction:fn=>e.transaction(tx=>fn(adapter(tx)))});
before(async()=>{pg=new PGlite();db=adapter(pg);migrations=await readMigrations();await migrate(db,migrations);for(const f of ['runtime-role.sql','clinic-runtime-role.sql','clinic-write-role.sql','zernio-inbox-role.sql','channel-processing-role.sql'])await db.exec((await readFile(new URL('../server/sql/'+f,import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));});
beforeEach(async()=>{await db.exec('RESET ROLE; TRUNCATE nina_channels.message_files,nina_channels.media_files,nina_channels.processor_scope,nina_clinic.contacts CASCADE');
 await db.query('INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES($1,$2)',[accountId,'b'.repeat(24)]);contact=randomUUID();conversation=randomUUID();original=source();message=original.id;
 await db.query("INSERT INTO nina_clinic.contacts(id,phone_number,name,notes) VALUES($1,'5511999990000','Fictício','PRESERVE_NOTES')",[contact]);
 await db.query("INSERT INTO nina_clinic.conversations(id,contact_id,status,is_active,ai_paused) VALUES($1,$2,'paused',false,true)",[conversation,contact]);
 await db.query("INSERT INTO nina_clinic.messages(id,conversation_id,whatsapp_message_id,type,from_type,content,status,media_url,media_type,metadata) VALUES($1,$2,$3,'image','human','PRESERVE_CONTENT','read',$4,'image/jpeg',$5::jsonb)",[message,conversation,original.whatsapp_message_id,original.media_url,{file_name:"PRIVATE_NAME');DROP TABLE should_not_exist;--.jpg",is_sticker:true}]);
});
after(async()=>pg?.close());
async function execute(sql){const[{name}]=await db.query('SELECT current_database() AS name');return db.exec(sql.replace('\\set ON_ERROR_STOP on\n','').replace("current_database()<>'nina'","current_database()<>'"+name+"'"));}
test('legacy media: pin one public bucket/project, keep stable IDs and handle a missing provider ID without inventing a message',async()=>{
 const one=source(),two={...source(),whatsapp_message_id:null};const plan=legacyMediaPlan([one,two],{origin,accountId});assert.equal(plan[0].file_id,mediaId(accountId,one.whatsapp_message_id,0));assert.equal(plan[1].file_id,mediaId(accountId,'nina-legacy:'+two.id,0));
 const result=await copyLegacyMedia(plan,{archive});assert.equal(result.complete,true);assert.equal(result.rows.length,2);assert.ok(!JSON.stringify(result).includes('PRIVATE_NAME'));assert.ok(!JSON.stringify(result).includes('https://'));
 for(const url of ['http://'+origin.slice(8)+'/storage/v1/object/public/audio-messages/f','https://attacker.invalid/storage/v1/object/public/audio-messages/f',origin+'/storage/v1/object/authenticated/audio-messages/f',origin+'/storage/v1/object/public/audio-messages/f?token=secret',origin+'/storage/v1/object/public/audio-messages/f#secret'])assert.throws(()=>legacyMediaPlan([{...one,media_url:url}],{origin,accountId}));
 assert.throws(()=>legacyMediaPlan([one,one],{origin,accountId}),{code:'LEGACY_DUPLICATE_IDENTITY'});
});
test('legacy media: retry only transient archive failures, retain permanent failures and refuse partial apply SQL',async()=>{
 const plan=legacyMediaPlan([source()],{origin,accountId});let n=0;
 const retried=await copyLegacyMedia(plan,{pause:async()=>{},archive:{download:async args=>{if(n++===0)throw new ChannelMediaError('MEDIA_NETWORK_FAILED',true);return archive.download(args);}}});assert.equal(retried.complete,true);assert.equal(n,2);
 const failed=await copyLegacyMedia(plan,{archive:{download:async()=>{throw new ChannelMediaError('MEDIA_NOT_AVAILABLE');}}});assert.equal(failed.complete,false);assert.deepEqual(failed.failed,[{message_id:plan[0].message_id,code:'MEDIA_NOT_AVAILABLE'}]);assert.throws(()=>prepareLegacyMediaSql({account_id:accountId,run_id:randomUUID(),...failed},migrations),{code:'LEGACY_INCOMPLETE_MANIFEST'});
});
test('legacy media: metadata is linked atomically and replay stays idempotent while preserving content, identities and conversation state',async()=>{
 const data=await manifest([original]);data.rows[0].ignored_private_field='PRIVATE_MUST_NOT_BE_IN_SQL';const sql=prepareLegacyMediaSql(data,migrations);assert.ok(!sql.includes('PRIVATE_'));assert.ok(!sql.includes(original.media_url));
 const[before]=await db.query('SELECT content,status,from_type,metadata,conversation_id FROM nina_clinic.messages WHERE id=$1',[message]);
 await execute(sql);await execute(sql);
 const[after]=await db.query('SELECT content,status,from_type,metadata,conversation_id FROM nina_clinic.messages WHERE id=$1',[message]);assert.deepEqual(after,before);
 const[media]=await db.query('SELECT media_url,media_type FROM nina_clinic.messages WHERE id=$1',[message]);assert.equal(media.media_url,'/v1/files/'+data.rows[0].file_id);assert.equal(media.media_type,'image/jpeg');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_channels.message_files'))[0].n,1);assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_channels.media_files'))[0].n,1);
 const[c]=await db.query('SELECT status,is_active,ai_paused FROM nina_clinic.conversations');assert.deepEqual(c,{status:'paused',is_active:false,ai_paused:true});assert.equal((await db.query('SELECT notes FROM nina_clinic.contacts'))[0].notes,'PRESERVE_NOTES');
 assert.equal((await db.query("SELECT has_column_privilege('nina_app','nina_clinic.messages','media_url','UPDATE') AS allowed"))[0].allowed,false);
});
test('legacy media: a changed source URL aborts all links and preserves concurrent changes',async()=>{
 const sql=prepareLegacyMediaSql(await manifest([original]),migrations);await db.query('UPDATE nina_clinic.messages SET media_url=$1 WHERE id=$2',[origin+'/changed',message]);
 await assert.rejects(execute(sql),/LEGACY_SOURCE_CHANGED/);await db.exec('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_channels.media_files'))[0].n,0);assert.equal((await db.query('SELECT media_url FROM nina_clinic.messages'))[0].media_url,origin+'/changed');
});
test('legacy media: conflicting file metadata, account or existing attachment is never overwritten',async()=>{
 const data=await manifest([original]),r=data.rows[0];await db.query('INSERT INTO nina_channels.media_files(id,account_id,byte_count,sha256,mime) VALUES($1,$2,123,$3,$4)',[r.file_id,'c'.repeat(24),'b'.repeat(64),'image/jpeg']);
 await assert.rejects(execute(prepareLegacyMediaSql(data,migrations)),/LEGACY_FILE_CONFLICT/);await db.exec('ROLLBACK');assert.equal((await db.query('SELECT media_url FROM nina_clinic.messages'))[0].media_url,original.media_url);assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_channels.message_files'))[0].n,0);
});
test('legacy media: source schema checksums, account scope and maintenance ownership are mandatory',async()=>{
 const data=await manifest([original]),sql=prepareLegacyMediaSql(data,migrations);await db.query('UPDATE nina_meta.schema_migrations SET checksum=$1 WHERE version=$2',['0'.repeat(64),migrations[5].version]);await assert.rejects(execute(sql),/LEGACY_SCHEMA_CHANGED/);await db.exec('ROLLBACK');await db.query('UPDATE nina_meta.schema_migrations SET checksum=$1 WHERE version=$2',[migrations[5].checksum,migrations[5].version]);
 const foreign={...data,account_id:'c'.repeat(24)};await assert.rejects(execute(prepareLegacyMediaSql(foreign,migrations)),/LEGACY_ACCOUNT_MISMATCH/);await db.exec('ROLLBACK');
 await db.exec('SET ROLE nina_app');await assert.rejects(execute(sql),/LEGACY_MAINTENANCE_ONLY|permission denied/);await db.exec('ROLLBACK; RESET ROLE');assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_channels.media_files'))[0].n,0);
});
