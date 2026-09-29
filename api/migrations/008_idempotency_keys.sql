-- Idempotency keys for PHI-mutating actions. Clients send an `Idempotency-Key` header (a UUID or
-- other opaque token up to 255 chars) and the server replays the original response if the same key
-- is presented again within the TTL window. This stops a flaky mobile network / impatient finger
-- from creating duplicate intakes, double-issuing certificates, or double-charging the patient.
--
-- Scoped by `(scope, actor_id)`:
--   scope   - the route handler, e.g. 'intake:put'. Stops a key generated for the intake endpoint
--             being valid against the appointment endpoint.
--   actor_id - the patient / staff identity. Stops one tenant replaying against another's resources
--             even if their key generators collided.
--
-- The row stores the captured response body and status. Subsequent replays return this verbatim —
-- including the same error code — so the client sees a consistent view of what the server first
-- decided. If the first call errored, the client must use a new key to retry; this matches Stripe.
--
-- The deployed worker owns an hourly cleanup cycle that deletes rows older than 24 hours and
-- emits both an audit event and structured completion/failure logs. The created_at index is the
-- cleanup scan key.
CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  actor_id uuid NOT NULL REFERENCES identities(id),
  key text NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, actor_id, key),
  CHECK (char_length(key) BETWEEN 1 AND 255)
);
CREATE INDEX idempotency_keys_ttl ON idempotency_keys(created_at);
