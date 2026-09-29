-- Per-state medical-cannabis minimum patient age. Default 18 (most states); 21 for
-- the few that pin adult purchase at 21 even for medical (Alaska, Maine, Washington).
-- The intake questionnaire surfaces this as a yes/no question on step 2 and the
-- patient's answer lands in the same encrypted_payload as the rest of the form.
ALTER TABLE jurisdictions
  ADD COLUMN min_age smallint NOT NULL DEFAULT 18
  CHECK (min_age BETWEEN 18 AND 21);