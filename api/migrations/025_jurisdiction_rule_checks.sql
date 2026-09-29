-- Constrain jurisdiction rule values at the source of truth so an operational
-- update cannot create rules the application cannot enforce. Allowed visit
-- types match jurisdictionSchema (VIDEO, PHONE, IN_PERSON): modes such as
-- EITHER and WEB_AUDIO are patient-declared and mapped by visitTypesForMode,
-- never stored here.
-- Constraints land NOT VALID so the migration transaction never scans under
-- ACCESS EXCLUSIVE; validation runs post-transaction under the weaker
-- SHARE UPDATE EXCLUSIVE lock via the runner's concurrent phase.
ALTER TABLE jurisdictions
  ADD CONSTRAINT jurisdictions_allowed_visit_types_check
    CHECK (allowed_visit_types <@ ARRAY['VIDEO', 'PHONE', 'IN_PERSON']::text[]) NOT VALID,
  ADD CONSTRAINT jurisdictions_notice_period_hours_check
    CHECK (notice_period_hours >= 0) NOT VALID;
-- @concurrent
ALTER TABLE jurisdictions
  VALIDATE CONSTRAINT jurisdictions_allowed_visit_types_check;
ALTER TABLE jurisdictions
  VALIDATE CONSTRAINT jurisdictions_notice_period_hours_check;
