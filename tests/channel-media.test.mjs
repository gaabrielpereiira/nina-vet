import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createMediaArchive,createPinnedTransport,filePath,isPublicIpv4,mediaId} from '../server/src/channel-media.mjs';
const account='a'.repeat(24),key='synthetic-media-key-'.repeat(3);
const task=(url='https://cdn.example.invalid/file')=>({accountId:account,messageId:'wamid.synthetic',attachment:{index:0,url,filename:'arquivo.pdf'}});
const response=(text='SYNTHETIC_BYTES',headers={})=>({status:200,headers:{'content-type':'application/pdf',...headers},body:Readable.from([Buffer.from(text)])});
async function fixture(run,overrides={}){
 const directory=await fs.mkdtemp('/private/tmp/nina-media-test-');const calls=[];
 const dependencies={lookup:async()=>[{address:'8.8.8.8',family:4}],statfs:async()=>({bavail:100000,bsize:4096}),transport:async args=>{calls.push(args);return response();},...overrides};
 const archive=createMediaArchive({directory,accountId:account,apiKey:key,maxBytes:1024,minFreeBytes:0},dependencies);
 try{await run(archive,directory,calls);}finally{await fs.rm(directory,{recursive:true,force:true});}
}
test('media: reject private, reserved, multicast, encoded loopback and IPv6 destinations',async()=>{
 for(const ip of ['0.0.0.0','10.1.2.3','100.64.1.1','127.0.0.1','169.254.169.254','172.31.1.1','192.168.1.1','198.18.0.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','fd00::1'])assert.equal(isPublicIpv4(ip),false,ip);
 assert.equal(isPublicIpv4('8.8.8.8'),true);
 await fixture(async archive=>{for(const host of ['127.0.0.1','2130706433','[::1]','169.254.169.254'])await assert.rejects(archive.download(task('https://'+host+'/file')),{code:'MEDIA_PRIVATE_ADDRESS'});});
});
test('media: mixed DNS answers fail closed before a network request',async()=>{
 await fixture(async(archive,_dir,calls)=>{await assert.rejects(archive.download(task()),{code:'MEDIA_PRIVATE_ADDRESS'});assert.equal(calls.length,0);},{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]});
});
test('media: pinned HTTPS keeps certificate verification and original SNI, and disables connection reuse',async()=>{
 let options;const transport=createPinnedTransport((_url,opts,callback)=>{options=opts;const req=new EventEmitter();req.end=()=>callback({statusCode:200,headers:{},[Symbol.asyncIterator]:async function*(){}});return req;});
 await transport({url:new URL('https://cdn.example.invalid/file'),address:'8.8.8.8',headers:{},signal:new AbortController().signal});
 assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.servername,'cdn.example.invalid');assert.equal(options.method,'GET');
 options.lookup('rebound.invalid',{},(err,address,family)=>{assert.equal(err,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
 options.lookup('rebound.invalid',{all:true},(err,addresses)=>{assert.equal(err,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
});
test('media: stream bytes to private immutable files, validate digest and reuse a complete archive on retry',async()=>{
 await fixture(async(archive,directory,calls)=>{
  const first=await archive.download(task());assert.equal(first.bytes,15);assert.equal(first.mime,'application/pdf');
  assert.equal((await fs.readFile(filePath(directory,first.id))).toString(),'SYNTHETIC_BYTES');assert.equal((await fs.stat(filePath(directory,first.id))).mode&0o777,0o600);
  assert.deepEqual(await archive.download(task()),first);assert.equal(calls.length,1);assert.equal(calls[0].headers.authorization,undefined);
  assert.equal(first.id,mediaId(account,'wamid.synthetic',0));assert.notEqual(first.id,mediaId(account,'wamid.synthetic',1));
  assert.throws(()=>filePath(directory,'../../escape'));
 });
});
test('media: bind authenticated provider downloads to the configured account and never forward credentials through redirects',async()=>{
 await fixture(async(archive,_dir,calls)=>{await archive.download(task('https://zernio.com/api/v1/whatsapp/media/123'));
  assert.equal(calls[0].headers.authorization,'Bearer '+key);assert.equal(calls[0].url.searchParams.get('accountId'),account);
  await assert.rejects(archive.download({...task('https://zernio.com/api/v1/whatsapp/media/123?accountId=foreign'),messageId:'different'}),{code:'MEDIA_ACCOUNT_MISMATCH'});
  await assert.rejects(archive.download({...task('https://zernio.com/api/v1/accounts'),messageId:'different'}),{code:'MEDIA_PROVIDER_PATH_DENIED'});
 });
 await fixture(async archive=>{await assert.rejects(archive.download(task('https://zernio.com/api/v1/whatsapp/media/123')),{code:'MEDIA_REDIRECT_DENIED'});},{transport:async()=>({status:302,headers:{location:'https://cdn.example.invalid/file'},body:Readable.from([])})});
});
test('media: each public redirect is checked again; private redirects never reach the transport',async()=>{
 let calls=0;await fixture(async archive=>{await assert.rejects(archive.download(task()),{code:'MEDIA_PRIVATE_ADDRESS'});assert.equal(calls,1);},{transport:async()=>{calls++;return {status:302,headers:{location:'https://127.0.0.1/file'},body:Readable.from([])};}});
});
test('media: oversized, compressed, incomplete and interrupted streams never publish a complete file',async()=>{
 for(const make of [()=>response('x',{'content-length':'1025'}),()=>response('x'.repeat(1025)),()=>response('x',{'content-encoding':'gzip'}),()=>response('x',{'content-length':'8'}),()=>({status:200,headers:{},body:Readable.from((async function*(){yield Buffer.from('partial');throw Error('SIMULATED_PRIVATE_NETWORK_FAILURE');})())})]){
  await fixture(async(archive,directory)=>{await assert.rejects(archive.download(task()));assert.equal((await fs.readdir(directory)).filter(n=>n.endsWith('.blob')||n.startsWith('.part-')).length,0);},{transport:async()=>make()});
 }
});
test('media: permission/retention/provider failures use fixed codes and only transient failures retry',async()=>{
 for(const [status,code,retryable] of [[401,'MEDIA_PROVIDER_PERMISSION',false],[403,'MEDIA_PROVIDER_PERMISSION',false],[404,'MEDIA_NOT_AVAILABLE',false],[410,'MEDIA_NOT_AVAILABLE',false],[429,'MEDIA_HTTP_FAILED',true],[503,'MEDIA_HTTP_FAILED',true]]){
  await fixture(async archive=>{await assert.rejects(archive.download(task()),{code,retryable});},{transport:async()=>({status,headers:{},body:Readable.from([])})});
 }
});
test('media: corrupted cache, symlink directories and exhausted disk never overwrite archived bytes',async()=>{
 await fixture(async(archive,directory)=>{const first=await archive.download(task());await fs.writeFile(filePath(directory,first.id),'CORRUPTED');await assert.rejects(archive.download(task()),{code:'MEDIA_CACHE_INVALID'});assert.equal((await fs.readFile(filePath(directory,first.id))).toString(),'CORRUPTED');});
 await fixture(async archive=>{await assert.rejects(archive.download(task()),{code:'MEDIA_STORAGE_FULL'});},{statfs:async()=>({bavail:0,bsize:4096})});
 const root=await fs.mkdtemp('/private/tmp/nina-media-test-');try{await fs.mkdir(path.join(root,'target'));await fs.symlink(path.join(root,'target'),path.join(root,'link'));const archive=createMediaArchive({directory:path.join(root,'link'),maxBytes:1024,minFreeBytes:0});await assert.rejects(archive.prepare(),{code:'MEDIA_STORAGE_PERMISSIONS'});}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('channel media: production storage refuses a missing volume marker before any network download',async()=>{
 const directory=await fs.mkdtemp('/private/tmp/nina-marker-test-');
 try{
  const options={directory,requireMarker:true,minFreeBytes:0,maxBytes:1024};
  await assert.rejects(createMediaArchive(options).prepare(),{code:'MEDIA_STORAGE_NOT_INITIALIZED'});
  await fs.writeFile(directory+'/.nina-volume-initialized','nina-media-v1\n',{mode:0o600});
  await createMediaArchive(options).prepare();
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
