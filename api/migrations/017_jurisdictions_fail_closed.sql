-- Correct the permissive placeholders introduced by the already-applied 006 seed without
-- changing that migration's checksum. A row is changed only while it still exactly matches
-- an unreviewed VIDEO/0 placeholder; an operator-tightened production rule is left intact.
-- Review-approved AVAILABLE rules belong in a later, dedicated migration with their source
-- and effective date. No such approvals are recorded in this repository today.
UPDATE jurisdictions
SET status = 'COMING_SOON',
    allowed_visit_types = ARRAY[]::text[],
    updated_at = now()
WHERE notice_period_hours = 0
  AND (
    (status = 'AVAILABLE' AND allowed_visit_types = ARRAY['VIDEO']::text[])
    OR
    (code = 'CA' AND status = 'AVAILABLE' AND allowed_visit_types = ARRAY['VIDEO','PHONE']::text[])
  );
