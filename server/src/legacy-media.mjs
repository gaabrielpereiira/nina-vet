import {createHash} from 'node:crypto';
import {mediaId,ChannelMediaError} from './channel-media.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fileUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest=/^[a-f0-9]{64}$/;
const mime=/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
export class LegacyMediaError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new LegacyMediaError(code);};
export function legacyMediaPlan(rows,{origin,accountId}) {
 let base;try{base=new URL(origin);}catch{fail('LEGACY_INVALID_ORIGIN');}
 if(base.protocol!=='https:'||base.origin!==origin||!/^[a-z0-9]{20}\.supabase\.co$/.test(base.hostname)||base.username||base.password||!/^[a-f0-9]{24}$/.test(accountId??''))fail('LEGACY_INVALID_ORIGIN');
 if(!Array.isArray(rows)||!rows.length||rows.length>5000)fail('LEGACY_INVALID_PLAN');
 const messageIds=new Set(),fileIds=new Set();
 return rows.map(row=>{
  if(!uuid.test(row?.id??'')||typeof row.media_url!=='string'||row.media_url.length>4096)fail('LEGACY_INVALID_PLAN');
  const messageId=row.id.toLowerCase();let url;try{url=new URL(row.media_url);}catch{fail('LEGACY_INVALID_SOURCE');}
  if(url.origin!==origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/storage/v1/object/public/audio-messages/')||url.pathname.endsWith('/'))fail('LEGACY_INVALID_SOURCE');
  const providerId=row.whatsapp_message_id;
  if(providerId!==null&&providerId!==undefined&&(typeof providerId!=='string'||!providerId||providerId.length>512||/[\x00-\x1f\x7f]/.test(providerId)))fail('LEGACY_INVALID_PLAN');
  const key=providerId??'nina-legacy:'+messageId,id=mediaId(accountId,key,0);
  if(messageIds.has(messageId)||fileIds.has(id))fail('LEGACY_DUPLICATE_IDENTITY');messageIds.add(messageId);fileIds.add(id);
  const filename=typeof row.file_name==='string'?row.file_name.replace(/[\x00-\x1f\x7f\\/]/g,'_').slice(0,240):null;
  return {message_id:messageId,file_id:id,source_sha256:createHash('sha256').update(row.media_url).digest('hex'),
   accountId,messageId:key,attachment:{index:0,url:url.href,filename}};
 });
}
export async function copyLegacyMedia(plan,{archive,onProgress=()=>{},pause=()=>new Promise(r=>setTimeout(r,1000)),signal}) {
 const rows=[],failed=[];let totalBytes=0;
 for(const item of plan){
  if(signal?.aborted)fail('LEGACY_COPY_ABORTED');
  let stored,error;
  for(let attempt=0;attempt<3;attempt++){
   try{stored=await archive.download({...item,signal});error=null;break;}
   catch(e){error=e;if(!(e instanceof ChannelMediaError)||!e.retryable||attempt===2)break;await pause();}
  }
  if(error){failed.push({message_id:item.message_id,code:error instanceof ChannelMediaError?error.code:'LEGACY_MEDIA_FAILED'});}
  else{
   if(stored.id!==item.file_id||!Number.isSafeInteger(stored.bytes)||stored.bytes<1||stored.bytes>134217728||!digest.test(stored.sha256??'')||typeof stored.mime!=='string'||stored.mime.length>=150||!mime.test(stored.mime))fail('LEGACY_ARCHIVE_INVALID');
   rows.push({message_id:item.message_id,file_id:item.file_id,source_sha256:item.source_sha256,bytes:stored.bytes,sha256:stored.sha256,mime:stored.mime});totalBytes+=stored.bytes;
  }
  await onProgress({attempted:rows.length+failed.length,total:plan.length,copied:rows.length,failed:failed.length,bytes:totalBytes});
 }
 return {complete:failed.length===0,source_count:plan.length,rows,failed,total_bytes:totalBytes};
}
export function prepareLegacyMediaSql(manifest,migrations) {
 if(!manifest?.complete||manifest.failed?.length!==0||!/^[a-f0-9]{24}$/.test(manifest.account_id??'')||!fileUuid.test(manifest.run_id??'')||!Array.isArray(manifest.rows)||!manifest.rows.length||manifest.rows.length>5000||manifest.source_count!==manifest.rows.length)fail('LEGACY_INCOMPLETE_MANIFEST');
 if(!Array.isArray(migrations)||![6,7,8].includes(migrations.length)||migrations[5].version!=='0006_channel_processing.sql'||(migrations.length>=7&&migrations[6].version!=='0007_agent_settings.sql')||(migrations.length===8&&migrations[7].version!=='0008_whatsapp_pilot.sql')||migrations.some(m=>!/^\d{4}_[a-z0-9_]+\.sql$/.test(m.version)||!digest.test(m.checksum)))fail('LEGACY_SCHEMA_SOURCE_CHANGED');
 const nativeIds=new Set(),fileIds=new Set();
 for(const row of manifest.rows){if(!uuid.test(row.message_id??'')||!fileUuid.test(row.file_id??'')||!digest.test(row.source_sha256??'')||!digest.test(row.sha256??'')||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>134217728||typeof row.mime!=='string'||row.mime.length>=150||!mime.test(row.mime)||nativeIds.has(row.message_id)||fileIds.has(row.file_id))fail('LEGACY_INVALID_MANIFEST');nativeIds.add(row.message_id);fileIds.add(row.file_id);}
 const data=JSON.stringify(manifest.rows.map(({message_id,file_id,source_sha256,bytes,sha256,mime})=>({message_id,file_id,source_sha256,bytes,sha256,mime}))),fingerprint=createHash('sha256').update(data).digest('hex');let tag='nina_media_'+fingerprint.slice(0,16);while(data.includes('$'+tag+'$'))tag+='x';
 const expected=migrations.map(m=>"('"+m.version+"','"+m.checksum+"')").join(',');
 return `\\set ON_ERROR_STOP on
-- Run only after a fresh, verified backup. Metadata only; no grants or deletion.
-- Run ${manifest.run_id}; descriptor SHA-256 ${fingerprint}.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
SELECT pg_advisory_xact_lock(hashtextextended('nina-channel:${manifest.account_id}',0));
CREATE TEMP TABLE nina_legacy_media_plan ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($${tag}$${data}$${tag}$::jsonb)
 AS x(message_id uuid,file_id uuid,source_sha256 text,bytes bigint,sha256 text,mime text);
DO $guard$
DECLARE locked_count integer;
BEGIN
 IF current_database()<>'nina' OR NOT pg_has_role(current_user,'pg_database_owner','MEMBER') THEN RAISE EXCEPTION 'LEGACY_MAINTENANCE_ONLY'; END IF;
 IF (SELECT count(*) FROM nina_meta.schema_migrations)<>${migrations.length} OR EXISTS(
 SELECT 1 FROM(VALUES ${expected}) expected(version,checksum) LEFT JOIN nina_meta.schema_migrations actual USING(version)
 WHERE actual.checksum IS DISTINCT FROM expected.checksum) THEN RAISE EXCEPTION 'LEGACY_SCHEMA_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nina_channels.processor_scope WHERE account_id='${manifest.account_id}') THEN RAISE EXCEPTION 'LEGACY_ACCOUNT_MISMATCH'; END IF;
 PERFORM m.id FROM nina_clinic.messages m JOIN pg_temp.nina_legacy_media_plan p ON p.message_id=m.id ORDER BY m.id FOR UPDATE OF m;
 GET DIAGNOSTICS locked_count=ROW_COUNT;
 IF locked_count<>${manifest.rows.length} THEN RAISE EXCEPTION 'LEGACY_MESSAGE_MISSING'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.nina_legacy_media_plan p JOIN nina_clinic.messages m ON m.id=p.message_id
 WHERE encode(sha256(convert_to(coalesce(m.media_url,''),'UTF8')),'hex')<>p.source_sha256
 AND m.media_url IS DISTINCT FROM '/v1/files/'||p.file_id) THEN RAISE EXCEPTION 'LEGACY_SOURCE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.nina_legacy_media_plan p JOIN nina_channels.media_files f ON f.id=p.file_id
 WHERE f.account_id<>'${manifest.account_id}' OR f.byte_count<>p.bytes OR f.sha256<>p.sha256 OR f.mime<>p.mime) THEN RAISE EXCEPTION 'LEGACY_FILE_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.nina_legacy_media_plan p JOIN nina_channels.message_files mf ON mf.message_id=p.message_id AND mf.position=0 WHERE mf.file_id<>p.file_id) THEN RAISE EXCEPTION 'LEGACY_LINK_CONFLICT'; END IF;
END $guard$;
INSERT INTO nina_channels.media_files(id,account_id,byte_count,sha256,mime,display_name)
SELECT p.file_id,'${manifest.account_id}',p.bytes,p.sha256,p.mime,left(nullif(m.metadata->>'file_name',''),240)
FROM pg_temp.nina_legacy_media_plan p JOIN nina_clinic.messages m ON m.id=p.message_id ON CONFLICT DO NOTHING;
INSERT INTO nina_channels.message_files(message_id,position,file_id,type,original_type,is_sticker,voice)
SELECT p.message_id,0,p.file_id,
CASE WHEN m.type::text IN('image','audio','video','document') THEN m.type::text WHEN p.mime LIKE 'image/%' THEN 'image' WHEN p.mime LIKE 'audio/%' THEN 'audio' WHEN p.mime LIKE 'video/%' THEN 'video' ELSE 'document' END,
left(coalesce(nullif(m.metadata->>'original_type',''),m.type::text),50),coalesce(m.metadata->>'is_sticker','false')='true',false
FROM pg_temp.nina_legacy_media_plan p JOIN nina_clinic.messages m ON m.id=p.message_id ON CONFLICT DO NOTHING;
UPDATE nina_clinic.messages m SET media_url='/v1/files/'||p.file_id,media_type=p.mime
FROM pg_temp.nina_legacy_media_plan p WHERE m.id=p.message_id;
SELECT json_build_object('event','legacy_media_links_applied','messages',count(*),'verified',bool_and(m.media_url='/v1/files/'||p.file_id AND mf.file_id=p.file_id))
FROM pg_temp.nina_legacy_media_plan p JOIN nina_clinic.messages m ON m.id=p.message_id JOIN nina_channels.message_files mf ON mf.message_id=m.id AND mf.position=0;
COMMIT;
`;
}
