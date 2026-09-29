-- Prescriptions issued by a doctor after a verified consult. Stored encrypted (PHI: dose,
-- product, refills, signed attestation); the signed_at + doctor_id + intake_id columns are the
-- regulator-facing canonical record and stay in cleartext for staff triage and dispensary
-- lookup. protect_history trigger on prescriptions keeps the signed record append-only.
--
-- Phase 7 ships the table and the cap-enforcement endpoint. PDF generation, outbox events,
-- and dispensary-lookup oracle are separate follow-up stories.
CREATE TABLE prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES intakes(id),
  doctor_id uuid NOT NULL REFERENCES identities(id),
  jurisdiction_code text NOT NULL REFERENCES jurisdictions(code),
  amount_oz numeric NOT NULL CHECK (amount_oz > 0),
  refills_remaining integer NOT NULL DEFAULT 0 CHECK (refills_remaining >= 0),
  metric text NOT NULL CHECK (metric IN ('OZ_PER_30D','GRAMS_THC_PER_30D','PERCENT_THC','SUPPLY_DAYS')),
  period_days integer NOT NULL CHECK (period_days BETWEEN 1 AND 365),
  encrypted_payload text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (intake_id, signed_at)
);
CREATE INDEX prescriptions_patient ON prescriptions(intake_id, signed_at DESC);
CREATE INDEX prescriptions_doctor ON prescriptions(doctor_id, signed_at DESC);

CREATE TRIGGER prescriptions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON prescriptions FOR EACH STATEMENT EXECUTE FUNCTION protect_history();

COMMENT ON COLUMN prescriptions.encrypted_payload IS 'PHI: AES-256-GCM encrypted prescription detail; resource-bound AAD';