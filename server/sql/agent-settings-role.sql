-- Apply only with the reviewed owner import. Existing admins may read business settings.
-- No credentials, writes, execution role, public access or additional staff access.
GRANT USAGE ON SCHEMA nina_agent TO nina_app;
GRANT SELECT ON nina_agent.settings TO nina_app;
