-- Apply after runtime-grants.sql on the dedicated Supabase project.
-- Only the restricted API role accesses clinical tables; the browser never uses PostgREST.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schema_migrations','identities','sessions','login_states','questionnaires',
    'intakes','intake_revisions','notes','availability','appointments','consultations','audit_events',
    'outbox_events','contact_verifications','notifications','notification_attempts','local_credentials',
    'jurisdictions','jurisdiction_prescription_caps','prescriptions','id_documents','idempotency_keys']
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS mca_backend ON public.%I', t);
    EXECUTE format('CREATE POLICY mca_backend ON public.%I TO mca_runtime USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.protect_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_history() TO mca_runtime;
