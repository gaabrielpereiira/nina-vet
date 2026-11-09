// Owner-only recovery for an evidenced legacy conversation collision. No sends or grants.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readMigrations} from '../src/migrations.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id=v=>typeof v==='string'&&v.length>=1&&v.length<=512&&!/[\x00-\x20\x7f]/.test(v);
const keys=['job_id','event_id','account_id','profile_id','payload_sha256','contact_id','new_conversation_id',
 'provider_message_id','provider_conversation_id','platform_conversation_id','peer_keys','historical_conversation_ids','sent_at'];
export async function prepareConversationRecovery(plan,{commit=false}={}){
 if(!plan||Object.keys(plan).length!==keys.length||keys.some(k=>!Object.hasOwn(plan,k))||
  ['job_id','event_id','contact_id','new_conversation_id'].some(k=>!uuid.test(plan[k]??''))||
  plan.new_conversation_id===plan.contact_id||!['account_id','profile_id'].every(k=>/^[a-f0-9]{24}$/.test(plan[k]??''))||
  !/^[a-f0-9]{64}$/.test(plan.payload_sha256??'')||!id(plan.provider_message_id)||!id(plan.provider_conversation_id)||
  (plan.platform_conversation_id!==null&&!id(plan.platform_conversation_id))||
  !Array.isArray(plan.peer_keys)||plan.peer_keys.length!==1||plan.peer_keys[0]?.kind!=='platform'||!id(plan.peer_keys[0]?.value)||Object.keys(plan.peer_keys[0]).length!==2||
  !Array.isArray(plan.historical_conversation_ids)||plan.historical_conversation_ids.length<2||plan.historical_conversation_ids.length>1000||
  plan.historical_conversation_ids.some(v=>!uuid.test(v))||new Set(plan.historical_conversation_ids).size!==plan.historical_conversation_ids.length||
  plan.historical_conversation_ids.includes(plan.new_conversation_id)||typeof plan.sent_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(plan.sent_at)||!Number.isFinite(Date.parse(plan.sent_at)))throw Error('INVALID_RECOVERY_PLAN');
 const migrations=(await readMigrations()).slice(0,7);if(migrations.length!==7||migrations[6].version!=='0007_agent_settings.sql')throw Error('UNEXPECTED_RECOVERY_SOURCE');
 const expected=migrations.map(m=>"('"+m.version+"','"+m.checksum+"')").join(',');
 const data=JSON.stringify(plan),digest=createHash('sha256').update(data).digest('hex');let tag='nina_recovery_'+digest.slice(0,16);while(data.includes('$'+tag+'$'))tag+='x';
 return `\\set ON_ERROR_STOP on
-- Preserve every old conversation; route only the verified provider thread to a new human-paused conversation.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE nina_recovery_input ON COMMIT DROP AS SELECT $${tag}$${data}$${tag}$::jsonb p;
SELECT pg_advisory_xact_lock(hashtextextended('nina-channel:'||(SELECT p->>'account_id' FROM nina_recovery_input),0));
DO $guard$
DECLARE p jsonb; peers uuid[]; existing_ids uuid[]; expected_ids uuid[]; job nina_channels.zernio_inbox%ROWTYPE;
BEGIN
 SELECT i.p INTO p FROM pg_temp.nina_recovery_input i;
 IF current_database()<>'nina' OR current_user<>'nina_owner' THEN RAISE EXCEPTION 'RECOVERY_WRONG_TARGET';END IF;
 IF (SELECT count(*) FROM nina_meta.schema_migrations)<>7 OR EXISTS(SELECT 1 FROM(VALUES ${expected}) expected(version,checksum) LEFT JOIN nina_meta.schema_migrations actual USING(version) WHERE actual.checksum IS DISTINCT FROM expected.checksum) THEN RAISE EXCEPTION 'RECOVERY_SCHEMA_CHANGED';END IF;
 IF to_regnamespace('nina_review_20261105') IS NOT NULL THEN RAISE EXCEPTION 'RECOVERY_ALREADY_APPLIED';END IF;
 IF NOT EXISTS(SELECT 1 FROM nina_channels.processor_scope WHERE account_id=p->>'account_id' AND profile_id=p->>'profile_id') THEN RAISE EXCEPTION 'RECOVERY_SCOPE_CHANGED';END IF;
 SELECT * INTO job FROM nina_channels.zernio_inbox WHERE id=(p->>'job_id')::uuid FOR UPDATE;
 IF NOT FOUND OR job.account_id IS DISTINCT FROM p->>'account_id' OR job.event_id::text IS DISTINCT FROM p->>'event_id'
 OR job.payload_sha256 IS DISTINCT FROM p->>'payload_sha256' OR job.status<>'needs_review' OR job.event_type<>'message.sent'
 OR job.last_error_code IS DISTINCT FROM 'CHANNEL_AMBIGUOUS_CONVERSATION' OR job.lease_token IS NOT NULL OR job.attempts>=5 THEN RAISE EXCEPTION 'RECOVERY_RECEIPT_CHANGED';END IF;
 SELECT array_agg(DISTINCT contact_id ORDER BY contact_id) INTO peers FROM(
  SELECT l.contact_id FROM nina_channels.peer_links l,jsonb_array_elements(p->'peer_keys') k WHERE l.account_id=p->>'account_id' AND l.kind=k->>'kind' AND l.external_id=k->>'value'
  UNION SELECT c.id FROM nina_clinic.contacts c,jsonb_array_elements(p->'peer_keys') k WHERE k->>'kind'='platform' AND c.whatsapp_id=k->>'value'
 ) candidates;
 IF peers IS DISTINCT FROM ARRAY[(p->>'contact_id')::uuid] THEN RAISE EXCEPTION 'RECOVERY_PEER_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM nina_channels.conversation_links WHERE account_id=p->>'account_id' AND ((kind='internal' AND external_id=p->>'provider_conversation_id') OR(kind='platform' AND external_id=p->>'platform_conversation_id')))
 OR EXISTS(SELECT 1 FROM nina_channels.message_links WHERE account_id=p->>'account_id' AND external_id=p->>'provider_message_id')
 OR EXISTS(SELECT 1 FROM nina_clinic.messages WHERE whatsapp_message_id=p->>'provider_message_id') THEN RAISE EXCEPTION 'RECOVERY_LINK_ALREADY_EXISTS';END IF;
 IF EXISTS(SELECT 1 FROM nina_clinic.conversations WHERE id=(p->>'new_conversation_id')::uuid) THEN RAISE EXCEPTION 'RECOVERY_NEW_ID_COLLISION';END IF;
 PERFORM c.id FROM nina_clinic.conversations c WHERE c.zernio_conversation_id IN(p->>'provider_conversation_id',p->>'platform_conversation_id') ORDER BY c.id FOR SHARE;
 SELECT array_agg(id ORDER BY id) INTO existing_ids FROM nina_clinic.conversations WHERE zernio_conversation_id IN(p->>'provider_conversation_id',p->>'platform_conversation_id');
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO expected_ids FROM jsonb_array_elements_text(p->'historical_conversation_ids');
 IF existing_ids IS DISTINCT FROM expected_ids OR EXISTS(SELECT 1 FROM nina_clinic.conversations WHERE id=ANY(existing_ids) AND contact_id<>(p->>'contact_id')::uuid) THEN RAISE EXCEPTION 'RECOVERY_HISTORY_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM nina_clinic.conversations WHERE id=ANY(existing_ids) AND (assigned_user_id IS NOT NULL OR assigned_team IS NOT NULL)) THEN RAISE EXCEPTION 'RECOVERY_ASSIGNED_HISTORY';END IF;
END $guard$;
CREATE SCHEMA nina_review_20261105;
REVOKE ALL ON SCHEMA nina_review_20261105 FROM PUBLIC;
CREATE TABLE nina_review_20261105.conversation_recovery(job_id uuid PRIMARY KEY,plan_sha256 text NOT NULL,new_conversation_id uuid NOT NULL,
 historical_hashes jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON nina_review_20261105.conversation_recovery FROM PUBLIC;
INSERT INTO nina_review_20261105.conversation_recovery(job_id,plan_sha256,new_conversation_id,historical_hashes)
SELECT (p->>'job_id')::uuid,'${digest}',(p->>'new_conversation_id')::uuid,
 (SELECT jsonb_object_agg(c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex')) FROM nina_clinic.conversations c
 WHERE c.id IN(SELECT value::uuid FROM jsonb_array_elements_text(p->'historical_conversation_ids')))
FROM nina_recovery_input;
INSERT INTO nina_clinic.conversations(id,contact_id,status,is_active,ai_paused,ai_paused_reason,zernio_conversation_id,started_at,last_message_at,metadata)
SELECT (p->>'new_conversation_id')::uuid,(p->>'contact_id')::uuid,'human',true,true,'Vínculo atual recuperado após migração',
 p->>'provider_conversation_id',(p->>'sent_at')::timestamptz,(p->>'sent_at')::timestamptz,
 jsonb_build_object('source','zernio_recovery','recovery_event',p->>'job_id','preserved_history_count',jsonb_array_length(p->'historical_conversation_ids')) FROM nina_recovery_input;
INSERT INTO nina_channels.conversation_links(account_id,kind,external_id,conversation_id)
SELECT p->>'account_id','internal',p->>'provider_conversation_id',(p->>'new_conversation_id')::uuid FROM nina_recovery_input
UNION ALL SELECT p->>'account_id','platform',p->>'platform_conversation_id',(p->>'new_conversation_id')::uuid FROM nina_recovery_input WHERE p->>'platform_conversation_id' IS NOT NULL;
UPDATE nina_channels.zernio_inbox r SET status='pending',available_at=clock_timestamp(),processed_at=NULL,last_error_code=NULL
FROM nina_recovery_input i WHERE r.id=(i.p->>'job_id')::uuid;
DO $verify$ DECLARE p jsonb; current_hashes jsonb; BEGIN
 SELECT i.p INTO p FROM pg_temp.nina_recovery_input i;
 SELECT jsonb_object_agg(c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex')) INTO current_hashes FROM nina_clinic.conversations c
 WHERE c.id IN(SELECT value::uuid FROM jsonb_array_elements_text(p->'historical_conversation_ids'));
 IF current_hashes IS DISTINCT FROM(SELECT historical_hashes FROM nina_review_20261105.conversation_recovery)
 OR NOT EXISTS(SELECT 1 FROM nina_clinic.conversations WHERE id=(p->>'new_conversation_id')::uuid AND contact_id=(p->>'contact_id')::uuid AND status='human' AND ai_paused AND assigned_user_id IS NULL)
 OR has_schema_privilege('nina_app','nina_review_20261105','USAGE') THEN RAISE EXCEPTION 'RECOVERY_VERIFICATION_FAILED';END IF;
END $verify$;
SELECT json_build_object('event','conversation_recovery_validated','historical_conversations_preserved',jsonb_array_length(p->'historical_conversation_ids'),
 'new_human_paused_conversation',true,'receipt_requeued',true,'new_grants',false,'outbound_messages',0) FROM nina_recovery_input;
${commit?'COMMIT;':'ROLLBACK;'}
`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(!['rehearse','apply'].includes(process.argv[3]))throw Error('INVALID_MODE');const raw=await readFile(process.argv[2]);if(raw.length>131072)throw Error('PLAN_TOO_LARGE');process.stdout.write(await prepareConversationRecovery(JSON.parse(raw),{commit:process.argv[3]==='apply'}));}
 catch{console.error('Não foi possível preparar a recuperação. Confira o plano e a versão.');process.exitCode=1;}
}
