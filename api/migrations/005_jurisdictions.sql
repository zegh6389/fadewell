-- jurisdictions: which states the platform operates in and the per-state consultation rules.
-- Allowed visit types and notice periods are enforced at intake creation time; the row is the
-- single source of truth and replaces the static `comingSoon` set in web/src/data/siteData.js.
-- Unlike append-only tables (questionnaires, audit_events), jurisdictions are operational data that
-- legitimately evolves — statuses move from COMING_SOON to AVAILABLE, new states are added. Use a
-- standard updated_at touch trigger instead of protect_history().
CREATE TABLE jurisdictions (
  code text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('AVAILABLE', 'COMING_SOON', 'NOT_SUPPORTED')),
  allowed_visit_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  notice_period_hours integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jurisdictions_status_idx ON jurisdictions(status, code);
