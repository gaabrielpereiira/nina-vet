import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {readConfig} from '../server/src/config.mjs';
import {createApp} from '../server/src/app.mjs';
import {migrate,readMigrations} from '../server/src/migrations.mjs';
import {createVetsoftReadOnlyProvider} from '../server/src/vetsoft-read-only.mjs';
const password='SYNTHETIC_pw_á_$',email='fixture@example.invalid',tenant='clinic-fixture';
const env={NODE_ENV:'production',API_ORIGIN:'https://api.nina.example.com',FRONTEND_ORIGIN:'https://nina.example.com',DATABASE_URL:'postgresql://nina_app:synthetic@localhost/nina',
 VETSOFT_READ_ONLY_ENABLED:'true',VETSOFT_TENANT:tenant,VETSOFT_EMAIL:email,VETSOFT_PASSWORD_BASE64:Buffer.from(password).toString('base64')};
const config=readConfig(env),admin=randomUUID(),staff=randomUUID(),token='v'.repeat(43),staffToken='w'.repeat(43),access='SYNTHETIC_ACCESS_TOKEN';
const loginData=()=>({access_token:access,token_type:'Bearer',expires_in:300,refresh_token:'IGNORED_REFRESH_TOKEN'});
const services=()=>({data:[{cod_tipo_atendimento:1,nom_tipo_atendimento:'Consulta fictícia',num_tempo_duracao:30,sit_registro:true}],meta:{next:'https://evil.example.invalid/never-follow'}});
const adapter=p=>({query:async(s,a=[])=>(await p.query(s,a)).rows,exec:s=>p.exec(s),transaction:fn=>p.transaction(tx=>fn(adapter(tx)))});
let pg,db,migrations,app,calls,logs;
function request(body,{who=token,origin=config.frontendOrigin,path=body===undefined?'/v1/integrations/vetsoft':'/v1/integrations/vetsoft/check'}={}){
 return new Request(config.apiOrigin+path,{method:body===undefined?'GET':'POST',headers:{...(who?{cookie:'__Host-nina_session='+who}:{}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
const makeApp=(overrides={})=>createApp({db,config,migrations,log:e=>logs.push(e),vetsoftFetch:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/login')?loginData():services());},...overrides});
before(async()=>{pg=new PGlite();db=adapter(pg);migrations=await readMigrations();await migrate(db,migrations);await db.exec((await readFile(new URL('../server/sql/runtime-role.sql',import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE nina_auth.sessions,nina_auth.user_roles,nina_auth.users,nina_auth.login_windows CASCADE;');
 for(const [id,role,raw] of [[admin,'admin',token],[staff,'user',staffToken]]){
  await db.query('INSERT INTO nina_auth.users(id,email,full_name) VALUES($1,$2,$3)',[id,id+'@example.com','Fictional']);await db.query('INSERT INTO nina_auth.user_roles VALUES($1,$2)',[id,role]);
  await db.query("INSERT INTO nina_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(raw).digest('hex'),id]);
 }
 await db.exec('SET ROLE nina_app');calls=[];logs=[];app=makeApp();
});
after(async()=>pg?.close());
test('native VetSoft: anonymous and staff are denied before any provider calls',async()=>{
 for(const body of [undefined,{}]){assert.equal((await app(request(body,{who:null}))).status,401);assert.equal((await app(request(body,{who:staffToken}))).status,403);}
 assert.equal(calls.length,0);
});
test('native VetSoft: disabled by default, no credentials needed and status never contacts vendor',async()=>{
 const disabled=makeApp({config:readConfig({...env,VETSOFT_READ_ONLY_ENABLED:undefined,VETSOFT_TENANT:undefined,VETSOFT_EMAIL:undefined,VETSOFT_PASSWORD_BASE64:undefined})});
 const data=await (await disabled(request())).json();assert.deepEqual(data,{enabled:false,mode:'read_only',patient_sync_enabled:false,appointment_writes_enabled:false});
 assert.equal((await disabled(request({}))).status,503);assert.equal(calls.length,0);
 assert.equal((await (await app(request())).json()).enabled,true);assert.equal(calls.length,0);
});
test('native VetSoft: origin, body, endpoint and query overrides cannot change the connection',async()=>{
 for(const body of [null,[],{tenant:'other'},{email:'other@example.com'},{password:'private'},{url:'https://evil.example.com'},{sync:true}])assert.equal((await app(request(body))).status,400);
 for(const origin of [null,'https://evil.example.com'])assert.equal((await app(request({},{origin}))).status,403);
 assert.equal((await app(request({},{path:'/v1/integrations/vetsoft/check?url=private'}))).status,400);
 assert.equal((await app(request(undefined,{path:'/v1/integrations/vetsoft/check'}))).status,404);
 assert.equal(calls.length,0);
});
test('native VetSoft: only fixed login and one metadata GET; browser never receives credentials, tokens or service names',async()=>{
 const response=await app(request({}));assert.equal(response.status,200);const data=await response.json();assert.equal(calls.length,2);
 assert.equal(calls[0].url,'https://api.vetsoft.com.br/login');assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{email,password});
 assert.equal(calls[1].url,'https://api.vetsoft.com.br/service-types?per_page=5&status=active');assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.headers.authorization,'Bearer '+access);assert.equal(calls[1].options.body,undefined);
 for(const call of calls){assert.equal(call.options.headers['X-Tenant'],tenant);assert.equal(call.options.redirect,'error');assert.equal(call.options.credentials,'omit');assert.equal(call.options.signal,calls[0].options.signal);assert.ok(!call.url.includes(email));assert.ok(!call.url.includes(password));}
 assert.equal(data.authenticated,true);assert.equal(data.sample_count,1);assert.equal(data.appointment_writes_enabled,false);assert.equal(data.patient_sync_enabled,false);assert.equal(data.mode,'read_only');assert.ok(Number.isFinite(Date.parse(data.checked_at)));
 for(const value of [password,email,access,'IGNORED_REFRESH_TOKEN','Consulta fictícia','evil.example'])assert.ok(!JSON.stringify(data).includes(value));
 assert.deepEqual(logs,[]);assert.equal(response.headers.get('cache-control'),'no-store');await assert.rejects(db.query('SELECT count(*) FROM nina_clinic.contacts'),/permission denied/);
});
test('native VetSoft: clinic quota remains global across admins and app recreation',async()=>{
 for(let i=0;i<3;i++)assert.equal((await app(request({}))).status,200);
 await db.exec('RESET ROLE');await db.query("UPDATE nina_auth.user_roles SET role='admin' WHERE user_id=$1",[staff]);await db.exec('SET ROLE nina_app');app=makeApp();
 assert.equal((await app(request({},{who:staffToken}))).status,429);assert.equal(calls.length,6);
});
test('native VetSoft: failed logins consume quota without leaking details or expiring Nina session',async()=>{
 let attempts=0;app=makeApp({vetsoftFetch:async()=>{attempts++;return new Response(password+' PRIVATE_DIAGNOSTIC',{status:401});}});
 for(let i=0;i<3;i++){const response=await app(request({}));assert.equal(response.status,503);assert.ok(!(await response.text()).includes(password));}
 assert.equal((await app(request({}))).status,429);assert.equal(attempts,3);assert.equal((await app(request(undefined,{path:'/v1/auth/session'}))).status,200);
 for(const entry of logs){assert.equal(entry.event,'vetsoft_check_failed');assert.equal(entry.stage,'login');assert.equal(entry.code,'VETSOFT_AUTH_FAILED');assert.ok(!JSON.stringify(entry).includes(password));}
});
test('native VetSoft: daily quota, revoked role and disabled user prevent requests',async()=>{
 await db.query("INSERT INTO nina_auth.login_windows(key,window_start,attempts) VALUES('vetsoft-check-day:global',floor(extract(epoch FROM now())/86400)::bigint,10)");
 assert.equal((await app(request({}))).status,429);
 await db.exec('RESET ROLE');await db.query("UPDATE nina_auth.user_roles SET role='user' WHERE user_id=$1",[admin]);await db.exec('SET ROLE nina_app');assert.equal((await app(request({}))).status,403);
 await db.exec('RESET ROLE');await db.query('UPDATE nina_auth.users SET disabled_at=now() WHERE id=$1',[admin]);await db.exec('SET ROLE nina_app');assert.equal((await app(request({}))).status,401);assert.equal(calls.length,0);
});
test('native VetSoft configuration: only explicit activation reads a bounded, canonical password encoding',()=>{
 assert.equal(readConfig({...env,VETSOFT_READ_ONLY_ENABLED:undefined}).vetsoftReadOnly.enabled,false);assert.equal(config.vetsoftReadOnly.password,password);
 for(const patch of [{VETSOFT_READ_ONLY_ENABLED:'1'},{VETSOFT_TENANT:'https://other'},{VETSOFT_TENANT:'bad\r\nheader'},{VETSOFT_EMAIL:'bad'},{VETSOFT_PASSWORD_BASE64:'bad'},{VETSOFT_PASSWORD_BASE64:Buffer.from('\u0000').toString('base64')},{VETSOFT_PASSWORD_BASE64:Buffer.from('x'.repeat(1025)).toString('base64')}])assert.throws(()=>readConfig({...env,...patch}));
});
test('native VetSoft provider: malformed tokens, oversized responses and unbounded samples fail closed',async()=>{
 for(const body of [{},{...loginData(),token_type:'other'},{...loginData(),access_token:'bad\nheader'},{...loginData(),expires_in:'300'}])await assert.rejects(createVetsoftReadOnlyProvider(config.vetsoftReadOnly,async()=>Response.json(body))(),{code:'VETSOFT_INVALID_RESPONSE'});
 for(const response of [new Response('not JSON'),new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'65537'}})])await assert.rejects(createVetsoftReadOnlyProvider(config.vetsoftReadOnly,async()=>response)(),{code:'VETSOFT_INVALID_RESPONSE'});
 for(const body of [{data:{}},{data:[{}]},{data:Array.from({length:6},()=>services().data[0])}])await assert.rejects(createVetsoftReadOnlyProvider(config.vetsoftReadOnly,async url=>Response.json(url.endsWith('/login')?loginData():body))(),{code:'VETSOFT_INVALID_RESPONSE'});
});
test('native VetSoft provider: rejects permissions, upstream limits, network and timeout without retries',async()=>{
 for(const [status,code] of [[403,'VETSOFT_ACCESS_DENIED'],[429,'VETSOFT_PROVIDER_LIMIT'],[500,'VETSOFT_UNAVAILABLE']]){let attempts=0;await assert.rejects(createVetsoftReadOnlyProvider(config.vetsoftReadOnly,async()=>{attempts++;return new Response('PRIVATE',{status});})(),{code});assert.equal(attempts,1);}
 await assert.rejects(createVetsoftReadOnlyProvider(config.vetsoftReadOnly,async()=>{throw Error(password);})(),{code:'VETSOFT_UNAVAILABLE'});
 await assert.rejects(createVetsoftReadOnlyProvider(config.vetsoftReadOnly,async(_url,{signal})=>{await new Promise(resolve=>{const timer=setTimeout(resolve,100);signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});signal.throwIfAborted();},()=>{},5)(),{code:'VETSOFT_UNAVAILABLE'});
});
