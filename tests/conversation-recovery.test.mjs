import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readMigrations,migrate} from '../server/src/migrations.mjs';
import {createZernioWebhook} from '../server/src/zernio-webhook.mjs';
import {createChannelWorker} from '../server/src/channel-worker.mjs';
import {prepareConversationRecovery} from '../server/scripts/prepare-conversation-recovery.mjs';
const scope={enabled:true,accountId:'a'.repeat(24),profileId:'b'.repeat(24),secret:'synthetic-secret-'.repeat(4),encryptionKey:randomBytes(32)};
const contact=randomUUID(),oldA=randomUUID(),oldB=randomUUID();
const adapter=p=>({query:async(s,a=[])=>(await p.query(s,a)).rows,exec:s=>p.exec(s),transaction:fn=>p.transaction(tx=>fn(adapter(tx)))});
let pg,db,receive,worker,payload,plan,beforeConvos,beforeMessages;
async function owner(s,a=[]){await db.exec('RESET ROLE');try{return await db.query(s,a);}finally{await db.exec('SET ROLE nina_app');}}
async function enqueue(event){const raw=JSON.stringify(event);await receive(new Request('https://api.example.invalid/v1/webhooks/zernio',{method:'POST',headers:{'content-type':'application/json','x-zernio-signature':createHmac('sha256',scope.secret).update(raw).digest('hex')},body:raw}));}
async function execute(sql){await db.exec('RESET ROLE');try{
 const [{name,role}]=await db.query('SELECT current_database() name,current_user role');
 await db.exec(sql.replace('\\set ON_ERROR_STOP on\n','').replace("current_database()<>'nina'","current_database()<>'"+name+"'").replace("current_user<>'nina_owner'","current_user<>'"+role+"'"));
}catch(e){await db.exec('ROLLBACK');throw e;}finally{await db.exec('SET ROLE nina_app');}}
before(async()=>{pg=new PGlite();db=adapter(pg);await migrate(db,await readMigrations());for(const f of ['runtime-role.sql','clinic-runtime-role.sql','clinic-write-role.sql','zernio-inbox-role.sql','channel-processing-role.sql'])await db.exec((await readFile(new URL('../server/sql/'+f,import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));receive=createZernioWebhook(db,scope);worker=createChannelWorker({db,config:{zernio:scope,channelProcessing:{enabled:true}},archive:{download(){throw Error('Must not download or send anything');}}});});
beforeEach(async()=>{
 await db.exec('RESET ROLE;DROP SCHEMA IF EXISTS nina_review_20261105 CASCADE;TRUNCATE nina_channels.processing_log,nina_channels.delivery_receipts,nina_channels.message_links,nina_channels.conversation_links,nina_channels.peer_links,nina_channels.zernio_inbox,nina_channels.processor_scope,nina_clinic.messages,nina_clinic.conversations,nina_clinic.contacts CASCADE;');
 await db.query('INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES($1,$2)',[scope.accountId,scope.profileId]);
 await db.query("INSERT INTO nina_clinic.contacts(id,name,whatsapp_id,phone_number) VALUES($1,'Tutor fictício','peer-fixture',NULL)",[contact]);
 await db.query("INSERT INTO nina_clinic.conversations(id,contact_id,status,is_active,ai_paused,zernio_conversation_id,metadata) VALUES($1,$3,'nina',true,false,'internal-fixture','{\"preserve\":1}'),($2,$3,'paused',false,true,'internal-fixture','{\"preserve\":2}')",[oldA,oldB,contact]);
 await db.query("UPDATE nina_clinic.conversations SET archived_at=now(),ai_paused_reason='Controle antigo' WHERE id=$1",[oldB]);
 await db.query("INSERT INTO nina_clinic.messages(conversation_id,content,type,from_type,status,sent_at) VALUES($1,'HISTORICO_A','text','user','sent',now()),($2,'HISTORICO_B','text','human','sent',now())",[oldA,oldB]);
 beforeConvos=await db.query('SELECT * FROM nina_clinic.conversations ORDER BY id');beforeMessages=await db.query('SELECT * FROM nina_clinic.messages ORDER BY id');
 await db.exec('SET ROLE nina_app');
 payload={id:randomUUID(),event:'message.sent',timestamp:'2026-11-05T18:32:14Z',account:{accountId:scope.accountId,profileId:scope.profileId,platform:'whatsapp'},conversation:{id:'internal-fixture',platformConversationId:'platform-fixture',participantId:'peer-fixture'},message:{platform:'whatsapp',platformMessageId:'new-provider-message',conversationId:'internal-fixture',direction:'outgoing',sentAt:'2026-11-05T18:32:11Z',text:'NOVA_MENSAGEM_FICTICIA',attachments:[],sentVia:'api'}};
 await enqueue(payload);await worker.runOnce();
 const [r]=await owner('SELECT id,status,last_error_code,payload_sha256,attempts FROM nina_channels.zernio_inbox');assert.equal(r.status,'needs_review');assert.equal(r.last_error_code,'CHANNEL_AMBIGUOUS_CONVERSATION');
 plan={job_id:r.id,event_id:payload.id,account_id:scope.accountId,profile_id:scope.profileId,payload_sha256:r.payload_sha256,contact_id:contact,new_conversation_id:randomUUID(),provider_message_id:payload.message.platformMessageId,provider_conversation_id:'internal-fixture',platform_conversation_id:'platform-fixture',peer_keys:[{kind:'platform',value:'peer-fixture'}],historical_conversation_ids:[oldA,oldB].sort(),sent_at:payload.message.sentAt};
});
after(async()=>pg?.close());
test('conversation recovery: rehearsal rolls back every route, new row, private ledger and queue change',async()=>{
 const rehearsal=await prepareConversationRecovery(plan),apply=await prepareConversationRecovery(plan,{commit:true});assert.equal(rehearsal.replace('ROLLBACK;','COMMIT;'),apply);
 assert.ok(!/DELETE FROM|TRUNCATE|GRANT /.test(apply));await execute(rehearsal);
 assert.deepEqual(await owner('SELECT * FROM nina_clinic.conversations ORDER BY id'),beforeConvos);assert.deepEqual(await owner('SELECT * FROM nina_clinic.messages ORDER BY id'),beforeMessages);
 assert.equal((await owner('SELECT count(*)::int n FROM nina_channels.conversation_links'))[0].n,0);
 assert.equal((await owner("SELECT to_regnamespace('nina_review_20261105')::text n"))[0].n,null);
 assert.equal((await owner('SELECT status FROM nina_channels.zernio_inbox'))[0].status,'needs_review');
});
test('conversation recovery: new human-paused route preserves old controls and normal worker processes once',async()=>{
 await execute(await prepareConversationRecovery(plan,{commit:true}));
 await assert.rejects(db.query('SELECT * FROM nina_review_20261105.conversation_recovery'),/permission denied/);
 await worker.runOnce();assert.equal((await owner('SELECT status FROM nina_channels.zernio_inbox'))[0].status,'processed');
 assert.deepEqual(await owner('SELECT * FROM nina_clinic.conversations WHERE id=ANY($1::uuid[]) ORDER BY id',[[oldA,oldB]]),beforeConvos);
 assert.deepEqual(await owner('SELECT * FROM nina_clinic.messages WHERE id=ANY($1::uuid[]) ORDER BY id',[beforeMessages.map(m=>m.id)]),beforeMessages);
 const [message]=await owner('SELECT conversation_id,from_type,content,processed_by_nina FROM nina_clinic.messages WHERE whatsapp_message_id=$1',[plan.provider_message_id]);
 assert.equal(message.conversation_id,plan.new_conversation_id);assert.equal(message.from_type,'external');assert.equal(message.content,payload.message.text);assert.equal(message.processed_by_nina,false);
 const [convo]=await owner('SELECT status,ai_paused,assigned_user_id FROM nina_clinic.conversations WHERE id=$1',[plan.new_conversation_id]);assert.deepEqual(convo,{status:'human',ai_paused:true,assigned_user_id:null});
 payload.id=randomUUID();await enqueue(payload);await worker.runOnce();assert.equal((await owner('SELECT count(*)::int n FROM nina_clinic.messages WHERE whatsapp_message_id=$1',[plan.provider_message_id]))[0].n,1);
 await assert.rejects(execute(await prepareConversationRecovery(plan,{commit:true})),/RECOVERY_ALREADY_APPLIED/);
});
test('conversation recovery: new conflicting peers, routes, receipt changes or history invalidate the plan',async()=>{
 for(const patch of [{payload_sha256:'0'.repeat(64)},{contact_id:randomUUID()},{historical_conversation_ids:[oldA,randomUUID()]}]){
  await assert.rejects(execute(await prepareConversationRecovery({...plan,...patch},{commit:true})),/RECOVERY_(RECEIPT|PEER|HISTORY)_CHANGED/);
  assert.equal((await owner('SELECT count(*)::int n FROM nina_clinic.conversations'))[0].n,2);
 }
 await owner("INSERT INTO nina_channels.conversation_links VALUES($1,'internal','internal-fixture',$2)",[scope.accountId,oldA]);
 await assert.rejects(execute(await prepareConversationRecovery(plan,{commit:true})),/RECOVERY_LINK_ALREADY_EXISTS/);
 assert.equal((await owner('SELECT status FROM nina_channels.zernio_inbox'))[0].status,'needs_review');
});
test('conversation recovery: malformed IDs, unknown fields and duplicate candidate IDs are refused before SQL generation',async()=>{
 for(const patch of [{account_id:'wrong'},{provider_conversation_id:'bad\u0000id'},{historical_conversation_ids:[oldA,oldA]},
  {peer_keys:[{kind:'phone',value:'5511999990000'}]},{unreviewed:'field'},{new_conversation_id:oldA}])await assert.rejects(prepareConversationRecovery({...plan,...patch}),/INVALID_RECOVERY_PLAN/);
 const unrelated=await owner('SELECT count(*)::int n FROM nina_clinic.messages');assert.equal(unrelated[0].n,2);
});
test('conversation recovery: an assigned historical conversation requires separate review instead of dropping its assignment',async()=>{
 await owner("UPDATE nina_clinic.conversations SET assigned_team='suporte' WHERE id=$1",[oldA]);
 await assert.rejects(execute(await prepareConversationRecovery(plan,{commit:true})),/RECOVERY_ASSIGNED_HISTORY/);
 assert.equal((await owner('SELECT count(*)::int n FROM nina_clinic.conversations'))[0].n,2);
 assert.equal((await owner('SELECT assigned_team FROM nina_clinic.conversations WHERE id=$1',[oldA]))[0].assigned_team,'suporte');
});
