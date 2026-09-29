-- A provider send skipped by recipient/template deduplication is not a
-- confirmed delivery and must not consume the recipient's SENT budget.
ALTER TABLE notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('QUEUED','BLOCKED','UNAVAILABLE','SENDING','SENT','RETRY','FAILED','UNCERTAIN','SKIPPED','DLQ','RATE_LIMITED','DEDUPLICATED')) NOT VALID;

ALTER TABLE notification_attempts DROP CONSTRAINT notification_attempts_outcome_check;
ALTER TABLE notification_attempts ADD CONSTRAINT notification_attempts_outcome_check
  CHECK (outcome IN ('STARTED','ACCEPTED','RETRY','FAILED','UNCERTAIN','DEDUPLICATED')) NOT VALID;
