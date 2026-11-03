-- Durable intake only. No clinical writes, outbound messages, AI or media fetches.
CREATE SCHEMA nina_channels;
REVOKE ALL ON SCHEMA nina_channels FROM PUBLIC;
CREATE TABLE nina_channels.zernio_inbox (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (account_id ~ '^[a-f0-9]{24}$'),
  event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN
    ('message.received','message.sent','message.delivered','message.read','message.failed')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload_encrypted text NOT NULL CHECK
    (octet_length(payload_encrypted) BETWEEN 50 AND 87500 AND payload_encrypted ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  UNIQUE (account_id,event_id)
);
REVOKE ALL ON nina_channels.zernio_inbox FROM PUBLIC;
ALTER TABLE nina_channels.zernio_inbox ENABLE ROW LEVEL SECURITY;
-- The maintenance owner remains able to take/restore full backups. assertRuntimeRole
-- rejects owners; the running API is nina_app, without BYPASSRLS or schema ownership.
CREATE POLICY zernio_inbox_scope_read ON nina_channels.zernio_inbox FOR SELECT
  USING (account_id = (SELECT current_setting('nina.webhook_account_id',true)));
CREATE POLICY zernio_inbox_scope_insert ON nina_channels.zernio_inbox FOR INSERT
  WITH CHECK (account_id = (SELECT current_setting('nina.webhook_account_id',true)));
