-- Migration 004 adds the secure patient join token, the doctor room column, and a per-consultation join audit.
ALTER TABLE appointments
  ADD COLUMN patient_join_token_hash text,
  ADD COLUMN patient_join_token_expires_at timestamptz,
  ADD COLUMN video_room_id text;
ALTER TABLE consultations
  ADD COLUMN doctor_join_token_hash text,
  ADD COLUMN doctor_join_token_expires_at timestamptz;
COMMENT ON COLUMN appointments.patient_join_token_hash IS 'SHA-256 hash of the patient consultation join token; never store the raw token';
COMMENT ON COLUMN appointments.video_room_id IS 'Opaque room identifier issued by the telehealth provider; tokens are minted on demand';
COMMENT ON COLUMN consultations.doctor_join_token_hash IS 'SHA-256 hash of the doctor consultation join token';
