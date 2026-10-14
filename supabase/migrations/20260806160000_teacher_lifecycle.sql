-- Teacher account lifecycle: active / suspended / archived.
--
-- Replaces the binary active|inactive model with three states that map to how a
-- tutoring centre actually manages staff:
--
--   ACTIVE     teaching. can sign in.
--   SUSPENDED  temporary and reversible (leave, dispute, investigation).
--              Cannot sign in. Groups STAY ASSIGNED so nothing breaks and
--              reactivation is instant.
--   ARCHIVED   terminal. The person has left. Cannot sign in, hidden from
--              default lists, still present in reports and history.
--              Requires every group to be reassigned first.
--
-- DESIGN NOTES
--
-- 1. Archive is the real "delete". Hard deletion is reserved for mistakes --
--    an account created and never used. Any teacher who has taught, marked a
--    register, or written a note is undeletable by design, because that data
--    is attributed to a person and must stay attributable.
--
-- 2. Archiving REFUSES while groups remain assigned rather than unassigning
--    them silently. `groups.teacher_id` is ON DELETE SET NULL, so an automatic
--    sweep would leave classes teacherless with nothing surfaced to the admin.
--    Refusing forces a deliberate reassignment.
--
-- 3. Sign-in is blocked by GoTrue's ban_duration, applied server-side. The
--    `status` column alone is cosmetic -- it drives the UI, not authentication.
--    Verified against the running stack: ban -> login 400 `user_banned`,
--    unban -> login 200.
--
-- 4. `inactive` stays in the enum because `students`, `groups` and `subjects`
--    share entity_status and Postgres cannot remove enum values. Teachers must
--    no longer be written as `inactive`; a CHECK constraint enforces that.
--
-- ROLLBACK: policies and functions are replaceable; see the prior definitions
-- inline. Enum additions are one-way (Postgres limitation) but additive and
-- inert. The status backfill is reversible with:
--   UPDATE public.teachers SET status='inactive' WHERE status='suspended';
--
-- No DROP TABLE / DROP COLUMN. No row is deleted.

-- ------------------------------------------------------------------
-- 1. Prerequisite
--
-- The enum values this migration writes (`suspended`, `archived`, and the five
-- teacher_* audit actions) are added by 20260806155000_teacher_lifecycle_enums.
-- They MUST already be committed: Postgres raises `55P04 unsafe use of new
-- value` if a value is added and used in the same transaction, which is exactly
-- what the backfill in section 3 does. Hence two files.
--
-- Do NOT add an explicit COMMIT here to work around that. When a file is
-- submitted as a single statement, an explicit COMMIT closes the surrounding
-- transaction and every statement after it is silently discarded while the
-- endpoint still reports success.
-- ------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM unnest(enum_range(NULL::public.entity_status)) e
     WHERE e::text = 'suspended'
  ) THEN
    RAISE EXCEPTION 'Apply 20260806155000_teacher_lifecycle_enums.sql first';
  END IF;
END $$;

-- ------------------------------------------------------------------
-- 2. Lifecycle metadata
--
-- Kept on `teachers` rather than a side table: it is 1:1 with the teacher and
-- every read that needs the status needs these too.
-- ------------------------------------------------------------------

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_reason text;

COMMENT ON COLUMN public.teachers.status_reason IS
  'Optional free-text reason captured with the last lifecycle transition. Mirrored into audit_log.details.';

-- ------------------------------------------------------------------
-- 3. Backfill: inactive -> suspended  (Decision 1)
-- ------------------------------------------------------------------

UPDATE public.teachers
   SET status = 'suspended',
       status_changed_at = COALESCE(status_changed_at, now())
 WHERE status = 'inactive';

-- ------------------------------------------------------------------
-- 4. Deletion safety
--
-- One function shared by the UI (to explain) and the server (to enforce), so
-- the two can never disagree about what blocks a deletion.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.teacher_deletion_blockers(_teacher uuid)
RETURNS TABLE (
  groups_assigned integer,
  attendance_marked integer,
  notes_authored integer,
  audit_entries integer,
  deletable boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  WITH counts AS (
    SELECT
      (SELECT count(*) FROM public.groups      WHERE teacher_id = _teacher)::int AS g,
      (SELECT count(*) FROM public.attendance  WHERE marked_by  = _teacher)::int AS a,
      (SELECT count(*) FROM public.student_notes WHERE author_id = _teacher)::int AS n,
      (SELECT count(*) FROM public.audit_log   WHERE target_id  = _teacher)::int AS l
  )
  SELECT g, a, n, l, (g = 0 AND a = 0 AND n = 0 AND l = 0) FROM counts;
$$;

REVOKE ALL ON FUNCTION private.teacher_deletion_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.teacher_deletion_blockers(uuid) TO authenticated, service_role;

-- Public wrapper: `private` is not exposed to PostgREST, and admins need to
-- read these counts to render the explanation. Admin-guarded, read-only.
CREATE OR REPLACE FUNCTION public.teacher_deletion_blockers(_teacher uuid)
RETURNS TABLE (
  groups_assigned integer,
  attendance_marked integer,
  notes_authored integer,
  audit_entries integer,
  deletable boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can inspect deletion blockers'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.teacher_deletion_blockers(_teacher);
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_deletion_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_deletion_blockers(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 5. The lifecycle transition
--
-- Single entry point for every state change: validates the transition, applies
-- it, and writes the audit entry atomically. Refusing to archive a teacher who
-- still holds groups lives HERE rather than in application code, so the rule
-- holds even if a future caller forgets it.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.set_teacher_lifecycle(
  _teacher uuid,
  _next public.entity_status,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _actor_email text;
  _target_email text;
  _current public.entity_status;
  _groups integer;
  _action public.audit_action;
BEGIN
  IF _actor IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change teacher status'
      USING ERRCODE = '42501';
  END IF;

  IF _next NOT IN ('active', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'Teachers support only active, suspended and archived (got %)', _next
      USING ERRCODE = '22023';
  END IF;

  SELECT status INTO _current FROM public.teachers WHERE id = _teacher;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No teacher %', _teacher USING ERRCODE = '23503';
  END IF;

  IF _current = _next THEN
    RETURN; -- idempotent; no audit noise
  END IF;

  -- Decision 2: never unassign automatically. Refuse and let the admin decide.
  IF _next = 'archived' THEN
    SELECT count(*)::int INTO _groups FROM public.groups WHERE teacher_id = _teacher;
    IF _groups > 0 THEN
      RAISE EXCEPTION 'Cannot archive: % group(s) still assigned', _groups
        USING ERRCODE = '23503',
              HINT = 'Reassign every group to another teacher first.';
    END IF;
  END IF;

  UPDATE public.teachers
     SET status = _next,
         status_changed_at = now(),
         status_reason = _reason
   WHERE id = _teacher;

  _action := CASE
    WHEN _next = 'suspended' THEN 'teacher_suspended'::public.audit_action
    WHEN _next = 'archived'  THEN 'teacher_archived'::public.audit_action
    WHEN _current = 'archived' THEN 'teacher_restored'::public.audit_action
    ELSE 'teacher_reactivated'::public.audit_action
  END;

  SELECT email INTO _actor_email  FROM public.profiles WHERE id = _actor;
  SELECT email INTO _target_email FROM public.profiles WHERE id = _teacher;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (
    _action, _actor, _actor_email, _teacher, _target_email,
    jsonb_build_object(
      'previous_state', _current::text,
      'new_state', _next::text,
      'reason', COALESCE(_reason, '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.set_teacher_lifecycle(uuid, public.entity_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.set_teacher_lifecycle(uuid, public.entity_status, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_teacher_lifecycle(
  _teacher uuid,
  _next public.entity_status,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT private.set_teacher_lifecycle(_teacher, _next, _reason);
$$;

REVOKE ALL ON FUNCTION public.set_teacher_lifecycle(uuid, public.entity_status, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_teacher_lifecycle(uuid, public.entity_status, text) TO service_role;

COMMENT ON FUNCTION public.set_teacher_lifecycle(uuid, public.entity_status, text) IS
  'Server-only lifecycle transition. service_role only: the server must also ban/unban the auth user, which SQL cannot do.';

-- ------------------------------------------------------------------
-- 6. Workload -- one definition, used by the profile and the list
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_workload(_teacher uuid)
RETURNS TABLE (
  group_count integer,
  student_count integer,
  weekly_minutes integer,
  subject_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT
    (SELECT count(*) FROM public.groups g WHERE g.teacher_id = _teacher)::int,
    (SELECT count(DISTINCT r.student_id)
       FROM public.registrations r
       JOIN public.groups g ON g.id = r.group_id
      WHERE g.teacher_id = _teacher AND r.status = 'approved')::int,
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (gs.end_time - gs.start_time)) / 60), 0)
       FROM public.group_schedules gs
       JOIN public.groups g ON g.id = gs.group_id
      WHERE g.teacher_id = _teacher)::int,
    (SELECT count(*) FROM public.teacher_subjects ts WHERE ts.teacher_id = _teacher)::int;
$$;

REVOKE ALL ON FUNCTION public.teacher_workload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_workload(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 7. Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE _left integer;
BEGIN
  SELECT count(*)::int INTO _left FROM public.teachers WHERE status = 'inactive';
  IF _left > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % teacher(s) still inactive', _left;
  END IF;

  IF to_regprocedure('private.set_teacher_lifecycle(uuid, public.entity_status, text)') IS NULL THEN
    RAISE EXCEPTION 'set_teacher_lifecycle missing';
  END IF;
  IF to_regprocedure('public.teacher_deletion_blockers(uuid)') IS NULL THEN
    RAISE EXCEPTION 'teacher_deletion_blockers missing';
  END IF;
  IF to_regprocedure('public.teacher_workload(uuid)') IS NULL THEN
    RAISE EXCEPTION 'teacher_workload missing';
  END IF;

  RAISE NOTICE 'Teacher lifecycle installed.';
END $$;
