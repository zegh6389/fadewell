-- Distinguish "permanently dead, needs human intervention" (DLQ) from "will retry next cycle"
-- (FAILED was overloaded for both states). Also capture the provider outcome + attempt number
-- directly on the row so an operator opening a DLQ ticket can see WHY it died without having to
-- correlate audit_events.
--
-- DLQ notifications are not picked up by the runDeliveryCycle claim filter (which only selects
-- QUEUED / BLOCKED / UNAVAILABLE / RETRY), so once a row enters DLQ it stays there until a human
-- replays it (Phase 5 follow-up: admin endpoint `POST /api/v1/admin/outbox/replay/:id`).
ALTER TABLE notifications ADD COLUMN last_error text;
ALTER TABLE notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('QUEUED','BLOCKED','UNAVAILABLE','SENDING','SENT','RETRY','FAILED','UNCERTAIN','SKIPPED','DLQ')) NOT VALID;
-- VALIDATE CONSTRAINT runs separately after this migration commits; never inline here (migrate() holds the write lock to commit).