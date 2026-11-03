import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/src/app.mjs';
import { readConfig } from '../server/src/config.mjs';
import { migrate, readMigrations } from '../server/src/migrations.mjs';

const config=readConfig({NODE_ENV:'production',API_ORIGIN:'https://api.nina.example.com',FRONTEND_ORIGIN:'https://nina.example.com',DATABASE_URL:'postgresql://nina_app:synthetic@localhost/nina'});
const user=randomUUID(), other=randomUUID(), contact=randomUUID(), pet=randomUUID(), procedure=randomUUID(), event=randomUUID();
const token='w'.repeat(43); let pg,db,app;
function adapter(engine){return {query:async(sql,values=[]) => (await engine.query(sql,values)).rows,exec:sql=>engine.exec(sql),transaction:fn=>engine.transaction(tx=>fn(adapter(tx)))};}
function req(path,body,{authenticated=true,origin=config.frontendOrigin,method='POST'}={}){return new Request(config.apiOrigin+'/v1/clinic/'+path,{method,headers:{...(origin?{origin}:{}),'content-type':'application/json',...(authenticated?{cookie:config.cookieName+'='+token}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});}
const payload=(data,version)=>({operation_id:randomUUID(),data,...(version===undefined?{}:{version})});
const post=(path,data,version)=>app(req(path,payload(data,version)));
async function owner(sql,values=[]){await db.exec('RESET ROLE');try{return await db.query(sql,values);}finally{await db.exec('SET ROLE nina_app');}}
async function body(response,status=200){const json=await response.json();assert.equal(response.status,status,JSON.stringify(json));return json;}
before(async()=>{
 pg=new PGlite(); db=adapter(pg);const migrations=await readMigrations();await migrate(db,migrations);
 for(const file of ['runtime-role.sql','clinic-runtime-role.sql','clinic-write-role.sql'])await db.exec((await readFile(new URL('../server/sql/'+file,import.meta.url),'utf8')).replace('ON DATABASE nina TO','ON DATABASE postgres TO'));
 app=createApp({db,config,migrations});
});
beforeEach(async()=>{
 await db.exec('RESET ROLE; TRUNCATE nina_clinic.contacts,nina_clinic.animals,nina_clinic.procedures,nina_clinic.appointments,nina_clinic.conversations,nina_clinic.messages,nina_clinic.change_log,nina_clinic.write_receipts,nina_auth.users,nina_auth.user_roles,nina_auth.sessions CASCADE;');
 await db.query('INSERT INTO nina_auth.users(id,email) VALUES($1,$2),($3,$4)',[user,'writer@example.invalid',other,'other@example.invalid']);
 await db.query("INSERT INTO nina_auth.user_roles VALUES($1,'user')",[user]);
 await db.query("INSERT INTO nina_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),user]);
 await db.query(`INSERT INTO nina_clinic.contacts(id,name,phone_number,vetsoft_client_id,client_memory) VALUES($1,'Tutor de teste','551199990001',17,'{"private":"PRESERVE"}')`,[contact]);
 await db.query("INSERT INTO nina_clinic.animals(id,contact_id,name,vetsoft_animal_id) VALUES($1,$2,'Luna',42)",[pet,contact]);
 await db.query("INSERT INTO nina_clinic.procedures(id,name) VALUES($1,'Consulta')",[procedure]);
 await db.query("INSERT INTO nina_clinic.appointments(id,title,date,time,contact_id,animal_id,procedure_id,vetsoft_event_id,metadata) VALUES($1,'Retorno','2026-11-03','09:30',$2,$3,$4,89,'{\"preserve\":true}')",[event,contact,pet,procedure]);
 await db.exec('SET ROLE nina_app');
});
after(async()=>pg?.close());

test('clinical writes: reject anonymous, untrusted/absent origins and unsupported methods before any change',async()=>{
 for(const path of ['contacts','contacts/'+contact,'contacts/'+contact+'/animals','appointments','appointments/'+event,'procedures']){
  assert.equal((await app(req(path,payload({name:'Test'},1),{authenticated:false}))).status,401);
  for(const origin of ['https://evil.example','https://other.nina.example.com',null])assert.equal((await app(req(path,payload({name:'Test'},1),{origin}))).status,403);
 }
 assert.equal((await app(req('contacts/'+contact,null,{method:'DELETE'}))).status,405);
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.change_log'))[0].n,0);
});
test('clinical writes: create, patch, read back and preserve imported metadata and owners',async()=>{
 const created=await body(await post('contacts',{name:'Novo tutor',phone_number:'+55 (11) 99990-0002',email:'tutor@example.invalid',tags:['Retorno']}));
 const detail=await body(await app(req('contacts/'+created.data.id,null,{method:'GET'})));
 assert.equal(detail.data.phone_number,'5511999900002');assert.equal(detail.data.revision,1);
 const updated=await body(await post('contacts/'+contact,{name:"Tutor d'Água",notes:'Observação corrigida'},1));
 assert.equal(updated.data.revision,2);
 const [row]=await owner('SELECT * FROM nina_clinic.contacts WHERE id=$1',[contact]);
 assert.equal(row.name,"Tutor d'Água");assert.equal(row.vetsoft_client_id,17);assert.equal(row.client_memory.private,'PRESERVE');assert.equal(row.user_id,null);
 const [log]=await owner("SELECT * FROM nina_clinic.change_log WHERE entity_id=$1",[contact]);
 assert.equal(log.actor_id,user);assert.deepEqual(log.changed_fields,['name','notes']);assert.ok(!JSON.stringify(log).includes('Observação corrigida'));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM nina_clinic.contacts'))[0].n,0);
});
test('clinical writes: stale versions never overwrite newer edits or create audit entries',async()=>{
 await body(await post('contacts/'+contact,{name:'Atual'},1));
 const stale=await body(await post('contacts/'+contact,{name:'Antigo'},1),409);assert.equal(stale.error.code,'VERSION_CONFLICT');
 assert.equal((await owner('SELECT name FROM nina_clinic.contacts WHERE id=$1',[contact]))[0].name,'Atual');
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.change_log'))[0].n,1);
});
test('clinical writes: retry of a committed create/update is idempotent; changed retry cannot create a second record',async()=>{
 const input=payload({name:'Novo pet',species:'Felina'});
 const first=await body(await app(req('contacts/'+contact+'/animals',input)));
 assert.deepEqual(await body(await app(req('contacts/'+contact+'/animals',input))),first);
 assert.equal((await owner("SELECT count(*)::int AS n FROM nina_clinic.animals WHERE name='Novo pet'"))[0].n,1);
 const update=payload({notes:'Uma vez'},1);await body(await app(req('contacts/'+contact+'/animals/'+first.data.id,update)));
 await body(await app(req('contacts/'+contact+'/animals/'+first.data.id,update)));
 const conflict=await body(await app(req('contacts/'+contact+'/animals',{...input,data:{name:'Outro'}})),409);assert.equal(conflict.error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.change_log'))[0].n,2);
});
test('clinical writes: invalid fields, injection into column names, invalid dates and duplicate phones roll back',async()=>{
 for(const data of [{user_id:other,name:'x'},{id:other,name:'x'},{'name = NULL;--':'x'},{phone_number:'abc'},{email:'broken'},{tags:['']},{tags:Array(21).fill('x')},{name:'x'.repeat(241)}])assert.equal((await post('contacts/'+contact,data,1)).status,400,JSON.stringify(data));
 for(const date of ['2026-02-30','0000-01-01','tomorrow'])assert.equal((await post('contacts/'+contact+'/animals',{name:'Test',birth_date:date})).status,400);
 assert.equal((await post('contacts',{name:'Duplicado',phone_number:'551199990001'})).status,409);
 assert.equal((await post('contacts/'+contact,{name:'Without version'})).status,400);
 assert.equal((await post('contacts/'+contact,{},1)).status,400);
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.change_log'))[0].n,0);
});
test('clinical writes: tutor/animal/procedure links are validated, cannot be forged or silently reassigned',async()=>{
 const another=await body(await post('contacts',{name:'Outro tutor',phone_number:'551199990003'}));
 assert.equal((await post('appointments',{title:'Errado',date:'2026-11-03',time:'10:00',contact_id:another.data.id,animal_id:pet})).status,400);
 assert.equal((await post('contacts/'+another.data.id+'/animals/'+pet,{name:'Moved'},1)).status,404);
 assert.equal((await post('contacts/'+contact+'/animals/'+pet,{contact_id:another.data.id},1)).status,400);
 assert.equal((await post('appointments/'+event,{contact_id:another.data.id},1)).status,400);
 const changed=await body(await post('appointments/'+event,{contact_id:another.data.id,animal_id:null},1));assert.equal(changed.data.revision,2);
 const detail=await body(await app(req('appointments/'+event,null,{method:'GET'})));assert.equal(detail.data.contact_id,another.data.id);assert.equal(detail.data.animal_id,null);
});
test('clinical writes: appointment create/cancel keeps external identifiers and validates time/duration',async()=>{
 const data={title:'Consulta',date:'2026-11-04',time:'10:30',contact_id:contact,animal_id:pet,procedure_id:procedure,duration:30};
 const saved=await body(await post('appointments',data));assert.ok(saved.data.id);
 for(const patch of [{time:'25:00'},{date:'2026-02-30'},{duration:0},{duration:1441},{status:'invented'}])assert.equal((await post('appointments/'+event,patch,1)).status,400);
 await body(await post('appointments/'+event,{status:'cancelled'},1));
 const [row]=await owner('SELECT status,vetsoft_event_id,metadata FROM nina_clinic.appointments WHERE id=$1',[event]);assert.equal(row.status,'cancelled');assert.equal(row.vetsoft_event_id,89);assert.equal(row.metadata.preserve,true);
});
test('clinical writes: procedures require admin in both API and direct SQL; ranges/inactive references validated',async()=>{
 assert.equal((await post('procedures',{name:'Forbidden'})).status,403);
 await db.transaction(async tx=>{await tx.query("SELECT set_config('nina.user_id',$1,true)",[user]);assert.equal((await tx.query('UPDATE nina_clinic.procedures SET name=$1 WHERE id=$2 RETURNING id',['Forbidden',procedure])).length,0);});
 await owner("INSERT INTO nina_auth.user_roles VALUES($1,'admin')",[user]);
 const invalid=await post('procedures',{name:'Inverted',price_type:'range',price_min:200,price_max:100});assert.equal(invalid.status,400);
 const ranged=await body(await post('procedures',{name:'Faixa',price_type:'range',price_min:100,price_max:200}));assert.ok(ranged.data.id);
 await body(await post('procedures/'+procedure,{is_active:false},1));
 assert.equal((await post('appointments',{title:'Consulta',date:'2026-11-04',time:'11:00',contact_id:contact,procedure_id:procedure})).status,400);
 // Existing appointments can still change their own notes/status with an inactive imported procedure.
 await body(await post('appointments/'+event,{description:'Preservar vínculo existente'},1));
});
test('clinical writes: direct SQL cannot delete, alter protected columns, read audit or use another actor receipt',async()=>{
 for(const sql of ['DELETE FROM nina_clinic.contacts','DELETE FROM nina_clinic.appointments','SELECT * FROM nina_clinic.change_log',"UPDATE nina_clinic.contacts SET user_id=null","UPDATE nina_clinic.animals SET contact_id=null","UPDATE nina_clinic.contacts SET revision=9",'CREATE TABLE nina_clinic.rogue(id int)'])await assert.rejects(db.exec(sql),/permission denied/);
 await assert.rejects(db.query("INSERT INTO nina_clinic.contacts(name,phone_number) VALUES('No identity','551199990009')"),/row-level security/);
 await db.transaction(async tx=>{await tx.query("SELECT set_config('nina.user_id',$1,true)",[user]);await assert.rejects(tx.query("INSERT INTO nina_clinic.write_receipts(actor_id,operation_id,fingerprint,result) VALUES($1,$2,repeat('a',64),'{}')",[other,randomUUID()]),/row-level security/);});
 await owner('UPDATE nina_auth.users SET disabled_at=now() WHERE id=$1',[user]);
 assert.equal((await post('contacts/'+contact,{name:'No access'},1)).status,401);
});
test('clinical writes: audit failure rolls back both data and operation receipt',async()=>{
 await db.exec('RESET ROLE; REVOKE INSERT ON nina_clinic.change_log FROM nina_app; REVOKE INSERT(actor_id,entity_type,entity_id,action,changed_fields) ON nina_clinic.change_log FROM nina_app; SET ROLE nina_app;');
 try{assert.equal((await post('contacts/'+contact,{name:'Must roll back'},1)).status,403);
 assert.equal((await owner('SELECT name,revision FROM nina_clinic.contacts WHERE id=$1',[contact]))[0].revision,1);
 assert.equal((await owner('SELECT count(*)::int AS n FROM nina_clinic.write_receipts'))[0].n,0);
 }finally{await db.exec('RESET ROLE; GRANT INSERT(actor_id,entity_type,entity_id,action,changed_fields) ON nina_clinic.change_log TO nina_app; SET ROLE nina_app;');}
});
