-- Delivery-cycle row locks. Runtime code depends on these functions, so they
-- are created by migrations (not only by deploy-time grant scripts) to keep
-- fresh installs, CI, and production consistent. Role grants stay in
-- deploy/worker-grants.sql, which remains idempotent via CREATE OR REPLACE.
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
