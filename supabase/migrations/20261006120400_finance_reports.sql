-- ==================================================================
-- Rapports financiers: monthly aggregates for the reports page (ADR-006 section 5).
--
-- Two read-only views, security_invoker like every view here (ADR-003 section 5.2): the CALLER's
-- policies on payments, charges and charge_discounts apply, so an administrator aggregates
-- everything and a teacher nothing. One row per month x formation x method (or fee type): a few
-- hundred rows a year whatever the number of payments. Period filtering happens on `month`.
--
-- ROLLBACK: DROP VIEW public.finance_payments_monthly, public.finance_charges_monthly;
-- ==================================================================

CREATE OR REPLACE VIEW public.finance_payments_monthly
WITH (security_invoker = true) AS
SELECT date_trunc('month', p.paid_on)::date AS month,
       g.program_id,
       pg.name                               AS program_name,
       p.method,
       sum(p.amount_dzd)::bigint             AS total_dzd,
       count(*)::int                         AS payment_count
  FROM public.payments p
  JOIN public.registrations r ON r.id = p.registration_id
  LEFT JOIN public.groups g ON g.id = r.group_id
  LEFT JOIN public.programs pg ON pg.id = g.program_id
 GROUP BY 1, 2, 3, 4;

-- Fees by the month they were created, with the discounts granted on them (active only).
CREATE OR REPLACE VIEW public.finance_charges_monthly
WITH (security_invoker = true) AS
SELECT date_trunc('month', c.created_at)::date AS month,
       g.program_id,
       pg.name                                AS program_name,
       c.fee_type,
       sum(c.amount_dzd)::bigint              AS charged_dzd,
       count(*)::int                          AS charge_count,
       coalesce(sum((SELECT sum(d.amount_dzd) FROM public.charge_discounts d
                      WHERE d.charge_id = c.id AND d.status = 'active')), 0)::bigint AS discounted_dzd
  FROM public.charges c
  JOIN public.registrations r ON r.id = c.registration_id
  LEFT JOIN public.groups g ON g.id = r.group_id
  LEFT JOIN public.programs pg ON pg.id = g.program_id
 WHERE c.status = 'active'
 GROUP BY 1, 2, 3, 4;

GRANT SELECT ON public.finance_payments_monthly, public.finance_charges_monthly TO authenticated;
REVOKE ALL ON public.finance_payments_monthly, public.finance_charges_monthly FROM anon;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN ('finance_payments_monthly', 'finance_charges_monthly')
       AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false)) THEN
    RAISE EXCEPTION 'SECURITY: a finance view lacks security_invoker=true; it would bypass RLS';
  END IF;
  RAISE NOTICE 'Finance report views installed.';
END $$;
