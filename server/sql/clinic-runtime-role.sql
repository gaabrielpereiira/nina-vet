-- Apply as the database owner after migration 0003. No credential rotation.
BEGIN;
GRANT USAGE ON SCHEMA nina_clinic TO nina_app;
GRANT SELECT ON ALL TABLES IN SCHEMA nina_clinic TO nina_app;
COMMIT;
