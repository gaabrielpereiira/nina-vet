// Stage private copies and a guarded maintenance SQL file. Never applies SQL.
import {randomUUID,hkdfSync} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {readConfig} from '../src/config.mjs';
import {createDatabase,assertRuntimeRole} from '../src/database.mjs';
import {createMediaArchive} from '../src/channel-media.mjs';
import {encryptInbox} from '../src/zernio-webhook.mjs';
import {legacyMediaPlan,copyLegacyMedia,prepareLegacyMediaSql} from '../src/legacy-media.mjs';
import {readMigrations} from '../src/migrations.mjs';
let db;
try{
 const config=readConfig(),origin=process.env.NINA_LEGACY_STORAGE_ORIGIN;
 if(!config.media.enabled||!config.zernio.encryptionKey)throw Error('LEGACY_FEATURES_NOT_READY');
 const limit=Number(process.env.NINA_LEGACY_LIMIT??5000);if(!Number.isInteger(limit)||limit<1||limit>5000)throw Error('LEGACY_LIMIT_INVALID');
 db=createDatabase({...config.database,max:1});await assertRuntimeRole(db);
 const rows=await db.transaction(async tx=>{
  const[staff]=await tx.query("SELECT u.id FROM nina_auth.users u WHERE u.disabled_at IS NULL AND EXISTS(SELECT 1 FROM nina_auth.user_roles r WHERE r.user_id=u.id AND r.role='admin') ORDER BY u.id LIMIT 1");
  if(!staff)throw Error('LEGACY_ADMIN_MISSING');await tx.query("SELECT set_config('nina.user_id',$1,true)",[staff.id]);
  return tx.query("SELECT id,whatsapp_message_id,media_url,media_type,type,metadata->>'file_name' AS file_name FROM nina_clinic.messages WHERE media_url LIKE 'https://%.supabase.co/storage/v1/object/public/audio-messages/%' ORDER BY sent_at,id LIMIT $1",[limit]);
 });
 if(!rows.length){console.log(JSON.stringify({event:'legacy_media_copy',complete:true,copied:0,database_writes:false}));}
 else{
  const plan=legacyMediaPlan(rows,{origin,accountId:config.zernio.accountId}),runId=randomUUID(),directory=path.join(config.media.directory,'legacy-migration-'+runId);
  await fs.mkdir(directory,{mode:0o700});
  const key=Buffer.from(hkdfSync('sha256',config.zernio.encryptionKey,'nina-media-migration-v1','legacy-source-plan',32));
  await fs.writeFile(path.join(directory,'source-plan.enc'),encryptInbox(Buffer.from(JSON.stringify(rows)),key,{id:runId,accountId:config.zernio.accountId,eventId:runId}),{mode:0o600,flag:'wx'});
  const archive=createMediaArchive({...config.media,accountId:config.zernio.accountId,apiKey:config.zernio.apiKey});
  let latest;
  const result=await copyLegacyMedia(plan,{archive,onProgress:async progress=>{latest=progress;if(progress.attempted===1||progress.attempted%10===0||progress.attempted===plan.length){await fs.writeFile(path.join(directory,'progress.json'),JSON.stringify(progress),{mode:0o600});console.log(JSON.stringify({event:'legacy_media_copy_progress',...progress}));}}});
  const manifest={version:1,run_id:runId,account_id:config.zernio.accountId,...result};
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest),{mode:0o600,flag:'wx'});
  if(result.complete)await fs.writeFile(path.join(directory,'apply.sql'),prepareLegacyMediaSql(manifest,await readMigrations()),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({event:'legacy_media_copy',run_id:runId,run_directory:directory,complete:result.complete,...latest,database_writes:false,sql_prepared:result.complete}));
  if(!result.complete)process.exitCode=1;
 }
}catch(error){console.log(JSON.stringify({event:'legacy_media_copy',complete:false,code:/^[A-Z][A-Z0-9_]{1,70}$/.test(error.code??'')?error.code:'LEGACY_COPY_FAILED'}));process.exitCode=1;}
finally{await db?.close();}
