import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail = (code = 'INVALID_RECORD', status = 400) => { throw new ApiError(status, code, 'Confira os dados e tente novamente.'); };
const fields = {
 contacts: ['name','call_name','phone_number','email','notes','tags'],
 animals: ['name','species','breed','sex','birth_date','notes'],
 appointments: ['title','description','date','time','duration','type','status','contact_id','animal_id','procedure_id'],
 procedures: ['name','description','category','requirements','price_type','price','price_min','price_max','duration_minutes','is_active'],
};
const types = ['demo','meeting','support','followup','visitacao','consultoria','assinatura_contrato','vistoria','avaliacao'];
const statuses = ['scheduled','confirmed','completed','cancelled','canceled','no_show','pending'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function date(value) {
 return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000-') &&
 Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function clean(entity, input, creating) {
 if (!object(input) || !Object.keys(input).length || Object.keys(input).some(k => !fields[entity].includes(k))) fail();
 const data = {};
 for (const [key, value] of Object.entries(input)) {
  if (key === 'tags') {
   if (!Array.isArray(value) || value.length > 20 || value.some(t => typeof t !== 'string' || !t.trim() || t.length > 60 || /[\x00-\x1f]/.test(t))) fail();
   data.tags = [...new Set(value.map(t => t.trim()))]; continue;
  }
  if (['contact_id','animal_id','procedure_id'].includes(key)) {
   if (value !== null && (typeof value !== 'string' || !uuid.test(value))) fail('INVALID_LINK');
   data[key] = value; continue;
  }
  if (key === 'is_active') { if (typeof value !== 'boolean') fail(); data[key] = value; continue; }
  if (['price','price_min','price_max'].includes(key)) {
   if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) fail('INVALID_PRICE');
   data[key] = value; continue;
  }
  if (['duration','duration_minutes'].includes(key)) {
   if (!(key === 'duration_minutes' && value === null) && (!Number.isInteger(value) || value < 5 || value > 1440)) fail('INVALID_DURATION');
   data[key] = value; continue;
  }
  const required = ['name','title','phone_number','date','time','type','status','price_type'].includes(key);
  if (value === null && !required) { data[key] = null; continue; }
  const maximum = ['notes','description','requirements'].includes(key) ? 4000 : ['name','title'].includes(key) ? 240 : key === 'email' ? 320 : 120;
  if (typeof value !== 'string' || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail();
  const text = value.trim();
  if (required && !text) fail();
  if (key === 'phone_number') {
   if (!/^[+\d() .-]+$/.test(text)) fail('INVALID_PHONE');
   const phone = text.replace(/\D/g,''); if (phone.length < 8 || phone.length > 15) fail('INVALID_PHONE');
   data[key] = phone; continue;
  }
  if (key === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) fail('INVALID_EMAIL');
  if ((key === 'date' || key === 'birth_date') && text && !date(text)) fail('INVALID_DATE');
  if (key === 'birth_date' && text > new Date().toISOString().slice(0,10)) fail('INVALID_DATE');
  if (key === 'time' && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text)) fail('INVALID_TIME');
  if (key === 'type' && !types.includes(text)) fail();
  if (key === 'status' && !statuses.includes(text)) fail();
  if (key === 'price_type' && !['fixed','range'].includes(text)) fail('INVALID_PRICE');
  data[key] = text || null;
 }
 if (creating) {
  for (const key of entity === 'contacts' ? ['name','phone_number'] : entity === 'appointments' ? ['title','date','time','contact_id'] : ['name']) {
   if (!data[key]) fail();
  }
 }
 return data;
}

export function createClinicWriter(db, auth) {
 return async (request, parseBody) => {
  const url = new URL(request.url);
  if (url.search) fail();
  const route = url.pathname.slice('/v1/clinic/'.length);
  const animal = route.match(/^contacts\/([^/]+)\/animals(?:\/([^/]+))?$/);
  const regular = route.match(/^(contacts|appointments|procedures)(?:\/([^/]+))?$/);
  if (!animal && !regular) fail('NOT_FOUND',404);
  const entity = animal ? 'animals' : regular[1];
  const id = animal ? animal[2] : regular[2];
  const parent = animal?.[1];
  if ((id && !uuid.test(id)) || (parent && !uuid.test(parent))) fail();
  const { user } = await auth.authenticate(request);
  if (entity === 'procedures' && !user.roles.includes('admin')) fail('FORBIDDEN',403);
  const body = await parseBody();
  if (!object(body) || Object.keys(body).some(k => !['operation_id','version','data'].includes(k)) ||
      typeof body.operation_id !== 'string' || !uuid.test(body.operation_id) ||
      (id ? !Number.isSafeInteger(body.version) || body.version < 1 : body.version !== undefined)) fail();
  const data = clean(entity,body.data,!id);
  // Canonical sorted payload prevents property order changing a retry's identity.
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a],[b])=>a.localeCompare(b))));
  const fingerprint = createHash('sha256').update(route+'\n'+String(body.version)+'\n'+canonical).digest('hex');
  try {
   return await db.transaction(async tx => {
    await tx.query("SELECT set_config('nina.user_id',$1,true)",[user.id]);
    // Recheck roles/disabled state inside the write transaction through RLS.
    const [access] = await tx.query('SELECT nina_clinic.can_write($1) AS allowed',[entity === 'procedures']);
    if (!access.allowed) fail('FORBIDDEN',403);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[user.id+':'+body.operation_id.toLowerCase()]);
    const [receipt] = await tx.query('SELECT fingerprint,result FROM nina_clinic.write_receipts WHERE actor_id=$1 AND operation_id=$2',[user.id,body.operation_id]);
    if (receipt) {
     if (receipt.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT',409);
     return receipt.result;
    }
    let current;
    const selection = entity === 'appointments' ? 'id,revision,contact_id,animal_id,procedure_id' : entity === 'procedures' ? 'id,revision,price_type,price_min,price_max' : entity === 'animals' ? 'id,revision,contact_id' : 'id,revision';
    if (id) {
     [current] = await tx.query(`SELECT ${selection} FROM nina_clinic.${entity} WHERE id=$1 FOR UPDATE`,[id]);
     if (!current || (parent && current.contact_id !== parent)) fail('NOT_FOUND',404);
     if (current.revision !== body.version) fail('VERSION_CONFLICT',409);
    }
    if (parent) {
     if (!(await tx.query('SELECT id FROM nina_clinic.contacts WHERE id=$1',[parent])).length) fail('INVALID_LINK');
     if (!id) data.contact_id = parent;
    }
    const merged = { ...current, ...data };
    if (entity === 'appointments') {
     if (!merged.contact_id || !(await tx.query('SELECT id FROM nina_clinic.contacts WHERE id=$1',[merged.contact_id])).length) fail('INVALID_LINK');
     if (merged.animal_id && !(await tx.query('SELECT id FROM nina_clinic.animals WHERE id=$1 AND contact_id=$2',[merged.animal_id,merged.contact_id])).length) fail('INVALID_LINK');
     if (merged.procedure_id) {
      const [procedure] = await tx.query('SELECT id,is_active FROM nina_clinic.procedures WHERE id=$1',[merged.procedure_id]);
      if (!procedure || ((!id || current.procedure_id !== merged.procedure_id) && !procedure.is_active)) fail('INVALID_LINK');
     }
     if (!id) { data.type ??= 'visitacao'; data.status ??= 'scheduled'; data.duration ??= 30; }
    }
    if (entity === 'procedures' && (!id || ['price_type','price','price_min','price_max'].some(key => key in data))) {
     const priceType = merged.price_type ?? 'fixed';
     if (priceType === 'range') {
      if (merged.price_min == null || merged.price_max == null || Number(merged.price_min) > Number(merged.price_max)) fail('INVALID_PRICE');
      data.price = null;
     } else { data.price_min = null; data.price_max = null; }
    }
    if (!id && ['contacts','appointments'].includes(entity)) data.user_id = user.id;
    const keys = Object.keys(data);
    const values = Object.values(data);
    const columns = keys.map(k=>'"'+k+'"'); // keys are restricted by the entity allowlist above.
    const sql = id ? `UPDATE nina_clinic.${entity} SET ${columns.map((k,i)=>k+'=$'+(i+1)).join(',')} WHERE id=$${keys.length+1} RETURNING id,revision` :
     `INSERT INTO nina_clinic.${entity}(${columns.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id,revision`;
    const [saved] = await tx.query(sql,id ? [...values,id] : values);
    if (!saved) fail('FORBIDDEN',403);
    await tx.query('INSERT INTO nina_clinic.change_log(actor_id,entity_type,entity_id,action,changed_fields) VALUES($1,$2,$3,$4,$5)',
     [user.id,entity,saved.id,id ? 'update' : 'create',keys.filter(k=>k!=='user_id')]);
    const result = { data: saved };
    await tx.query('INSERT INTO nina_clinic.write_receipts(actor_id,operation_id,fingerprint,result) VALUES($1,$2,$3,$4)',
     [user.id,body.operation_id,fingerprint,JSON.stringify(result)]);
    return result;
   });
  } catch (error) {
   if (error.code === '23505') fail('DUPLICATE_PHONE',409);
   if (error.code === '23503') fail('INVALID_LINK');
   if (error.code === '42501') fail('FORBIDDEN',403);
   throw error;
  }
 };
}
