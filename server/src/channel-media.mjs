import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

export class ChannelMediaError extends Error {
  constructor(code, retryable = false) { super(code); this.code = code; this.retryable = retryable; }
}
const fail = (code, retryable = false) => { throw new ChannelMediaError(code, retryable); };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ipNumber = ip => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const denied = [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]
  .map(([ip,bits])=>[ipNumber(ip),2 ** (32-bits)]);
export function isPublicIpv4(ip) {
  if (isIP(ip) !== 4) return false;
  const n = ipNumber(ip); return !denied.some(([base,size])=>n>=base&&n<base+size);
}
export function mediaId(accountId, messageId, index) {
  const h = createHash('sha256').update(JSON.stringify([accountId,messageId,index])).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${((parseInt(h[16],16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
}
function safeUrl(raw) {
  let url; try { url = new URL(raw); } catch { fail('MEDIA_INVALID_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || url.href.length > 4096) fail('MEDIA_INVALID_URL');
  return url;
}
async function addressFor(hostname, lookup) {
  const literal=hostname.startsWith('[')&&hostname.endsWith(']')?hostname.slice(1,-1):hostname;
  if (isIP(literal)) { if (!isPublicIpv4(literal)) fail('MEDIA_PRIVATE_ADDRESS'); return literal; }
  let addresses;
  try { addresses = await lookup(hostname, { family:4, all:true, verbatim:true }); }
  catch { fail('MEDIA_DNS_FAILED', true); }
  if (!addresses.length || addresses.some(a=>!isPublicIpv4(a.address))) fail('MEDIA_PRIVATE_ADDRESS');
  return addresses[0].address;
}

// Pin the already checked public IP. TLS still authenticates the original hostname.
export function createPinnedTransport(request=httpsRequest) { return function transport({url,address,headers,signal}) {
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',headers,signal,agent:false,rejectUnauthorized:true,
      maxHeaderSize:16384,servername:isIP(url.hostname)?undefined:url.hostname,
      lookup:(_host,options,callback)=>{if(options?.all)callback(null,[{address,family:4}]);else callback(null,address,4);}},response=>{
      resolve({status:response.statusCode,headers:response.headers,body:response});
    });
    req.on('error',()=>reject(new ChannelMediaError('MEDIA_NETWORK_FAILED',true)));req.end();
  });
}; }
const transport=createPinnedTransport();
async function writeAll(handle, buffer) {
  let offset=0; while(offset<buffer.length){const {bytesWritten}=await handle.write(buffer,offset,buffer.length-offset);if(!bytesWritten)fail('MEDIA_STORAGE_FAILED',true);offset+=bytesWritten;}
}
async function hashFile(filename, maximum) {
  const handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=await handle.stat();if(!stat.isFile()||stat.size>maximum)fail('MEDIA_CACHE_INVALID');
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;if(bytes>maximum)fail('MEDIA_CACHE_INVALID');hash.update(chunk);}
    return {bytes,sha256:hash.digest('hex')};
  } finally {await handle.close();}
}
export function filePath(directory,id) {if(!uuid.test(id))fail('MEDIA_INVALID_ID');return path.join(directory,id+'.blob');}

export function createMediaArchive(config, dependencies={}) {
  const lookup=dependencies.lookup??dnsLookup, send=dependencies.transport??transport;
  const statfs=dependencies.statfs??fs.statfs;
  const maximum=config.maxBytes??100*1024*1024, minimumFree=config.minFreeBytes??2*1024*1024*1024;
  if(!path.isAbsolute(config.directory)||!Number.isSafeInteger(maximum)||maximum<1||maximum>128*1024*1024||
    !Number.isSafeInteger(minimumFree)||minimumFree<0)throw new Error('INVALID_MEDIA_CONFIGURATION');
  let prepared;
  const prepare=()=>prepared??=(async()=>{await fs.mkdir(config.directory,{recursive:true,mode:0o700});
    const info=await fs.lstat(config.directory);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)fail('MEDIA_STORAGE_PERMISSIONS');
    if(config.requireMarker){let marker;try{marker=await fs.readFile(path.join(config.directory,'.nina-volume-initialized'),'utf8');}catch{fail('MEDIA_STORAGE_NOT_INITIALIZED');}
      if(marker.trim()!=='nina-media-v1')fail('MEDIA_STORAGE_NOT_INITIALIZED');}
  })();
  async function cached(id) {
    const filename=filePath(config.directory,id), metadata=path.join(config.directory,id+'.json');
    let stat;
    try{stat=await fs.lstat(metadata);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)fail('MEDIA_CACHE_INVALID');
    let body;try{body=JSON.parse(await fs.readFile(metadata,'utf8'));}catch{fail('MEDIA_CACHE_INVALID');}
    if(body.id!==id||!Number.isSafeInteger(body.bytes)||body.bytes<1||body.bytes>maximum||
      !/^[a-f0-9]{64}$/.test(body.sha256??'')||!validMime(body.mime))fail('MEDIA_CACHE_INVALID');
    const actual=await hashFile(filename,maximum);
    if(actual.bytes!==body.bytes||actual.sha256!==body.sha256)fail('MEDIA_CACHE_INVALID');
    return body;
  }
  async function download({accountId,messageId,attachment,signal}) {
    await prepare();const id=mediaId(accountId,messageId,attachment.index);
    const existing=await cached(id);if(existing)return {...existing,filename:attachment.filename};
    const disk=await statfs(config.directory);if(Number(disk.bavail)*Number(disk.bsize)<minimumFree+maximum)fail('MEDIA_STORAGE_FULL');
    let url=safeUrl(attachment.url),authenticated=false;
    if(url.hostname==='zernio.com'){
      if(!/^\/api\/v1\/whatsapp\/media\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname))fail('MEDIA_PROVIDER_PATH_DENIED');
      const accounts=url.searchParams.getAll('accountId');
      if(accounts.length>1||(accounts.length===1&&accounts[0]!==accountId)||accountId!==config.accountId)fail('MEDIA_ACCOUNT_MISMATCH');
      if(!config.apiKey||!/^[\x21-\x7e]{32,512}$/.test(config.apiKey))fail('MEDIA_KEY_MISSING');
      url=new URL(url.origin+url.pathname);url.searchParams.set('accountId',accountId);authenticated=true;
    }
    const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(config.timeoutMs??60000)]);
    let response;
    for(let redirects=0;;redirects++){
      const address=await addressFor(url.hostname,lookup);
      response=await send({url,address,signal:deadline,headers:{accept:'*/*','accept-encoding':'identity',
        ...(authenticated?{authorization:'Bearer '+config.apiKey}:{})}});
      if(![301,302,303,307,308].includes(response.status))break;
      response.body.destroy?.();
      if(authenticated||redirects>=2||!response.headers.location)fail('MEDIA_REDIRECT_DENIED');
      url=safeUrl(new URL(response.headers.location,url).href);
    }
    const body=response.body;
    if(response.status!==200){body.destroy?.();fail([401,403].includes(response.status)?'MEDIA_PROVIDER_PERMISSION':
      [404,410].includes(response.status)?'MEDIA_NOT_AVAILABLE':'MEDIA_HTTP_FAILED',[408,429].includes(response.status)||response.status>=500);}
    if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){body.destroy?.();fail('MEDIA_ENCODING_DENIED');}
    const length=response.headers['content-length'];
    if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>maximum)){body.destroy?.();fail('MEDIA_TOO_LARGE');}
    let mime=String(response.headers['content-type']??'application/octet-stream').split(';')[0].trim().toLowerCase();
    if(!validMime(mime))mime='application/octet-stream';
    const temporary=path.join(config.directory,'.part-'+randomUUID()), filename=filePath(config.directory,id);
    let handle,bytes=0;const hash=createHash('sha256');
    try{
      handle=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
      for await(const chunk of body){if(deadline.aborted)fail('MEDIA_NETWORK_FAILED',true);const buffer=Buffer.from(chunk);bytes+=buffer.length;
        if(bytes>maximum)fail('MEDIA_TOO_LARGE');hash.update(buffer);await writeAll(handle,buffer);}
      if(!bytes||(length!==undefined&&bytes!==Number(length)))fail('MEDIA_INCOMPLETE',true);
      await handle.sync();await handle.close();handle=null;
      const result={id,bytes,sha256:hash.digest('hex'),mime};
      try{await fs.link(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;
        const actual=await hashFile(filename,maximum);if(actual.bytes!==bytes||actual.sha256!==result.sha256)fail('MEDIA_CACHE_CONFLICT');}
      const meta=path.join(config.directory,id+'.json'),metaTemp=temporary+'.json';
      try{await fs.writeFile(metaTemp,JSON.stringify(result),{flag:'wx',mode:0o600});
        try{await fs.link(metaTemp,meta);}catch(error){if(error.code!=='EEXIST')throw error;}
      }finally{await fs.unlink(metaTemp).catch(()=>{});}
      return {...result,filename:attachment.filename};
    }catch(error){body.destroy?.();if(error instanceof ChannelMediaError)throw error;fail('MEDIA_STORAGE_OR_NETWORK_FAILED',true);}
    finally{await handle?.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});}
  }
  return {prepare,download};
}
function validMime(value){return typeof value==='string'&&value.length<150&&/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value);}
