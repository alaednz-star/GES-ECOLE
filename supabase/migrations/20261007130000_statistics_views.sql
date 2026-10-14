-- ==================================================================
-- Statistiques: attendance aggregated per month and group (ADR-007).
--
-- One row per month x group instead of every attendance mark, so the statistics page stays one
-- small read. security_invoker: the caller's attendance policies apply (admins everything, a
-- teacher their own groups, a student their own marks).
--
-- ROLLBACK: DROP VIEW public.attendance_monthly_stats;
-- ==================================================================

CREATE OR REPLACE VIEW public.attendance_monthly_stats
WITH (security_invoker = true) AS
SELECT date_trunc('month', a.session_date)::date          AS month,
       a.group_id,
       count(*) FILTER (WHERE a.status = 'present')::int   AS present,
       count(*) FILTER (WHERE a.status = 'late')::int      AS late,
       count(*) FILTER (WHERE a.status = 'excused')::int   AS excused,
       count(*) FILTER (WHERE a.status = 'absent')::int    AS absent,
       count(*)::int                                       AS total
  FROM public.attendance a
 GROUP BY 1, 2;

GRANT SELECT ON public.attendance_monthly_stats TO authenticated;
REVOKE ALL ON public.attendance_monthly_stats FROM anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'attendance_monthly_stats'
       AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION 'SECURITY: attendance_monthly_stats lacks security_invoker=true';
  END IF;
END $$;
