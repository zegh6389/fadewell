-- Run only after the legacy import has populated intakes.state_code for every
-- historical row. This is intentionally outside migrations/: deployment must
-- not record the promotion as complete until the data prerequisite is true.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM intakes WHERE state_code IS NULL) THEN
    RAISE EXCEPTION 'INTAKES_STATE_CODE_BACKFILL_INCOMPLETE';
  END IF;
END
$$;

ALTER TABLE intakes
  ADD CONSTRAINT intakes_state_code_not_null
  CHECK (state_code IS NOT NULL) NOT VALID;
ALTER TABLE intakes VALIDATE CONSTRAINT intakes_state_code_not_null;
ALTER TABLE intakes VALIDATE CONSTRAINT intakes_state_code_fkey;
ALTER TABLE intakes ALTER COLUMN state_code SET NOT NULL;
ALTER TABLE intakes DROP CONSTRAINT intakes_state_code_not_null;

COMMIT;
