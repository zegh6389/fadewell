-- The recipient dedupe and rate windows filter updated_at, so the lookup index
-- must cover updated_at instead of created_at. All-concurrent like 019.
-- @concurrent
DROP INDEX CONCURRENTLY IF EXISTS notifications_dedupe;
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_dedupe
  ON notifications(channel, last_recipient_hash, updated_at)
  WHERE last_recipient_hash <> '';
