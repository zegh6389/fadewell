-- Migration 005 is already checksummed in deployed databases. Add the missing
-- updated_at trigger here so normal upgrades receive the correction without
-- rewriting migration history.
CREATE FUNCTION touch_jurisdictions_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER jurisdictions_touch_updated_at
BEFORE UPDATE ON jurisdictions
FOR EACH ROW EXECUTE FUNCTION touch_jurisdictions_updated_at();

REVOKE ALL ON FUNCTION touch_jurisdictions_updated_at() FROM PUBLIC;
