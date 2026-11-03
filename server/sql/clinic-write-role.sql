-- Apply as owner after migration 0004, following approval to activate writes.
-- No credential changes, role creation, DELETE or broad table/schema grants.
BEGIN;
GRANT EXECUTE ON FUNCTION nina_clinic.can_write(boolean) TO nina_app;
GRANT INSERT (name,call_name,phone_number,email,notes,tags,user_id),
 UPDATE (name,call_name,phone_number,email,notes,tags) ON nina_clinic.contacts TO nina_app;
GRANT INSERT (contact_id,name,species,breed,sex,birth_date,notes),
 UPDATE (name,species,breed,sex,birth_date,notes) ON nina_clinic.animals TO nina_app;
GRANT INSERT (title,description,date,time,duration,type,status,contact_id,animal_id,procedure_id,user_id),
 UPDATE (title,description,date,time,duration,type,status,contact_id,animal_id,procedure_id) ON nina_clinic.appointments TO nina_app;
GRANT INSERT (name,description,category,requirements,price_type,price,price_min,price_max,duration_minutes,is_active),
 UPDATE (name,description,category,requirements,price_type,price,price_min,price_max,duration_minutes,is_active) ON nina_clinic.procedures TO nina_app;
GRANT INSERT (actor_id,entity_type,entity_id,action,changed_fields) ON nina_clinic.change_log TO nina_app;
GRANT SELECT ON nina_clinic.write_receipts TO nina_app;
GRANT INSERT (actor_id,operation_id,fingerprint,result) ON nina_clinic.write_receipts TO nina_app;
COMMIT;
