DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mca_worker') THEN
    CREATE ROLE mca_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mca_worker' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolcanlogin OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Existing worker role is not suitable';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO mca_worker;
GRANT SELECT ON identities, intakes, appointments, contact_verifications, outbox_events, notifications, notification_attempts, audit_events TO mca_worker;
GRANT INSERT ON notifications, notification_attempts, audit_events TO mca_worker;
GRANT UPDATE ON outbox_events, notifications TO mca_worker;
GRANT SELECT (created_at), DELETE ON idempotency_keys TO mca_worker;
-- PostgreSQL row locks require UPDATE privilege. Keep that privilege inside
-- narrowly scoped definer functions so the worker cannot mutate source rows.
CREATE OR REPLACE FUNCTION public.mca_worker_lock_intake_patient(target_intake_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.identities p
    JOIN public.intakes i ON i.patient_id=p.id
    WHERE i.id=target_intake_id
    FOR SHARE OF p;
END;
$$;
CREATE OR REPLACE FUNCTION public.mca_worker_lock_latest_intake(target_patient_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.intakes
    WHERE patient_id=target_patient_id
    ORDER BY created_at DESC LIMIT 1
    FOR SHARE;
END;
$$;
CREATE OR REPLACE FUNCTION public.mca_worker_lock_appointment(target_appointment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.appointments WHERE id=target_appointment_id FOR SHARE;
END;
$$;
CREATE OR REPLACE FUNCTION public.mca_worker_lock_contact_verification(
  target_intake_id uuid, target_channel text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.contact_verifications
    WHERE intake_id=target_intake_id AND channel=target_channel AND revoked_at IS NULL
    FOR SHARE;
END;
$$;
REVOKE ALL ON FUNCTION public.mca_worker_lock_intake_patient(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mca_worker_lock_latest_intake(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mca_worker_lock_appointment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mca_worker_lock_contact_verification(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mca_worker_lock_intake_patient(uuid) TO mca_worker;
GRANT EXECUTE ON FUNCTION public.mca_worker_lock_latest_intake(uuid) TO mca_worker;
GRANT EXECUTE ON FUNCTION public.mca_worker_lock_appointment(uuid) TO mca_worker;
GRANT EXECUTE ON FUNCTION public.mca_worker_lock_contact_verification(uuid,text) TO mca_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mca_worker;
GRANT EXECUTE ON FUNCTION protect_history() TO mca_worker;
-- Supabase enables RLS separately. Worker access still requires the grants above.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['identities','intakes','appointments','contact_verifications',
    'outbox_events','notifications','notification_attempts','audit_events','idempotency_keys']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mca_delivery ON public.%I', t);
    EXECUTE format('CREATE POLICY mca_delivery ON public.%I TO mca_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
-- Grant this group to a dedicated worker login. Do not share API or migration credentials.
