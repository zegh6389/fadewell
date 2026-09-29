-- Add local credentials without changing identity IDs or clinical/audit references.
-- Separate storage prevents notification-worker access to password hashes and MFA secrets.
CREATE TABLE local_credentials (
  identity_id uuid PRIMARY KEY REFERENCES identities(id),
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9_.-]{3,64}$'),
  password_hash text NOT NULL,
  encrypted_totp_secret text,
  totp_verified boolean NOT NULL DEFAULT false,
  totp_last_step bigint,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until timestamptz,
  password_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX local_credentials_username ON local_credentials(lower(username));
ALTER TABLE local_credentials ENABLE ROW LEVEL SECURITY;
-- The old provider cannot leave authenticated workforce sessions behind after cutover.
DELETE FROM sessions USING identities WHERE sessions.actor_id=identities.id AND identities.role<>'PATIENT';
DELETE FROM login_states;
-- Roll back application code only after a deliberate auth decision. Preserve this additive table.
