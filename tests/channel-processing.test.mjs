import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac,createHash} from 'node:crypto';
import {readFile,mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {once} from 'node:events';
import {createChannelWorker} from '../server/src/channel-worker.mjs';
import {createMediaArchive,ChannelMediaError,mediaId,filePath} from '../server/src/channel-media.mjs';
import {createApp} from '../server/src/app.mjs';
import {createHttpServer} from '../server/src/http.mjs';
import {readConfig} from '../server/src/config.mjs';
import {byteRange} from '../server/src/channel-files.mjs';
import {PGlite} from '@electric-sql/pglite';
import {migrate,readMigrations} from '../server/src/migrations.mjs';
import {createZernioWebhook,decryptInbox} from '../server/src/zernio-webhook.mjs';
import {normalizeZernioEvent} from '../server/src/zernio-events.mjs';
import {assertRuntimeRole} from '../server/src/database.mjs';
const scope={enabled:true,accountId:'a'.repeat(24),profileId:'b'.repeat(24),secret:'synthetic-signing-'.repeat(4),encryptionKey:randomBytes(32)};
let pg,db,receive,migrations;
const adapter=e=>({query:async(s,p=[])=>{const q=await e.query(s,p);return q.rows;},exec:s=>e.exec(s),transaction:fn=>e.transaction(tx=>fn(adapter(tx)))});
async function owner(sql,args=[]){await db.exec('RESET ROLE');try{return await db.query(sql,args);}finally{await db.exec('SET ROLE nina_app');}}
function event(overrides={}){return {id:randomUUID(),event:'message.received',timestamp:'2026-11-04T12:00:00Z',account:{accountId:scope.accountId,profileId:scope.profileId,platform:'whatsapp'},conversation:{id:'internal-fixture',platformConversationId:'platform-conversation-fixture'},message:{platform:'whatsapp',id:'internal-message',platformMessageId:'wamid-'+randomUUID(),conversationId:'internal-fixture',direction:'incoming',sentAt:'2026-11-04T11:59:59Z',text:'CONTEUDO_FICTICIO',attachments:[],sender:{id:'peer-fixture',businessScopedUserId:'bsuid-fixture',phoneNumber:'+5511999990000',name:'Tutor fictício'}},...overrides};}
async function enqueue(payload){const raw=JSON.stringify(payload);const request=new Request('https://api.example.invalid/v1/webhooks/zernio',{method:'POST',headers:{'content-type':'application/json','x-zernio-signature':createHmac('sha256',scope.secret).update(raw).digest('hex')},body:raw});assert.equal((await receive(request)).status,'queued');}
async function claim(){const lease=randomUUID();const [r]=await db.query('SELECT nina_channels.claim_job($1,$2,$3) AS job',[scope.accountId,scope.profileId,lease]);return r.job?{job:r.job,lease}:null;}
function plan(job){const raw=decryptInbox(job.payload_encrypted,scope.encryptionKey,{id:job.id,accountId:job.account_id,eventId:job.event_id});const normalized=normalizeZernioEvent(JSON.parse(raw.toString()),scope,job);return {...normalized,files:[]};}
async function apply(claimed,body=plan(claimed.job)){return (await db.query('SELECT nina_channels.apply_job($1,$2,$3::jsonb) AS result',[claimed.job.id,claimed.lease,body]))[0].result;}
before(async()=>{pg=new PGlite();db=adapter(pg);migrations=await readMigrations();await migrate(db,migrations);
 for(const file of ['runtime-role.sql','clinic-runtime-role.sql','clinic-write-role.sql','zernio-inbox-role.sql','channel-processing-role.sql'])await db.exec((await readFile(new URL('../server/sql/'+file,import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));
 receive=createZernioWebhook(db,scope);
});
beforeEach(async()=>{await db.exec('RESET ROLE; TRUNCATE nina_channels.processing_log,nina_channels.message_files,nina_channels.media_files,nina_channels.delivery_receipts,nina_channels.message_links,nina_channels.conversation_links,nina_channels.peer_links,nina_channels.zernio_inbox,nina_channels.processor_scope,nina_clinic.messages,nina_clinic.conversations,nina_clinic.contacts CASCADE;');
 await db.query('INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES($1,$2)',[scope.accountId,scope.profileId]);await db.exec('SET ROLE nina_app');});
after(async()=>pg?.close());
test('channel processing: constrained function owner is NOLOGIN, cannot be assumed and raw rows stay denied',async()=>{
 await assertRuntimeRole(db);
 // SET ROLE alone retains PGlite's original superuser session authority. Check
 // membership explicitly; the VPS rehearsal uses a real nina_app login.
 const [membership]=await db.query("SELECT pg_has_role(current_user,'nina_channel_processor','MEMBER') AS member");
 assert.equal(membership.member,false);
 const [caps]=await owner("SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname='nina_channel_processor'");
 assert.ok(Object.values(caps).every(value=>value===false));
 for(const sql of ['SELECT * FROM nina_channels.processor_scope','SELECT payload_encrypted FROM nina_channels.zernio_inbox','SELECT * FROM nina_channels.peer_links','DELETE FROM nina_channels.zernio_inbox','UPDATE nina_clinic.messages SET content=null'])await assert.rejects(db.exec(sql),/permission denied/);
 const [r]=await db.query('SELECT nina_channels.runtime_status($1,$2) AS status',[scope.accountId,scope.profileId]);assert.equal(r.status.scope_matches,true);assert.equal(r.status.pending,0);
 const [bad]=await db.query('SELECT nina_channels.runtime_status($1,$2) AS status',['c'.repeat(24),scope.profileId]);assert.deepEqual(bad.status,{scope_matches:false});
});
test('channel processing: write a tutor and incoming message passively, preserve the encrypted receipt and never enable AI',async()=>{
 const payload=event();await enqueue(payload);const claimed=await claim();assert.ok(claimed);const result=await apply(claimed);assert.equal(result.status,'processed');
 const [contact]=await owner('SELECT * FROM nina_clinic.contacts');assert.equal(contact.phone_number,'5511999990000');assert.equal(contact.name,'Tutor fictício');assert.equal(contact.user_id,null);
 const [convo]=await owner('SELECT * FROM nina_clinic.conversations');assert.equal(convo.status,'human');assert.equal(convo.ai_paused,true);
 const [message]=await owner('SELECT * FROM nina_clinic.messages');assert.equal(message.content,'CONTEUDO_FICTICIO');assert.equal(message.from_type,'user');assert.equal(message.processed_by_nina,false);
 const [receipt]=await owner('SELECT * FROM nina_channels.zernio_inbox');assert.equal(receipt.status,'processed');assert.ok(receipt.payload_encrypted);assert.equal(receipt.lease_token,null);
 assert.equal(await claim(),null);assert.equal((await owner('SELECT count(*)::int AS n FROM nina_channels.processing_log'))[0].n,1);
});
test('channel processing: repeat platform message IDs in distinct events do not duplicate or overwrite content',async()=>{
 const payload=event();await enqueue(payload);await apply(await claim());payload.id=randomUUID();payload.message.text='ALTERACAO_QUE_NAO_PODE_SOBRESCREVER';await enqueue(payload);const result=await apply(await claim());assert.equal(result.duplicate,true);
 const rows=await owner('SELECT content FROM nina_clinic.messages');assert.equal(rows.length,1);assert.equal(rows[0].content,'CONTEUDO_FICTICIO');
});
test('channel processing: BSUID-only peers receive no invented phone and keep the same tutor when a verified phone arrives',async()=>{
 const payload=event();delete payload.message.sender.phoneNumber;await enqueue(payload);await apply(await claim());
 const [before]=await owner('SELECT id,phone_number FROM nina_clinic.contacts');assert.equal(before.phone_number,null);
 payload.id=randomUUID();payload.message.platformMessageId='next-message';payload.message.sender.phoneNumber='+5511999990000';await enqueue(payload);await apply(await claim());
 const rows=await owner('SELECT id,phone_number FROM nina_clinic.contacts');assert.equal(rows.length,1);assert.equal(rows[0].id,before.id);assert.equal(rows[0].phone_number,'5511999990000');
});
test('channel processing: activity cannot invalidate contact editing or change a paused/archived conversation',async()=>{
 const payload=event();await enqueue(payload);await apply(await claim());
 const [first]=await owner('SELECT id,revision,updated_at FROM nina_clinic.contacts');
 await owner("UPDATE nina_clinic.conversations SET status='paused',ai_paused=true,is_active=false,archived_at=now()");
 payload.id=randomUUID();payload.message.platformMessageId='later-message';payload.message.sentAt='2026-11-04T12:00:05Z';await enqueue(payload);await apply(await claim());
 const [later]=await owner('SELECT revision,updated_at,last_activity FROM nina_clinic.contacts');assert.equal(later.revision,first.revision);assert.deepEqual(later.updated_at,first.updated_at);
 const convos=await owner('SELECT status,is_active,ai_paused,archived_at FROM nina_clinic.conversations');assert.equal(convos.length,1);assert.equal(convos[0].status,'paused');assert.equal(convos[0].is_active,false);
});
test('channel processing: outgoing echoes identify the tutor and are labelled external unless sender attribution is explicit',async()=>{
 const incoming=event();await enqueue(incoming);await apply(await claim());
 const outgoing=event({event:'message.sent'});outgoing.message.direction='outgoing';outgoing.message.sender={id:scope.accountId,name:'EMPRESA_NAO_E_O_TUTOR'};outgoing.conversation.participantId='peer-fixture';outgoing.conversation.participantName='NOME_NAO_DEVE_SUBSTITUIR';
 await enqueue(outgoing);await apply(await claim());assert.equal((await owner('SELECT name FROM nina_clinic.contacts'))[0].name,'Tutor fictício');
 assert.equal((await owner("SELECT from_type FROM nina_clinic.messages WHERE whatsapp_message_id=$1",[outgoing.message.platformMessageId]))[0].from_type,'external');
});
test('channel processing: delivery receipts may precede outgoing echoes and later receipts never downgrade read status',async()=>{
 const outgoing=event({event:'message.sent'});outgoing.message.direction='outgoing';outgoing.conversation.participantId='peer-fixture';outgoing.conversation.participantName='Tutor';
 for(const status of ['read','delivered']){const receipt={...outgoing,id:randomUUID(),event:'message.'+status,statusAt:'2026-11-04T12:00:01Z'};await enqueue(receipt);await apply(await claim());}
 await enqueue(outgoing);await apply(await claim());const [message]=await owner('SELECT status,read_at,delivered_at FROM nina_clinic.messages');assert.equal(message.status,'read');assert.ok(message.read_at);assert.ok(message.delivered_at);
 await enqueue({...outgoing,id:randomUUID(),event:'message.failed',statusAt:'2026-11-04T12:00:10Z',error:{code:131026}});await apply(await claim());assert.equal((await owner('SELECT status FROM nina_clinic.messages'))[0].status,'read');
});
test('channel processing: ambiguous historical identities roll back all clinical changes and retain the event for review',async()=>{
 await owner("INSERT INTO nina_clinic.contacts(phone_number,name,whatsapp_id) VALUES('5511999990000','A','one'),('+5511999990000','B','other')");
 await enqueue(event());const claimed=await claim();await assert.rejects(apply(claimed),/CHANNEL_AMBIGUOUS_CONTACT/);
 await db.query('SELECT nina_channels.fail_job($1,$2,$3,false)',[claimed.job.id,claimed.lease,'CHANNEL_AMBIGUOUS_CONTACT']);
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.messages'))[0].n,0);const [row]=await owner('SELECT status,payload_encrypted FROM nina_channels.zernio_inbox');assert.equal(row.status,'needs_review');assert.ok(row.payload_encrypted);
});
test('channel processing: stale lease owners cannot acknowledge, extend or fail a reclaimed job',async()=>{
 await enqueue(event());const first=await claim();await owner("UPDATE nina_channels.zernio_inbox SET lease_until=now()-interval '1 second' WHERE id=$1",[first.job.id]);const second=await claim();assert.equal(second.job.id,first.job.id);assert.equal(second.job.attempts,2);
 assert.deepEqual(await apply(first),{status:'lease_lost'});
 assert.equal((await db.query('SELECT nina_channels.heartbeat_job($1,$2) AS ok',[first.job.id,first.lease]))[0].ok,false);
 assert.equal((await db.query('SELECT nina_channels.fail_job($1,$2,$3,true) AS ok',[first.job.id,first.lease,'TEST']))[0].ok,false);
 assert.equal((await apply(second)).status,'processed');
});
test('channel processing: mismatched plans and malformed file metadata never bypass the signed receipt or partially write',async()=>{
 await enqueue(event());const claimed=await claim();const normalized=plan(claimed.job);
 await assert.rejects(apply(claimed,{...normalized,event_id:randomUUID()}),/CHANNEL_PLAN_MISMATCH/);
 await assert.rejects(apply(claimed,{...normalized,files:[{id:randomUUID(),index:0,bytes:10,sha256:'not-a-digest',mime:'image/png',type:'image',original_type:'image'}]}));
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n,0);
});

const workerConfig={zernio:scope,channelProcessing:{enabled:true,heartbeatMilliseconds:20}};
test('channel worker: complete encrypted receipt becomes one message with every archived attachment and no provider URLs in clinical data',async()=>{
 const payload=event();payload.message.attachments=[{type:'image',url:'https://media.example.invalid/photo',filename:'foto.png'},{type:'audio',url:'https://media.example.invalid/voice',payload:{voice:true}}];
 await enqueue(payload);const seen=[],logs=[];
 const archive={download:async input=>{seen.push(input);return {id:mediaId(input.accountId,input.messageId,input.attachment.index),bytes:10,sha256:'a'.repeat(64),mime:input.attachment.type==='image'?'image/png':'audio/ogg',filename:input.attachment.filename};}};
 const worker=createChannelWorker({db,config:workerConfig,archive,log:row=>logs.push(row)});
 assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);
 assert.equal(seen.length,2);assert.ok(seen.every(x=>x.signal instanceof AbortSignal));
 const rows=await owner('SELECT position,type,voice FROM nina_channels.message_files ORDER BY position');assert.deepEqual(rows,[{position:0,type:'image',voice:false},{position:1,type:'audio',voice:true}]);
 const messages=await owner('SELECT metadata,media_url FROM nina_clinic.messages');assert.match(messages[0].media_url,/^\/v1\/files\//);assert.ok(!JSON.stringify(messages).includes('example.invalid'));
 assert.deepEqual(logs,[{event:'channel_processing',result:'processed'}]);
});
test('channel worker: incomplete media never creates a partial message, retries transient failures and sends permanent ones to review',async()=>{
 const payload=event();payload.message.attachments=[{type:'image',url:'https://media.example.invalid/private'}];await enqueue(payload);
 let permanent=false;const logs=[];const worker=createChannelWorker({db,config:workerConfig,archive:{download:async()=>{throw new ChannelMediaError(permanent?'MEDIA_NOT_AVAILABLE':'MEDIA_NETWORK_FAILED',!permanent);}},log:x=>logs.push(x)});
 await worker.runOnce();assert.equal((await owner('SELECT status FROM nina_channels.zernio_inbox'))[0].status,'pending');
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.messages'))[0].n,0);
 await owner('UPDATE nina_channels.zernio_inbox SET available_at=now()');permanent=true;await worker.runOnce();
 const [row]=await owner('SELECT status,attempts,payload_encrypted FROM nina_channels.zernio_inbox');assert.equal(row.status,'needs_review');assert.equal(row.attempts,2);assert.ok(row.payload_encrypted);
 assert.ok(!JSON.stringify(logs).includes('private'));
});
test('channel worker: ciphertext tampering is retained for review without creating clinical records or leaking errors',async()=>{
 await enqueue(event());await owner("UPDATE nina_channels.zernio_inbox SET payload_encrypted=left(payload_encrypted,length(payload_encrypted)-2)||'AA'");const logs=[];
 await createChannelWorker({db,config:workerConfig,archive:{},log:x=>logs.push(x)}).runOnce();
 const [row]=await owner('SELECT status,last_error_code FROM nina_channels.zernio_inbox');assert.equal(row.status,'needs_review');assert.equal(row.last_error_code,'CHANNEL_DECRYPT_FAILED');
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n,0);assert.ok(!JSON.stringify(logs).includes('private-cipher'));
});
test('channel worker: lost heartbeats abort downloads and stale workers cannot commit clinical writes',async()=>{
 const payload=event();payload.message.attachments=[{type:'image',url:'https://media.example.invalid/photo'}];await enqueue(payload);
 let superseded=false;
 const archive={download:async({signal})=>{await owner("UPDATE nina_channels.zernio_inbox SET lease_token=$1",[randomUUID()]);await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));superseded=true;throw new ChannelMediaError('MEDIA_NETWORK_FAILED',true);}};
 await createChannelWorker({db,config:workerConfig,archive}).runOnce();assert.equal(superseded,true);
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.messages'))[0].n,0);
 assert.equal((await owner('SELECT status FROM nina_channels.zernio_inbox'))[0].status,'processing');
});
test('channel worker: five abandoned attempts terminate in review and a disabled worker never accesses the database',async()=>{
 assert.equal(await createChannelWorker({db:{query:()=>assert.fail()},config:{channelProcessing:{enabled:false}}}).runOnce(),false);
 await enqueue(event());for(let attempt=1;attempt<=5;attempt++){const claimed=await claim();assert.equal(claimed.job.attempts,attempt);await owner("UPDATE nina_channels.zernio_inbox SET lease_until=now()-interval '1 second'");}
 assert.equal(await claim(),null);const [row]=await owner('SELECT status,last_error_code FROM nina_channels.zernio_inbox');assert.equal(row.status,'needs_review');assert.equal(row.last_error_code,'CHANNEL_RETRY_EXHAUSTED');
});
test('channel processing: historical platform-message deduplication keeps its original conversation and content',async()=>{
 const payload=event();const contact=randomUUID(),convo=randomUUID(),message=randomUUID();
 await owner("INSERT INTO nina_clinic.contacts(id,phone_number,name) VALUES($1,'5511999990000','Legado')",[contact]);
 await owner("INSERT INTO nina_clinic.conversations(id,contact_id,status,is_active,ai_paused) VALUES($1,$2,'paused',false,true)",[convo,contact]);
 await owner("INSERT INTO nina_clinic.messages(id,conversation_id,whatsapp_message_id,type,from_type,content,status) VALUES($1,$2,$3,'text','user','ORIGINAL','sent')",[message,convo,payload.message.platformMessageId]);
 await enqueue(payload);const result=await apply(await claim());assert.equal(result.message_id,message);assert.equal(result.duplicate,true);
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.conversations'))[0].n,1);assert.equal((await owner('SELECT content FROM nina_clinic.messages'))[0].content,'ORIGINAL');
});
test('channel files: authenticated HTTP streaming supports ranges, denies revoked users and never publishes arbitrary paths',async()=>{
 const directory=await mkdtemp('/private/tmp/nina-private-media-test-');let server;
 try{
  const bytes=Buffer.from('ARQUIVO_FICTICIO_0123456789');const archive=createMediaArchive({directory,minFreeBytes:0,maxBytes:1024},{lookup:async()=>[{address:'8.8.8.8'}],transport:async()=>({status:200,headers:{'content-type':'audio/ogg','content-length':String(bytes.length)},body:(await import('node:stream')).Readable.from([bytes])})});
  const payload=event();payload.message.text=null;payload.message.attachments=[{type:'audio',url:'https://media.example.invalid/fake',filename:'audio.ogg'}];await enqueue(payload);
  await createChannelWorker({db,config:workerConfig,archive}).runOnce();
  const [file]=await owner('SELECT id FROM nina_channels.media_files');assert.ok(file);
  const user=randomUUID(),token=randomBytes(32).toString('base64url');
  await owner("INSERT INTO nina_auth.users(id,email,full_name) VALUES($1,$2,'Fictício')",[user,user+'@example.invalid']);await owner("INSERT INTO nina_auth.user_roles VALUES($1,'user')",[user]);
  await owner("INSERT INTO nina_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),user]);
  const config=readConfig({NODE_ENV:'test',API_ORIGIN:'http://127.0.0.1:3000',FRONTEND_ORIGIN:'http://localhost:5173',DATABASE_URL:'postgres://nina_app:fake@localhost/nina',MEDIA_ENABLED:'true',MEDIA_STORAGE_DIR:directory});
  const app=createApp({db,config,migrations,mediaReady:archive.prepare});const cookie='nina_session='+token;
  const request=(path,options={})=>new Request(config.apiOrigin+path,{...options,headers:{cookie,origin:config.frontendOrigin,...options.headers}});
  const path='/v1/files/'+file.id;
  assert.equal((await app(new Request(config.apiOrigin+path))).status,401);
  assert.equal((await app(request(path,{headers:{origin:'https://attacker.invalid'}}))).status,403);
  assert.equal((await app(request(path,{headers:{'sec-fetch-site':'cross-site'}}))).status,403);
  assert.equal((await app(request(path+'?path=/etc/passwd'))).status,400);
  assert.equal((await app(request('/v1/files/not-a-uuid'))).status,400);
  assert.equal((await app(request('/v1/channels/status'))).status,403);
  const contact=(await owner('SELECT id FROM nina_clinic.contacts'))[0];const history=await (await app(request('/v1/clinic/contacts/'+contact.id+'/messages'))).json();assert.equal(history.data[0].attachments[0].id,file.id);assert.ok(!JSON.stringify(history).includes('media.example'));
  server=createHttpServer(app,config);server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const get=async(options={})=>fetch(base+path,{...options,headers:{cookie,origin:config.frontendOrigin,...options.headers}});
  let response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(await response.text(),bytes.toString());
  response=await get({headers:{range:'bytes=2-6'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-6/'+bytes.length);assert.equal(await response.text(),bytes.subarray(2,7).toString());
  response=await get({headers:{range:'bytes=-4'}});assert.equal(await response.text(),bytes.subarray(-4).toString());
  response=await get({headers:{range:'bytes=999-'}});assert.equal(response.status,416);await response.arrayBuffer();
  response=await get({method:'HEAD'});assert.equal(response.headers.get('content-length'),String(bytes.length));assert.equal((await response.arrayBuffer()).byteLength,0);
  response=await app(request(path+'?download=1'));assert.match(response.headers.get('content-disposition'),/^attachment;/);await response.arrayBuffer();
  const preflight=await app(request(path,{method:'OPTIONS',headers:{'access-control-request-method':'HEAD','access-control-request-headers':'Range'}}));assert.equal(preflight.status,204);
  const disabled=createApp({db,config:{...config,media:{enabled:false}},migrations});assert.equal((await disabled(request(path))).status,503);
  await owner('DELETE FROM nina_auth.user_roles WHERE user_id=$1',[user]);assert.equal((await get()).status,401);
  await owner("INSERT INTO nina_auth.user_roles VALUES($1,'user')",[user]);await rm(filePath(directory,file.id));await symlink('/etc/passwd',filePath(directory,file.id));assert.equal((await get()).status,503);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(directory,{recursive:true,force:true});}
});
test('channel files: malformed, multipart and unsatisfiable byte ranges are rejected',()=>{
 for(const raw of ['bytes=','bytes=2-1','bytes=100-','bytes=-0','bytes=0-1,4-5','items=1-2','bytes=9999999999999999-'])assert.equal(byteRange(raw,10),null);
 assert.deepEqual(byteRange('bytes=2-',10),{start:2,end:9,partial:true});assert.deepEqual(byteRange('bytes=-100',10),{start:0,end:9,partial:true});
});
