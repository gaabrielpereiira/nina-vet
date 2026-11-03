// In-process integration check on the deployed runtime role. No session/token is
// created and every synthetic write is rolled back in the outer transaction.
import {randomUUID} from 'node:crypto';
import {readConfig} from '../src/config.mjs';
import {createDatabase,assertRuntimeRole} from '../src/database.mjs';
import {createClinicWriter} from '../src/clinic-writes.mjs';
const config=readConfig();const db=createDatabase({...config.database,max:1});
const rollback=new Error('NINA_SMOKE_ROLLBACK');let step='begin';let passed=false;
try{
 await assertRuntimeRole(db);
 await db.transaction(async tx=>{
  const [staff]=await tx.query(`SELECT u.id, ARRAY(SELECT r.role FROM nina_auth.user_roles r WHERE r.user_id=u.id ORDER BY r.role) AS roles
   FROM nina_auth.users u WHERE u.disabled_at IS NULL AND EXISTS(SELECT 1 FROM nina_auth.user_roles r WHERE r.user_id=u.id AND r.role='admin') ORDER BY u.id LIMIT 1`);
  if(!staff)throw new Error('NO_ACTIVE_ADMIN');
  const writer=createClinicWriter({...tx,transaction:fn=>fn(tx)},{authenticate:async()=>({user:staff})});
  const call=(path,data,version,operation_id=randomUUID())=>writer(new Request(config.apiOrigin+'/v1/clinic/'+path,{method:'POST'}),async()=>({operation_id,data,...(version===undefined?{}:{version})}));
  step='contact_create';const operation=randomUUID();const input={name:'NINA_RUNTIME_ROLLBACK_TEST',phone_number:'000000000000002',tags:['synthetic-test']};
  const contact=await call('contacts',input,undefined,operation);
  if(contact.data.revision!==1)throw new Error('REVISION_FAILED');
  step='idempotency';const again=await call('contacts',input,undefined,operation);if(again.data.id!==contact.data.id)throw new Error('REPLAY_FAILED');
  step='contact_update';const changed=await call('contacts/'+contact.data.id,{notes:'ROLLBACK_ONLY'},1);if(changed.data.revision!==2)throw new Error('REVISION_FAILED');
  step='stale_write';let rejected=false;try{await call('contacts/'+contact.data.id,{name:'STALE'},1);}catch(e){rejected=e.code==='VERSION_CONFLICT';}if(!rejected)throw new Error('STALE_WRITE_ALLOWED');
  step='animal_create';const animal=await call('contacts/'+contact.data.id+'/animals',{name:'TEST_ROLLBACK_PET',species:'Canina',birth_date:'2021-01-01'});
  step='procedure_create';const procedure=await call('procedures',{name:'TEST_ROLLBACK_SERVICE',price_type:'fixed',price:123.45,duration_minutes:30});
  step='appointment_create';const visit=await call('appointments',{title:'TEST_ROLLBACK_VISIT',date:'2026-11-03',time:'23:55',duration:30,contact_id:contact.data.id,animal_id:animal.data.id,procedure_id:procedure.data.id});
  step='appointment_cancel';await call('appointments/'+visit.data.id,{status:'cancelled'},1);
  throw rollback;
 });
}catch(error){
 if(error===rollback){passed=true;}else{console.log(JSON.stringify({event:'native_write_smoke',result:'failed',step,code:error.code??error.name??'SMOKE_FAILED'}));process.exitCode=1;}
}finally{
 if(passed){const [context]=await db.query("SELECT coalesce(current_setting('nina.user_id',true),'') AS identity");if(context.identity!==''){passed=false;process.exitCode=1;console.log('NINA_RUNTIME_CONTEXT_FAILED');}}
 await db.close();
}
if(passed)console.log('NINA_RUNTIME_WRITE_SMOKE_OK_ROLLED_BACK');
