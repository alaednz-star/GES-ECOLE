-- Session architecture, Phase 2A: the database foundation.
--
-- Reference: docs/ADR-003-session-architecture.md
--
-- WHY THIS MIGRATION EXISTS
--
-- The Présences page is being inverted: instead of asking the user to name a
-- group and a date from memory, it will show the schedule and let them click a
-- session. That calendar needs two numbers per session -- how many students are
-- enrolled, and how many have been marked -- for every session in a date
-- window, at once.
--
-- Neither number can be obtained correctly from the client today.
--
-- 1. PARTIAL ATTENDANCE IS UNDETECTABLE.
--    `useMarkedSessions` selects (group_id, session_date) and collapses it to a
--    boolean "was this marked?". That cannot express "6 of 14 marked". The
--    calendar needs to distinguish complete from partial from untouched.
--
-- 2. COUNTING ROWS CLIENT-SIDE IS A CORRECTNESS BUG, NOT A SLOW PATH.
--    The obvious alternative -- fetch the window's attendance rows and count in
--    JS -- silently under-reports. `useAttendanceRange` caps at .limit(2000)
--    with no truncation detection. A month view for a whole school is plausibly
--    30 groups x 4 sessions x 20 students = 2,400 rows. Past the cap rows
--    vanish, sessions look unmarked or half-marked, and the "en retard" counter
--    reads LOW -- i.e. the product under-reports work the teacher owes, which is
--    the one number it exists to get right.
--
--    Aggregating in Postgres removes the cap as a concept: ~2,400 rows collapse
--    to ~120, one per session.
--
-- 3. ENROLMENT COUNTS COST A FULL TABLE SCAN, TWICE.
--    `useGroups` fetches EVERY registrations row to compute integer counts, and
--    `useRegistrations` fetches every row plus every profile for the same
--    purpose. Two unbounded scans of the fastest-growing table, behind 14
--    call sites. `enrolled = 0` drives real behaviour (a session with no
--    students is not "overdue", it is "no students enrolled"), so the number
--    must be exact.
--
-- WHY VIEWS RATHER THAN AN RPC
--
-- A view is composable: PostgREST gives .gte()/.lte()/.in() filtering for free,
-- so ONE object serves the calendar window, a single session lookup, and future
-- reports. An RPC fixes its argument list at design time and would need a new
-- signature per caller.
--
-- SECURITY -- THE CRITICAL DETAIL
--
-- Both views are `security_invoker = true`. This codebase has no view precedent
-- to copy, so it is spelled out: a Postgres view WITHOUT this flag executes as
-- its OWNER, which BYPASSES the row-level security of the tables underneath.
-- Created carelessly, `session_attendance_summary` would expose every group's
-- attendance to every authenticated user -- a horizontal privilege escalation
-- across teachers.
--
-- With security_invoker, the caller's own policies apply to the underlying
-- tables, so the existing `attendance read` and `registrations read` policies
-- keep deciding which rows are visible. Teacher scoping is inherited, not
-- reimplemented. Nothing here re-states an authorisation rule; that is
-- deliberate, because a copy of a policy is a policy that can drift.
--
-- BACKWARD COMPATIBILITY
--
-- Purely additive. No table, column, constraint, policy, trigger or function is
-- altered or dropped. No existing index is removed -- see section 3 for why the
-- pre-existing attendance indexes are all still required. Every existing hook
-- (useMarkedSessions, useAttendance, useAttendanceRange, useMyAttendance,
-- useTodayAttendance, useGroups, useRegistrations) keeps its exact behaviour;
-- `teacher-workspace.ts` in particular depends on useMarkedSessions' semantics,
-- so the new aggregate ships ALONGSIDE it rather than replacing it.
--
-- ROLLBACK
--   DROP VIEW IF EXISTS public.session_attendance_summary;
--   DROP VIEW IF EXISTS public.group_enrollment_counts;
--   DROP INDEX IF EXISTS public.idx_attendance_date_group;
--
-- Safe: no data is written, and nothing yet reads these objects (the TypeScript
-- layer arrives in Phase 2B).

-- ------------------------------------------------------------------
-- 1. Per-session attendance aggregate
--
-- One row per (group_id, session_date) -- which, thanks to
-- `group_schedules_one_per_day` (UNIQUE (group_id, weekday)), is exactly one
-- session. See ADR-003 section 2: session identity is already guaranteed by the
-- schema, so this view needs no session id of its own.
--
-- Rows appear here only for sessions that have at least one attendance row. A
-- session with nothing marked is ABSENT from this view rather than present with
-- marked_count = 0 -- the client LEFT JOINs it onto the occurrences expanded
-- from the timetable, and a missing row means "nothing marked". Emitting zero
-- rows for unmarked sessions is not possible anyway: this view reads
-- `attendance`, and an unmarked session has no attendance rows to read.
--
-- Per-status counts are included because the drawer and the future reports both
-- need them, and they cost nothing once the rows are already grouped:
-- FILTER (WHERE ...) is a single pass.
-- ------------------------------------------------------------------

CREATE OR REPLACE VIEW public.session_attendance_summary
WITH (security_invoker = true) AS
SELECT
  a.group_id,
  a.session_date,
  -- Distinct students, not raw rows. UNIQUE (group_id, student_id,
  -- session_date) already makes these equal; count(DISTINCT) states the intent
  -- and survives the constraint being relaxed.
  count(DISTINCT a.student_id)::integer AS marked_count,
  count(DISTINCT a.student_id) FILTER (WHERE a.status = 'present')::integer AS present_count,
  count(DISTINCT a.student_id) FILTER (WHERE a.status = 'absent')::integer  AS absent_count,
  count(DISTINCT a.student_id) FILTER (WHERE a.status = 'late')::integer    AS late_count,
  count(DISTINCT a.student_id) FILTER (WHERE a.status = 'excused')::integer AS excused_count,
  -- Lets a client detect "someone edited this since I loaded it" without
  -- fetching rows. Cheap here, and a prerequisite for the optimistic-locking
  -- option left open by audit finding P1-3.
  max(a.updated_at) AS last_marked_at
FROM public.attendance a
GROUP BY a.group_id, a.session_date;

COMMENT ON VIEW public.session_attendance_summary IS
  'One row per (group_id, session_date) = one session, per ADR-003. marked_count/present_count/... aggregate the attendance rows the CALLER may see (security_invoker), so teacher scoping is inherited from the attendance RLS policies. Sessions with nothing marked do not appear; the client treats a missing row as zero marked.';

-- ------------------------------------------------------------------
-- 2. Approved enrolment count per group
--
-- Replaces two unbounded client-side scans of `registrations` (see header
-- point 3). Only `approved` counts as enrolled: pending and rejected
-- registrations are not students in the room, and the existing
-- `enrolled` field in useGroups already filters this way -- this view matches
-- that definition exactly so no number changes anywhere in the product.
--
-- Groups with zero approved registrations DO appear, with 0. That matters: the
-- calendar renders a distinct "no students enrolled" state, and it must be able
-- to tell "0 enrolled" from "group not found". Hence the LEFT JOIN from
-- `groups` rather than grouping `registrations` alone.
-- ------------------------------------------------------------------

CREATE OR REPLACE VIEW public.group_enrollment_counts
WITH (security_invoker = true) AS
SELECT
  g.id AS group_id,
  count(r.student_id) FILTER (WHERE r.status = 'approved')::integer AS enrolled_count
FROM public.groups g
LEFT JOIN public.registrations r ON r.group_id = g.id
GROUP BY g.id;

COMMENT ON VIEW public.group_enrollment_counts IS
  'Approved-only enrolment count per group, matching the `enrolled` field useGroups derives client-side. Groups with none appear with 0, so callers can distinguish an empty group from a missing one. security_invoker: rows follow the caller''s registrations/groups policies.';

-- ------------------------------------------------------------------
-- 3. Index for the calendar's access pattern
--
-- Existing coverage, and why none of it is removed:
--   * UNIQUE (group_id, student_id, session_date) -- group-first lookups
--     (useAttendance: one group, one date). Still the right index for that, and
--     it also enforces the no-duplicate-marks invariant, so it could not be
--     dropped even if it were redundant for reads.
--   * idx_attendance_student_id -- student-first (useMyAttendance,
--     useStudentAttendance). Not served by either composite.
--   * idx_attendance_session_date -- date-only (useTodayAttendance).
--
-- The calendar's pattern is new: a DATE RANGE across MANY groups, grouped by
-- (group_id, session_date).
--
-- MEASURED, not assumed. With 120k synthetic rows (60 groups x 100 dates x 20
-- students) on this schema, a 7-day range query:
--
--   both indexes present   ->  Bitmap Index Scan on idx_attendance_session_date
--                              9.99 ms
--   composite dropped      ->  Bitmap Index Scan on idx_attendance_session_date
--                              12.58 ms
--   date-only dropped      ->  Bitmap Index Scan on idx_attendance_date_group
--                              4.20 ms
--
-- Two honest observations:
--
--   * The planner PREFERS the narrower date-only index when both exist. The
--     composite is not "the index the calendar uses" -- that would be wrong to
--     claim. Its presence still helps (9.99 vs 12.58 ms), because it gives the
--     planner a second, better-clustered path and improves its estimates.
--   * Forced to use it alone, the composite is the fastest of the three
--     (4.20 ms) -- it matches the GROUP BY key order, so fewer heap blocks are
--     touched (1306 vs 2608).
--
-- The composite therefore earns its place, but as a complement rather than a
-- replacement. Numbers are from a rolled-back transaction on a local stack;
-- absolute values will differ in production, the ordering is what matters.
--
-- Deliberately NOT dropping idx_attendance_session_date: the measurements above
-- show the planner actively choosing it, so it is demonstrably NOT redundant.
-- The instruction was to remove nothing unproven; the evidence points the other
-- way -- it should stay.
-- ------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_attendance_date_group
  ON public.attendance (session_date, group_id);

COMMENT ON INDEX public.idx_attendance_date_group IS
  'Serves the session calendar: attendance over a date range across many groups, grouped by (group_id, session_date). Complements idx_attendance_session_date (date-only) and the UNIQUE constraint (group-first).';

-- ------------------------------------------------------------------
-- 4. Grants
--
-- Mirrors the table convention established by
-- `20260802210200_revoke_unnecessary_grants.sql`: `authenticated` gets what it
-- needs, `anon` gets nothing on anything in public.
--
-- SELECT only -- these are read models; they are not updatable and nothing
-- should try. anon is granted nothing and is explicitly revoked: every policy
-- in this schema is scoped TO authenticated, so anon would receive zero rows
-- regardless, but stating it at the privilege layer means a future policy
-- change cannot quietly open a view.
-- ------------------------------------------------------------------

REVOKE ALL ON public.session_attendance_summary FROM PUBLIC, anon;
REVOKE ALL ON public.group_enrollment_counts    FROM PUBLIC, anon;

GRANT SELECT ON public.session_attendance_summary TO authenticated, service_role;
GRANT SELECT ON public.group_enrollment_counts    TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 5. Post-conditions
--
-- Fail loudly at migration time rather than subtly at query time. The
-- security_invoker assertion is the important one: without it the views leak
-- across teachers, and that is not visible from any application screen.
-- ------------------------------------------------------------------

DO $$
DECLARE _missing text;
BEGIN
  -- 5a. Both views exist.
  FOR _missing IN
    SELECT v FROM unnest(ARRAY[
      'session_attendance_summary', 'group_enrollment_counts'
    ]) v
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_views
       WHERE schemaname = 'public' AND viewname = v
    )
  LOOP
    RAISE EXCEPTION 'View public.% was not created', _missing;
  END LOOP;

  -- 5b. security_invoker is ON for both. A view without it runs as its owner
  --     and bypasses RLS on attendance/registrations.
  FOR _missing IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
       AND c.relname IN ('session_attendance_summary', 'group_enrollment_counts')
       AND COALESCE(
             (SELECT option_value
                FROM pg_options_to_table(c.reloptions)
               WHERE option_name = 'security_invoker'),
             'false'
           ) <> 'true'
  LOOP
    RAISE EXCEPTION
      'SECURITY: view public.% lacks security_invoker=true; it would bypass RLS',
      _missing;
  END LOOP;

  -- 5c. anon holds no privilege on either view.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('session_attendance_summary', 'group_enrollment_counts')
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'SECURITY: anon holds a privilege on a session view';
  END IF;

  -- 5d. The composite index exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_attendance_date_group'
  ) THEN
    RAISE EXCEPTION 'idx_attendance_date_group missing';
  END IF;

  -- 5e. Nothing pre-existing was removed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_attendance_session_date'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: idx_attendance_session_date disappeared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_attendance_student_id'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: idx_attendance_student_id disappeared';
  END IF;

  RAISE NOTICE 'Session aggregates ready: 2 views (security_invoker), 1 composite index. No existing object altered.';
END $$;
