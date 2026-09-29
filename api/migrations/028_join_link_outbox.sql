-- Store one-use consultation links encrypted until the worker sends or skips them.
ALTER TABLE outbox_events ADD COLUMN encrypted_payload text;
COMMENT ON COLUMN outbox_events.encrypted_payload IS 'Encrypted one-use consultation link; never expose to API clients or logs';
