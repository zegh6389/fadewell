-- Per-recipient dedupe window. Phase 8 (OC2) — without this, a stuck retry loop or a stale
-- outbox row can send the same template to the same recipient twice within seconds. Patients
-- call this "spamming" and it burns the Telnyx rate budget.
--
-- recipient_hash is SHA-256 over "channel:recipient" — hashed not encrypted so the dedupe
-- query is a single indexed lookup without decrypting each candidate. Hash, not the raw
-- recipient, so PHI stays in the encrypted payload.
--
-- The dedupe query joins notification_attempts to notifications to get channel; the index
-- therefore has to live on notifications (where channel + provider_receipt already exist)
-- and reference recipient_hash through the attempt FK. notifications gets a denormalised
-- last_recipient_hash so the index can serve the lookup without the join.
ALTER TABLE notification_attempts ADD COLUMN recipient_hash text NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN last_recipient_hash text NOT NULL DEFAULT '';
-- @concurrent
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_dedupe ON notifications(channel, last_recipient_hash, created_at)
  WHERE last_recipient_hash <> '';
