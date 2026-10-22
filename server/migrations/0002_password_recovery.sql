CREATE TABLE nina_auth.password_resets (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES nina_auth.users(id) ON DELETE CASCADE,
  credential_fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX password_resets_user_idx ON nina_auth.password_resets (user_id);
CREATE INDEX password_resets_expiry_idx ON nina_auth.password_resets (expires_at);
REVOKE ALL ON nina_auth.password_resets FROM PUBLIC;

CREATE SCHEMA nina_mail;
REVOKE ALL ON SCHEMA nina_mail FROM PUBLIC;
CREATE TABLE nina_mail.outbox (
  id uuid PRIMARY KEY,
  reset_id uuid NOT NULL UNIQUE REFERENCES nina_auth.password_resets(id) ON DELETE CASCADE,
  payload_ciphertext text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sent_at timestamptz,
  provider_id text,
  last_error_code varchar(60),
  CHECK (expires_at > created_at),
  CHECK (status NOT IN ('pending','sending') OR payload_ciphertext IS NOT NULL)
);
CREATE INDEX outbox_available_idx ON nina_mail.outbox (available_at, created_at)
  WHERE status IN ('pending','sending');
CREATE INDEX outbox_expiry_idx ON nina_mail.outbox (expires_at);
REVOKE ALL ON nina_mail.outbox FROM PUBLIC;
