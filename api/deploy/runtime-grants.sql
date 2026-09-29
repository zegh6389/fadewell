-- Run once with migration-owner credentials. mca_runtime is a group role, not a login.
-- Grant membership to a separately created API login using your secret-management process.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mca_runtime') THEN
    CREATE ROLE mca_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mca_runtime' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Existing runtime role is not suitable';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO mca_runtime;
GRANT SELECT ON identities, questionnaires, intakes, intake_revisions, notes, availability,
  appointments, consultations, audit_events, outbox_events, schema_migrations, jurisdictions,
  jurisdiction_prescription_caps, idempotency_keys TO mca_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, login_states TO mca_runtime;
GRANT INSERT ON identities, intakes, intake_revisions, notes, availability, appointments,
  consultations, audit_events, outbox_events, idempotency_keys TO mca_runtime;
GRANT DELETE ON idempotency_keys TO mca_runtime;
GRANT DELETE ON availability TO mca_runtime;
-- SELECT ... FOR UPDATE on the booking slot requires UPDATE on at least one column.
GRANT UPDATE (buffer_minutes) ON availability TO mca_runtime;
GRANT UPDATE (enabled) ON identities TO mca_runtime;
GRANT UPDATE ON intakes, appointments, consultations TO mca_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mca_runtime;
GRANT EXECUTE ON FUNCTION protect_history() TO mca_runtime;
GRANT SELECT, INSERT, UPDATE ON id_documents TO mca_runtime;
GRANT SELECT, INSERT ON contact_verifications TO mca_runtime;
GRANT UPDATE (revoked_at) ON contact_verifications TO mca_runtime;
GRANT SELECT ON notifications, notification_attempts TO mca_runtime;
GRANT SELECT, INSERT ON idempotency_keys TO mca_runtime;
-- amount_oz is an approved restricted aggregate used only with intake_id,
-- metric, and signed_at to enforce the patient-and-metric rolling cap.
GRANT SELECT (intake_id, metric, signed_at, amount_oz) ON prescriptions TO mca_runtime;
GRANT INSERT (id, intake_id, doctor_id, jurisdiction_code, amount_oz, metric, period_days,
  encrypted_payload, expires_at) ON prescriptions TO mca_runtime;
REVOKE UPDATE (available_at) ON notifications FROM mca_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON local_credentials TO mca_runtime;
GRANT UPDATE (password_hash, encrypted_totp_secret, totp_last_step, totp_verified, version,
  failed_login_attempts, locked_until, password_updated_at) ON local_credentials TO mca_runtime;
-- No UPDATE/DELETE/TRUNCATE on audit, revisions, notes, or questionnaires; availability has only the narrow row-lock UPDATE above.
-- Authentication handles duplicate patient provisioning by selecting the existing identity.
