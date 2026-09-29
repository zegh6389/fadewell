-- 012_prescriptions.sql may already be checksummed, so remove the unsupported cleartext refill
-- counter in a corrective migration. Refill requests remain fixed at zero at the API boundary
-- until fill accounting exists. amount_oz is retained only for rolling-cap enforcement.
ALTER TABLE prescriptions DROP COLUMN refills_remaining;

COMMENT ON COLUMN prescriptions.amount_oz IS
  'Approved restricted aggregate: ounces issued, readable only by the API role with intake_id, metric, and signed_at for patient-and-metric rolling-cap enforcement';
