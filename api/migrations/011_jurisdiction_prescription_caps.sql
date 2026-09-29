-- Per-state prescription caps. Each US state has different limits on how much product a
-- certified patient may be dispensed (e.g., OK caps at 3 oz per 30 days, PA caps at 30 grams
-- THC per 30 days). The caps are legislative, change annually, and must be enforced at the
-- server rather than left to the certifying physician (who drifts).
--
-- Effective windows (effective_from + effective_to) let us version caps without rewriting
-- history: a 2027 legislative update becomes a new row with effective_from = 2027-01-01; the
-- 2026 row keeps effective_to = 2027-01-01 so 2026 prescriptions still cite the cap they were
-- issued under.
--
-- Phase 7 ships the engine. Seeds (OK/PA/MN/AR/CO caps) are a follow-up operational task — the
-- engine must work correctly with zero seeds (fail closed) so we can ship without lockstep on
-- the regulatory team.
CREATE TABLE jurisdiction_prescription_caps (
  jurisdiction_code text NOT NULL REFERENCES jurisdictions(code),
  metric text NOT NULL CHECK ( metric IN ('OZ_PER_30D','GRAMS_THC_PER_30D','PERCENT_THC','SUPPLY_DAYS') ),
  max_value numeric NOT NULL CHECK (max_value > 0),
  period_days integer NOT NULL DEFAULT 30 CHECK (period_days BETWEEN 1 AND 365),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  PRIMARY KEY (jurisdiction_code, metric, effective_from),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (
    jurisdiction_code WITH =,
    metric WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);
-- Lookup pattern: "what caps apply to jurisdiction_code on or after date X?"
CREATE INDEX jurisdiction_prescription_caps_lookup
  ON jurisdiction_prescription_caps(jurisdiction_code, effective_from DESC);
