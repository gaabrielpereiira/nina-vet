-- Apply as owner only after migration 0005 and explicit activation approval.
BEGIN;
GRANT USAGE ON SCHEMA nina_channels TO nina_app;
GRANT SELECT (account_id,event_id,payload_sha256,status) ON nina_channels.zernio_inbox TO nina_app;
GRANT INSERT (id,account_id,event_id,event_type,occurred_at,payload_sha256,payload_encrypted)
  ON nina_channels.zernio_inbox TO nina_app;
-- No ciphertext SELECT, UPDATE, DELETE, clinical access changes or worker permissions.
COMMIT;
