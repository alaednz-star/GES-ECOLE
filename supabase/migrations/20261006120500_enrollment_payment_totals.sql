-- ==================================================================
-- Payments received per enrollment, for Soldes & impayés and the reports (ADR-006 section 1).
--
-- One row per enrollment that has payments, instead of every payment: the balances page stays one
-- small read however many payments a centre records (PostgREST caps a response at max_rows).
-- security_invoker: the caller's payments policies apply (admins everything, a student their own,
-- teachers nothing).
--
-- ROLLBACK: DROP VIEW public.enrollment_payment_totals;
-- ==================================================================

CREATE OR REPLACE VIEW public.enrollment_payment_totals
WITH (security_invoker = true) AS
SELECT p.registration_id,
       sum(p.amount_dzd)::bigint AS paid_dzd,
       count(*)::int             AS payment_count,
       max(p.paid_on)            AS last_paid_on
  FROM public.payments p
 GROUP BY p.registration_id;

GRANT SELECT ON public.enrollment_payment_totals TO authenticated;
REVOKE ALL ON public.enrollment_payment_totals FROM anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'enrollment_payment_totals'
       AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION 'SECURITY: enrollment_payment_totals lacks security_invoker=true';
  END IF;
END $$;
