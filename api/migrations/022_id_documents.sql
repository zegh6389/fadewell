-- id_documents: encrypted government photo ID captures for age/identity verification.
-- One current document per intake (re-upload replaces); every upload is audited.
-- Image bytes live in encrypted_payload (AES-GCM via the app seal); only metadata is queryable.
CREATE TABLE id_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL UNIQUE REFERENCES intakes(id),
  patient_id uuid NOT NULL REFERENCES identities(id),
  id_type text NOT NULL CHECK (id_type IN ('DRIVERS_LICENSE', 'STATE_ID', 'PASSPORT', 'MILITARY_ID')),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX id_documents_patient_idx ON id_documents(patient_id);
