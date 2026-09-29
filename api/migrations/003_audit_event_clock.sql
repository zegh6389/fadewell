-- Record insertion time rather than transaction start, which can precede lock waits.
ALTER TABLE audit_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE notification_attempts ALTER COLUMN created_at SET DEFAULT clock_timestamp();
