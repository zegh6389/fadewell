ALTER TABLE sessions ADD COLUMN join_appointment_id uuid;
ALTER TABLE sessions ADD CONSTRAINT sessions_join_appointment_id_fkey
  FOREIGN KEY (join_appointment_id) REFERENCES appointments(id) NOT VALID;
-- Password-only workforce sessions issued before MFA enforcement cannot remain valid.
DELETE FROM sessions WHERE actor_id IN (SELECT id FROM identities WHERE role IN ('DOCTOR', 'STAFF'));

-- @concurrent
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_join_appointment_id_fkey;
