-- Apply as the database owner after migration 0003. No credential rotation.
BEGIN;
GRANT USAGE ON SCHEMA nina_clinic TO nina_app;
GRANT SELECT ON nina_clinic.contacts, nina_clinic.animals, nina_clinic.procedures,
 nina_clinic.appointments, nina_clinic.conversations, nina_clinic.messages TO nina_app;
COMMIT;
