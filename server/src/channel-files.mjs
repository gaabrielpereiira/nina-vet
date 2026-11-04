import {promises as fs,constants} from 'node:fs';
import {Readable} from 'node:stream';
import {filePath} from './channel-media.mjs';
import {ApiError} from './errors.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const inline=new Set(['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/ogg','audio/wav','audio/mp4','audio/aac','audio/webm','video/mp4','video/webm']);
export function byteRange(value,size){
 if(value===null)return {start:0,end:size-1,partial:false};
 const match=/^bytes=(\d{0,16})-(\d{0,16})$/.exec(value);
 if(!match||(!match[1]&&!match[2]))return null;
 let start=match[1]?Number(match[1]):null,end=match[2]?Number(match[2]):null;
 if((start!==null&&!Number.isSafeInteger(start))||(end!==null&&!Number.isSafeInteger(end)))return null;
 if(start===null){if(end<1)return null;start=Math.max(0,size-end);end=size-1;}else{end=end===null?size-1:Math.min(size-1,end);}
 if(start<0||start>=size||end<start)return null;
 return {start,end,partial:true};
}
export function createChannelFiles(db,auth,config){
 return async request=>{
  const {user}=await auth.authenticate(request);
  if(!config.media?.enabled)throw new ApiError(503,'MEDIA_DISABLED','Os arquivos ainda não estão disponíveis.');
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'ORIGIN_DENIED','Origem não permitida.');
  const url=new URL(request.url),id=url.pathname.slice('/v1/files/'.length);
  if(!uuid.test(id)||[...url.searchParams].some(([key,value])=>key!=='download'||value!=='1')||url.searchParams.getAll('download').length>1)throw new ApiError(400,'INVALID_QUERY','Arquivo inválido.');
  const row=await db.transaction(async tx=>{
   await tx.query("SELECT set_config('nina.user_id',$1,true)",[user.id]);
   return (await tx.query('SELECT id,byte_count,sha256,mime,display_name FROM nina_channels.media_files WHERE id=$1',[id]))[0];
  });
  if(!row)throw new ApiError(404,'NOT_FOUND','Arquivo não encontrado.');
  let handle;
  try{
   handle=await fs.open(filePath(config.media.directory,id.toLowerCase()),constants.O_RDONLY|constants.O_NOFOLLOW);
   const stat=await handle.stat();if(!stat.isFile()||stat.size!==Number(row.byte_count))throw Error('INVALID_FILE');
   const headers=new Headers({'content-type':row.mime,'cache-control':'no-store','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; sandbox",'cross-origin-resource-policy':'same-site',
    'accept-ranges':'bytes','referrer-policy':'no-referrer'});
   const name=(row.display_name||'arquivo').replace(/[\x00-\x1f\x7f\\/]/g,'_').slice(0,240);
   const encoded=encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
   const disposition=inline.has(row.mime)&&!url.searchParams.has('download')?'inline':'attachment';
   headers.set('content-disposition',disposition+'; filename="arquivo"; filename*=UTF-8\'\''+encoded);
   const range=byteRange(request.headers.has('if-range')?null:request.headers.get('range'),stat.size);
   if(!range){headers.set('content-range','bytes */'+stat.size);await handle.close();handle=null;return new Response(null,{status:416,headers});}
   headers.set('content-length',String(range.end-range.start+1));if(range.partial)headers.set('content-range','bytes '+range.start+'-'+range.end+'/'+stat.size);
   if(request.method==='HEAD'){await handle.close();handle=null;return new Response(null,{status:range.partial?206:200,headers});}
   const stream=handle.createReadStream({start:range.start,end:range.end,autoClose:true});handle=null;
   return new Response(Readable.toWeb(stream),{status:range.partial?206:200,headers});
  }catch{await handle?.close().catch(()=>{});throw new ApiError(503,'MEDIA_UNAVAILABLE','Não foi possível abrir este arquivo.');}
 };
}
