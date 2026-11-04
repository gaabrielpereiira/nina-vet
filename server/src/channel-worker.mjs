import {createHash,randomUUID} from 'node:crypto';
import {decryptInbox} from './zernio-webhook.mjs';
import {normalizeZernioEvent,ChannelEventError} from './zernio-events.mjs';
import {ChannelMediaError} from './channel-media.mjs';

const sqlCodes=new Set(['CHANNEL_SCOPE_NOT_CONFIGURED','CHANNEL_PLAN_MISMATCH','CHANNEL_AMBIGUOUS_CONTACT',
 'CHANNEL_AMBIGUOUS_CONVERSATION','CHANNEL_MISSING_PEER','CHANNEL_IDENTITY_CONFLICT','CHANNEL_MEDIA_CONFLICT']);
export function createChannelWorker({db,config,archive,log=()=>{}}) {
 let stopped=true,timer,running,activeAbort;
 const options=config.channelProcessing??{enabled:false};
 async function runOnce(){
  if(!options.enabled)return false;
  const lease=randomUUID(),scope=config.zernio;
  const [claimed]=await db.query('SELECT nina_channels.claim_job($1,$2,$3) AS job',[scope.accountId,scope.profileId,lease]);
  const job=claimed.job;if(!job)return false;
  const abort=new AbortController();activeAbort=abort;let heartbeatRunning=false,leaseLost=false;
  const heartbeat=setInterval(async()=>{
   if(heartbeatRunning)return;heartbeatRunning=true;
   try{const [r]=await db.query('SELECT nina_channels.heartbeat_job($1,$2) AS ok',[job.id,lease]);if(!r.ok){leaseLost=true;abort.abort();}}
   catch{leaseLost=true;abort.abort();}
   finally{heartbeatRunning=false;}
  },options.heartbeatMilliseconds??30000);heartbeat.unref();
  try{
   const raw=decryptInbox(job.payload_encrypted,scope.encryptionKey,{id:job.id,accountId:job.account_id,eventId:job.event_id});
   if(createHash('sha256').update(raw).digest('hex')!==job.payload_sha256)throw new ChannelEventError('CHANNEL_DIGEST_MISMATCH');
   let payload;try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new ChannelEventError('CHANNEL_INVALID_EVENT');}
   const plan=normalizeZernioEvent(payload,scope,job);
   const files=[];
   for(const attachment of plan.attachments??[]){
    if(abort.signal.aborted)throw new ChannelEventError('CHANNEL_LEASE_LOST');
    const stored=await archive.download({accountId:job.account_id,messageId:plan.provider_message_id,attachment,signal:abort.signal});
    files.push({index:attachment.index,type:attachment.type,original_type:attachment.original_type,
      is_sticker:attachment.is_sticker,voice:attachment.voice,id:stored.id,bytes:stored.bytes,
      mime:stored.mime,sha256:stored.sha256,filename:stored.filename});
   }
   if(leaseLost||abort.signal.aborted)throw new ChannelEventError('CHANNEL_LEASE_LOST');
   // Provider URLs never become query parameters or plaintext clinical metadata.
   const {attachments,...withoutUrls}=plan;
   const [result]=await db.query('SELECT nina_channels.apply_job($1,$2,$3::jsonb) AS result',[job.id,lease,{...withoutUrls,files}]);
   log({event:'channel_processing',result:result.result.status==='processed'?'processed':'lease_lost'});
  }catch(error){
   let code='CHANNEL_PROCESSING_FAILED',retry=false;
   if(error instanceof ChannelEventError)code=error.code;
   else if(error instanceof ChannelMediaError){code=error.code;retry=error.retryable;}
   else if(sqlCodes.has(error.message))code=error.message;
   else if(['40001','40P01','55P03','57014','23505','08006','08003','ECONNRESET','ECONNREFUSED'].includes(error.code)){code='CHANNEL_DATABASE_TRANSIENT';retry=true;}
   else if(error.code==='42501')code='CHANNEL_DATABASE_PERMISSION';
   else if(error.message==='INBOX_DECRYPT_FAILED')code='CHANNEL_DECRYPT_FAILED';
   if(!leaseLost){
    const [r]=await db.query('SELECT nina_channels.fail_job($1,$2,$3,$4) AS ok',[job.id,lease,code,retry]);
    if(r.ok)log({event:'channel_processing',result:retry?'retry_scheduled':'needs_review',code});
   }
  }finally{clearInterval(heartbeat);if(activeAbort===abort)activeAbort=null;}
  return true;
 }
 async function tick(){
  if(stopped)return;running=runOnce();
  try{await running;}catch{log({event:'channel_worker_failed',code:'CHANNEL_WORKER_ERROR'});}
  finally{running=null;if(!stopped){timer=setTimeout(tick,options.pollMilliseconds??5000);timer.unref();}}
 }
 return {runOnce,start(){if(stopped&&options.enabled){stopped=false;timer=setTimeout(tick,0);timer.unref();}},
  async stop(){stopped=true;clearTimeout(timer);activeAbort?.abort();await running?.catch(()=>{});}};
}
