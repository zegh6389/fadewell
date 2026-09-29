-- Add the patient-declared US state code as a queryable column on intakes. Encrypted payload still
-- carries it (defence-in-depth: PHI storage stays symmetric), but staff triage, regulator exports,
-- and appointment routing all need to filter by state without decrypting PHI for every row.
--
-- Phased migration (production-safe):
--   1. Column is added NULLABLE so legacy rows can land during data migration
--      without a NOT NULL violation.
--   2. The FK is declared NOT VALID so the initial table scan that would
--      otherwise hold a SHARE ROW EXCLUSIVE lock on both `intakes` and
--      `jurisdictions` for the duration of the validation is skipped.
--      Writes against `intakes` are not blocked by constraint creation.
--   3. A subsequent migration (015_intake_state_code_promote.sql) is
--      responsible for backfilling state_code from the legacy data import,
--      VALIDATE CONSTRAINT, and finally ALTER COLUMN ... SET NOT NULL.
--      That migration is currently a documented no-op (no legacy import
--      tool exists yet) — see its header comment for the SQL to run when
--      legacy data is ready.
ALTER TABLE intakes ADD COLUMN state_code text;
ALTER TABLE intakes
  ADD CONSTRAINT intakes_state_code_fkey
  FOREIGN KEY (state_code) REFERENCES jurisdictions(code)
  NOT VALID;
-- @concurrent
CREATE INDEX CONCURRENTLY IF NOT EXISTS intakes_state_code ON intakes(state_code);
