-- Run once as the database owner AFTER migrations; not through the API.
-- Set the password interactively with psql's \password nina_app afterwards.
-- Re-running CREATE ROLE intentionally fails rather than rotating credentials.
BEGIN;
CREATE ROLE nina_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE nina TO nina_app;
GRANT USAGE ON SCHEMA nina_auth, nina_meta TO nina_app;
GRANT SELECT ON nina_meta.schema_migrations TO nina_app;
GRANT SELECT ON nina_auth.users, nina_auth.user_roles TO nina_app;
GRANT SELECT, INSERT, DELETE ON nina_auth.sessions TO nina_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nina_auth.login_windows TO nina_app;
GRANT UPDATE (password_hash) ON nina_auth.users TO nina_app;
GRANT SELECT, INSERT, DELETE ON nina_auth.password_resets TO nina_app;
GRANT USAGE ON SCHEMA nina_mail TO nina_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nina_mail.outbox TO nina_app;
COMMIT;
