CREATE SCHEMA nina_auth;
REVOKE ALL ON SCHEMA nina_auth FROM PUBLIC;

CREATE TABLE nina_auth.users (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  password_hash text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT normalized_email CHECK (email = lower(btrim(email)))
);

-- Keep application-wide roles distinct from the team's manager/agent roles.
-- There is no public signup or automatic first-user administrator.
CREATE TABLE nina_auth.user_roles (
  user_id uuid NOT NULL REFERENCES nina_auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'user')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE nina_auth.sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES nina_auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT positive_session_lifetime CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON nina_auth.sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON nina_auth.sessions (expires_at);

-- Shared by all API replicas; restarts do not reset login attempt limits.
CREATE TABLE nina_auth.login_windows (
  key text NOT NULL,
  window_start bigint NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (key, window_start)
);
CREATE INDEX login_windows_expiry_idx ON nina_auth.login_windows (window_start);

REVOKE ALL ON ALL TABLES IN SCHEMA nina_auth FROM PUBLIC;
