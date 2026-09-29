-- Rebuild indexes created by already-applied migrations 007 and 013 without changing those
-- migrations' checksums. The migration runner executes each statement after the transaction.
-- @concurrent
DROP INDEX CONCURRENTLY IF EXISTS intakes_state_code;
CREATE INDEX CONCURRENTLY IF NOT EXISTS intakes_state_code ON intakes(state_code);
DROP INDEX CONCURRENTLY IF EXISTS notifications_dedupe;
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_dedupe
  ON notifications(channel, last_recipient_hash, created_at)
  WHERE last_recipient_hash <> '';
