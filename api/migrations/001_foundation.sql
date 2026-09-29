CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('PATIENT', 'DOCTOR', 'STAFF', 'ADMIN')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES identities(id),
  csrf text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_actor ON sessions(actor_id);

CREATE TABLE login_states (
  state_hash text PRIMARY KEY,
  encrypted_payload text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE questionnaires (
  version text PRIMARY KEY,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES identities(id),
  questionnaire_version text NOT NULL REFERENCES questionnaires(version),
  encrypted_payload text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'REVIEW_PENDING', 'NEEDS_CORRECTION', 'VERIFIED', 'SCHEDULED', 'COMPLETED', 'CANCELLED')),
  issues text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  submission_version integer,
  save_key uuid
);
CREATE UNIQUE INDEX intakes_one_open ON intakes(patient_id) WHERE state NOT IN ('COMPLETED', 'CANCELLED');
CREATE INDEX intakes_queue ON intakes(state, updated_at);

CREATE TABLE intake_revisions (
  intake_id uuid NOT NULL REFERENCES intakes(id),
  version integer NOT NULL,
  encrypted_payload text NOT NULL,
  actor_id uuid NOT NULL REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intake_id, version)
);

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES intakes(id),
  actor_id uuid NOT NULL REFERENCES identities(id),
  kind text NOT NULL CHECK (kind IN ('REVIEW', 'CONTACT', 'INTERNAL')),
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_intake ON notes(intake_id, created_at);

CREATE TABLE availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES identities(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  buffer_minutes integer NOT NULL DEFAULT 5 CHECK (buffer_minutes BETWEEN 0 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES intakes(id),
  patient_id uuid NOT NULL REFERENCES identities(id),
  doctor_id uuid NOT NULL REFERENCES identities(id),
  availability_id uuid NOT NULL REFERENCES availability(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reserved_until timestamptz NOT NULL,
  timezone text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('VIDEO', 'WEB_AUDIO', 'PHONE')),
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identities(id),
  request_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, request_key),
  CHECK (ends_at > starts_at AND reserved_until >= ends_at),
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, reserved_until, '[)') WITH &&) WHERE (status = 'CONFIRMED'),
  EXCLUDE USING gist (patient_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'CONFIRMED')
);
CREATE UNIQUE INDEX appointments_one_active_intake ON appointments(intake_id) WHERE status = 'CONFIRMED';
CREATE INDEX appointments_doctor ON appointments(doctor_id, starts_at);
CREATE INDEX appointments_patient ON appointments(patient_id, starts_at);

CREATE TABLE consultations (
  id uuid PRIMARY KEY REFERENCES appointments(id),
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'ACTIVE', 'PAUSED', 'ENDED')),
  duration integer NOT NULL CHECK (duration BETWEEN 60 AND 14400),
  elapsed double precision NOT NULL DEFAULT 0 CHECK (elapsed >= 0),
  running_since timestamptz,
  version integer NOT NULL DEFAULT 1,
  modified_by uuid REFERENCES identities(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES identities(id),
  actor_role text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_time ON audit_events(created_at DESC);
CREATE INDEX audit_events_resource ON audit_events(resource_id, created_at);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  resource_id uuid NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNAVAILABLE')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due ON outbox_events(status, available_at);

CREATE FUNCTION protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History is append only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION protect_history();
CREATE TRIGGER revisions_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON intake_revisions FOR EACH STATEMENT EXECUTE FUNCTION protect_history();
CREATE TRIGGER notes_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON notes FOR EACH STATEMENT EXECUTE FUNCTION protect_history();
CREATE TRIGGER questionnaires_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON questionnaires FOR EACH STATEMENT EXECUTE FUNCTION protect_history();

COMMENT ON COLUMN intakes.encrypted_payload IS 'PHI: AES-256-GCM encrypted raw/normalized intake values; resource-bound AAD';
COMMENT ON COLUMN intake_revisions.encrypted_payload IS 'PHI: immutable encrypted intake version';
COMMENT ON COLUMN notes.encrypted_payload IS 'PHI: encrypted staff review or contact note';
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
