-- Doctors can remove their own published availability windows.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mca_runtime') THEN
    GRANT DELETE ON availability TO mca_runtime;
  END IF;
END $$;
