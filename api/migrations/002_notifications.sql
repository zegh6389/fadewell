ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_status_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_status_check CHECK (status IN ('QUEUED','PROCESSED','SKIPPED','SENDING','SENT','FAILED','UNAVAILABLE')) NOT VALID;
-- VALIDATE CONSTRAINT runs separately after this migration commits; never inline here (migrate() holds the write lock to commit).

CREATE TABLE contact_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES intakes(id),
  channel text NOT NULL CHECK (channel IN ('EMAIL','SMS')),
  encrypted_destination text NOT NULL,
  verified_by uuid NOT NULL REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX contact_one_active ON contact_verifications(intake_id,channel) WHERE revoked_at IS NULL;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES outbox_events(id),
  intake_id uuid NOT NULL REFERENCES intakes(id),
  channel text NOT NULL CHECK (channel IN ('EMAIL','SMS')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','BLOCKED','UNAVAILABLE','SENDING','SENT','RETRY','FAILED','UNCERTAIN','SKIPPED')),
  attempts integer NOT NULL DEFAULT 0,
  lease_id uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  provider_receipt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,channel)
);
CREATE INDEX notifications_due ON notifications(status,available_at);
CREATE TABLE notification_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id),
  attempt integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('STARTED','ACCEPTED','RETRY','FAILED','UNCERTAIN')),
  provider_receipt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,attempt,outcome)
);
CREATE TRIGGER attempts_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON notification_attempts FOR EACH STATEMENT EXECUTE FUNCTION protect_history();
COMMENT ON COLUMN contact_verifications.encrypted_destination IS 'PHI: encrypted staff-confirmed destination; revoke when intake contact changes';
REVOKE ALL ON contact_verifications, notifications, notification_attempts FROM PUBLIC;
