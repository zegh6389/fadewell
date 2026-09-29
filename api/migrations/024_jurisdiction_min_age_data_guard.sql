-- Migration 021 is already checksummed in deployed databases. Re-assert its data
-- through a guarded corrective migration rather than rewriting migration history.
-- Platform policy effective date: 2026-09-17.
-- Authoritative medical-program references reviewed 2026-09-18:
--   AK: https://health.alaska.gov/en/education/drugs-and-alcohol/marijuana/medical-marijuana/
--   ME: https://www.maine.gov/dafs/ocp/medical-use/certification-process
--   WA: https://doh.wa.gov/you-and-your-family/cannabis/medical-cannabis/patient-information/frequently-asked-questions
DO $$
DECLARE
  matching_jurisdictions integer;
BEGIN
  SELECT count(*) INTO matching_jurisdictions
  FROM jurisdictions
  WHERE code IN ('AK', 'ME', 'WA');

  IF matching_jurisdictions <> 3 THEN
    RAISE EXCEPTION 'Expected exactly three jurisdictions for the minimum-age update, found %',
      matching_jurisdictions;
  END IF;

  UPDATE jurisdictions
  SET min_age = 21,
      updated_at = now()
  WHERE code IN ('AK', 'ME', 'WA');
END;
$$;
