-- Per-recipient rate limit status (Phase 9). Sibling to dedupe: dedupe catches "same template
-- within 5 min", rate budget catches "many distinct templates within 1 hour". When a recipient
-- has received MAX_PER_HOUR sends in the last hour, the cycle marks the next notification
-- RATE_LIMITED with last_error populated, sets available_at = now + 1 hour so the cycle retries
-- after the budget resets, and audits so ops sees what happened.
--
-- MAX_PER_HOUR is hardcoded in delivery.ts for now (5); a future config-driven rollout can
-- read it from app config without another schema change.
ALTER TABLE notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('QUEUED','BLOCKED','UNAVAILABLE','SENDING','SENT','RETRY','FAILED','UNCERTAIN','SKIPPED','DLQ','RATE_LIMITED')) NOT VALID;