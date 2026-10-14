-- ADR-002 -- structural role/identity integrity + generic entity lifecycle.
--
-- PROBLEM (verified on the live database)
--   4 of 5 `students` rows belonged to non-students: one admin and three
--   teachers. `teachers` was clean. The Students page, the admin dashboard's
--   student count, global search, group enrolment and the levels page all
--   inherited the contamination.
--
--   Not cosmetic: private.can_join_group -> my_academic_identity reads
--   `students`, so a teacher held a readable student identity. Only a NULL
--   level_id prevented enrolment.
--
-- ROOT CAUSES
--   1. handle_new_user() inserts a `students` row for EVERY auth user, before
--      any role decision exists.
--   2. grant_role() adds the new entity row but never removes the stale one --
--      correct for demotion (history must survive), wrong for promotion (the
--      student row is empty by construction). ADR-001 did not separate them.
--   3. Nothing tied the subset tables to the role table: `students.id`
--      referenced "a person", not "a person holding the student role".
--
-- DECISION (ADR-002)
--   Make the invalid state unrepresentable with a composite foreign key, rather
--   than detectable with a validation trigger. Multi-role verified on a
--   prototype: a single user held teacher+admin+student roles AND rows in both
--   entity tables. The FK asks "does this person hold THIS role?", never "how
--   many roles?".
--
-- No DROP TABLE / DROP COLUMN. The only rows deleted are the 4 contaminated
-- entity rows, each verified to carry no level, onboarding, registration,
-- attendance or note data.
--
-- ROLLBACK
--   ALTER TABLE public.students DROP CONSTRAINT students_id_role_fkey;
--   ALTER TABLE public.students DROP COLUMN role;
--   (likewise teachers); GRANT INSERT ON public.students TO authenticated;
--   Prior handle_new_user/grant_role bodies are in migrations
--   20260806140000 and 20260802191645.

-- ------------------------------------------------------------------
-- 1. Remove contamination BEFORE the constraint exists
--
-- Ordering is deliberate: the FK cannot be added while violating rows remain.
-- Restricted to rows that carry no data of any kind, so this can never destroy
-- academic history. Anything with dependencies would fail the guard below and
-- surface as an error rather than being silently dropped.
-- ------------------------------------------------------------------

DO $$
DECLARE _unsafe integer;
BEGIN
  SELECT count(*)::int INTO _unsafe
    FROM public.students s
    JOIN public.user_roles r ON r.user_id = s.id AND r.role <> 'student'
   WHERE s.level_id IS NOT NULL
      OR s.onboarded_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.registrations x WHERE x.student_id = s.id)
      OR EXISTS (SELECT 1 FROM public.attendance    x WHERE x.student_id = s.id)
      OR EXISTS (SELECT 1 FROM public.student_notes x WHERE x.student_id = s.id);

  IF _unsafe > 0 THEN
    RAISE EXCEPTION
      'Refusing to clean %: contaminated student row(s) carry real data. Resolve manually.', _unsafe;
  END IF;
END $$;

DELETE FROM public.students s
 USING public.user_roles r
 WHERE r.user_id = s.id
   AND r.role <> 'student';

DELETE FROM public.teachers t
 USING public.user_roles r
 WHERE r.user_id = t.id
   AND r.role <> 'teacher';

-- ------------------------------------------------------------------
-- 2. The structural invariant
--
-- `role` is GENERATED ALWAYS, not DEFAULT+CHECK. Both block the attack; the
-- generated form additionally states that the column is not data the caller may
-- supply (information_schema.is_generated = ALWAYS), so PostgREST and codegen
-- omit it from write payloads automatically.
--
-- Targets the existing UNIQUE (user_id, role) on user_roles -- no new index.
-- Multi-role safe: the pair is the key, so holding several roles is unaffected.
-- ------------------------------------------------------------------

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS role public.app_role
  GENERATED ALWAYS AS ('student'::public.app_role) STORED;

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS role public.app_role
  GENERATED ALWAYS AS ('teacher'::public.app_role) STORED;

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_id_role_fkey;
ALTER TABLE public.students
  ADD CONSTRAINT students_id_role_fkey
  FOREIGN KEY (id, role) REFERENCES public.user_roles(user_id, role)
  ON DELETE CASCADE;

ALTER TABLE public.teachers DROP CONSTRAINT IF EXISTS teachers_id_role_fkey;
ALTER TABLE public.teachers
  ADD CONSTRAINT teachers_id_role_fkey
  FOREIGN KEY (id, role) REFERENCES public.user_roles(user_id, role)
  ON DELETE CASCADE;

COMMENT ON COLUMN public.students.role IS
  'Structural discriminator (ADR-002). Not data: exists so (id, role) can reference user_roles, making a non-student row unrepresentable.';
COMMENT ON COLUMN public.teachers.role IS
  'Structural discriminator (ADR-002). See public.students.role.';

-- ------------------------------------------------------------------
-- 3. Close the bypass
--
-- Verified before this migration: an ordinary admin could
-- `POST /rest/v1/students {"id": "<teacher uuid>"}` and receive 201. The RLS
-- policy asked "are you an admin?", never "is this person a student?".
--
-- Identity rows are now created exclusively by provisioning (service_role).
-- The composite FK above still guards the service role, which bypasses RLS.
-- ------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.students  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.teachers  FROM authenticated;
GRANT  SELECT                  ON public.students TO authenticated;
GRANT  SELECT                  ON public.teachers TO authenticated;

-- Students still complete their own onboarding, and admins still edit records.
-- Both are UPDATEs of descriptive columns, never identity creation.
GRANT UPDATE (level_id, stream_id, status, gender, date_of_birth,
              guardian_name, guardian_phone, address, onboarded_at)
  ON public.students TO authenticated;
GRANT UPDATE (experience_years, bio, status)
  ON public.teachers TO authenticated;

-- ------------------------------------------------------------------
-- 4. Generic dependency evaluation
--
-- Replaces "delete when the row looks empty". Emptiness is measured on the row
-- while the consequences live in the children: attendance, registrations and
-- student_notes all CASCADE from `students`, so a naive delete silently
-- destroys academic history.
--
-- Severity, not a boolean:
--   blocking      historical or legally meaningful -- deletion always refused
--   reassignable  needs a new owner first (groups)
--   incidental    regenerable configuration
--
-- Future tables (grades, payments, homework, certificates) register here once
-- and every caller inherits the rule.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.entity_dependencies(_entity text, _id uuid)
RETURNS TABLE (
  source_table text,
  relationship text,
  row_count integer,
  severity text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  IF _entity = 'teacher' THEN
    RETURN QUERY
      SELECT 'groups', 'teaches',
             (SELECT count(*)::int FROM public.groups WHERE teacher_id = _id),
             'reassignable'
      UNION ALL
      SELECT 'attendance', 'marked_by',
             (SELECT count(*)::int FROM public.attendance WHERE marked_by = _id),
             'blocking'
      UNION ALL
      SELECT 'student_notes', 'authored',
             (SELECT count(*)::int FROM public.student_notes WHERE author_id = _id),
             'blocking'
      UNION ALL
      SELECT 'audit_log', 'subject_of',
             (SELECT count(*)::int FROM public.audit_log WHERE target_id = _id),
             'blocking'
      UNION ALL
      SELECT 'teacher_subjects', 'qualified_for',
             (SELECT count(*)::int FROM public.teacher_subjects WHERE teacher_id = _id),
             'incidental';

  ELSIF _entity = 'student' THEN
    RETURN QUERY
      SELECT 'registrations', 'enrolled',
             (SELECT count(*)::int FROM public.registrations WHERE student_id = _id),
             'blocking'
      UNION ALL
      SELECT 'attendance', 'attended',
             (SELECT count(*)::int FROM public.attendance WHERE student_id = _id),
             'blocking'
      UNION ALL
      SELECT 'student_notes', 'subject_of',
             (SELECT count(*)::int FROM public.student_notes WHERE student_id = _id),
             'blocking'
      UNION ALL
      SELECT 'audit_log', 'subject_of',
             (SELECT count(*)::int FROM public.audit_log WHERE target_id = _id),
             'blocking';

  ELSE
    RAISE EXCEPTION 'Unknown entity type: %', _entity USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.entity_dependencies(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.entity_dependencies(text, uuid) TO authenticated, service_role;

-- Admin-guarded public wrapper: `private` is not exposed to PostgREST, and the
-- UI must read these counts to explain why an action is blocked.
CREATE OR REPLACE FUNCTION public.entity_dependencies(_entity text, _id uuid)
RETURNS TABLE (source_table text, relationship text, row_count integer, severity text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can inspect dependencies' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.entity_dependencies(_entity, _id);
END;
$$;

REVOKE ALL ON FUNCTION public.entity_dependencies(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_dependencies(text, uuid) TO authenticated, service_role;

-- Convenience predicate: deletable means no blocking and no reassignable
-- dependencies. Never "the columns are null".
CREATE OR REPLACE FUNCTION private.entity_is_deletable(_entity text, _id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM private.entity_dependencies(_entity, _id)
     WHERE row_count > 0 AND severity IN ('blocking', 'reassignable')
  );
$$;

REVOKE ALL ON FUNCTION private.entity_is_deletable(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.entity_is_deletable(text, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 5. Provisioning: role decides the identity row
--
-- The trigger no longer assumes "every new auth user is a student". It reads
-- the role the SERVER placed in app_metadata -- writable only by the service
-- role, never by the browser (raw_user_meta_data is user-writable and must
-- never influence authorisation; see ADR-001 P0-B).
--
-- Absent or unrecognised -> student. Least privilege stays the default.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role public.app_role;
  _claimed text;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  );

  -- app_metadata is service-role-only. Public signup cannot set it, so a
  -- self-registering user always lands on the 'student' branch.
  _claimed := NEW.raw_app_meta_data->>'role';
  _role := CASE
    WHEN _claimed IN ('admin', 'teacher', 'student') THEN _claimed::public.app_role
    ELSE 'student'::public.app_role
  END;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);

  -- One identity row, matching the role. Admins get neither: they are staff
  -- without teaching or academic records.
  IF _role = 'student' THEN
    INSERT INTO public.students (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  ELSIF _role = 'teacher' THEN
    INSERT INTO public.teachers (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------
-- 6. grant_role: dependency-driven, correctly ordered
--
-- The composite FK forbids deleting a user_roles row while its entity row
-- lives, so the previous DELETE-then-INSERT order now fails. Correct order:
--   evaluate dependencies -> drop stale entity row -> change role -> insert new
--
-- The stale row is dropped ONLY when private.entity_is_deletable says so. A
-- demoted teacher who has taught keeps their teachers row and their history,
-- exactly as ADR-001 intended -- but a promoted student's empty row no longer
-- lingers as contamination.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.grant_role(
  _target uuid,
  _role public.app_role
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
  _previous public.app_role;
BEGIN
  IF _actor IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can assign roles' USING ERRCODE = '42501';
  END IF;

  IF _target IS NULL THEN
    RAISE EXCEPTION 'grant_role: target user is required' USING ERRCODE = '22004';
  END IF;

  SELECT email INTO _target_email FROM public.profiles WHERE id = _target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_role: no profile for %', _target USING ERRCODE = '23503';
  END IF;

  SELECT role INTO _previous FROM public.user_roles WHERE user_id = _target LIMIT 1;

  IF _previous IS NOT DISTINCT FROM _role THEN
    RETURN; -- idempotent, no audit noise
  END IF;

  -- Retire the previous identity row first: the FK blocks the role change while
  -- it exists. Only when it carries nothing worth keeping.
  IF _previous = 'student' AND private.entity_is_deletable('student', _target) THEN
    DELETE FROM public.students WHERE id = _target;
  ELSIF _previous = 'teacher' AND private.entity_is_deletable('teacher', _target) THEN
    DELETE FROM public.teachers WHERE id = _target;
  END IF;

  -- If history made the row undeletable, the role change cannot proceed: the
  -- person still owns records under the old role. Say so plainly.
  IF EXISTS (SELECT 1 FROM public.students WHERE id = _target) AND _previous = 'student' THEN
    RAISE EXCEPTION 'Cannot change role: this account still owns student records'
      USING ERRCODE = '23503',
            HINT = 'Archive the student identity instead of changing the role.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teachers WHERE id = _target) AND _previous = 'teacher' THEN
    RAISE EXCEPTION 'Cannot change role: this account still owns teaching records'
      USING ERRCODE = '23503',
            HINT = 'Archive the teacher instead of changing the role.';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _target;
  INSERT INTO public.user_roles (user_id, role) VALUES (_target, _role);

  IF _role = 'teacher' THEN
    INSERT INTO public.teachers (id) VALUES (_target) ON CONFLICT (id) DO NOTHING;
  ELSIF _role = 'student' THEN
    INSERT INTO public.students (id) VALUES (_target) ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT email INTO _actor_email FROM public.profiles WHERE id = _actor;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (
    'role_granted', _actor, _actor_email, _target, _target_email,
    jsonb_build_object(
      'previous_role', COALESCE(_previous::text, 'none'),
      'new_role', _role::text
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.grant_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.grant_role(uuid, public.app_role) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 7. Generic lifecycle engine
--
-- private.set_teacher_lifecycle becomes a thin wrapper over this, so students
-- (and later parents/staff) reuse the same audited state machine rather than
-- growing a parallel copy.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.entity_lifecycle(
  _entity text,
  _id uuid,
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
  _pending integer;
  _action public.audit_action;
BEGIN
  IF _actor IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change lifecycle state' USING ERRCODE = '42501';
  END IF;

  IF _next NOT IN ('active', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'Unsupported lifecycle state: %', _next USING ERRCODE = '22023';
  END IF;

  IF _entity = 'teacher' THEN
    SELECT status INTO _current FROM public.teachers WHERE id = _id;
  ELSIF _entity = 'student' THEN
    SELECT status INTO _current FROM public.students WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'Unknown entity type: %', _entity USING ERRCODE = '22023';
  END IF;

  IF _current IS NULL THEN
    RAISE EXCEPTION 'No % with id %', _entity, _id USING ERRCODE = '23503';
  END IF;

  IF _current = _next THEN
    RETURN;
  END IF;

  -- Archiving requires every reassignable dependency to be handed over first.
  -- Never unassign automatically: a silent sweep leaves classes teacherless.
  IF _next = 'archived' THEN
    SELECT COALESCE(sum(row_count), 0)::int INTO _pending
      FROM private.entity_dependencies(_entity, _id)
     WHERE severity = 'reassignable' AND row_count > 0;

    IF _pending > 0 THEN
      RAISE EXCEPTION 'Cannot archive: % item(s) still assigned', _pending
        USING ERRCODE = '23503',
              HINT = 'Reassign them to someone else first.';
    END IF;
  END IF;

  IF _entity = 'teacher' THEN
    UPDATE public.teachers
       SET status = _next, status_changed_at = now(), status_reason = _reason
     WHERE id = _id;
  ELSE
    UPDATE public.students SET status = _next WHERE id = _id;
  END IF;

  _action := CASE
    WHEN _next = 'suspended'   THEN 'teacher_suspended'::public.audit_action
    WHEN _next = 'archived'    THEN 'teacher_archived'::public.audit_action
    WHEN _current = 'archived' THEN 'teacher_restored'::public.audit_action
    ELSE 'teacher_reactivated'::public.audit_action
  END;

  SELECT email INTO _actor_email  FROM public.profiles WHERE id = _actor;
  SELECT email INTO _target_email FROM public.profiles WHERE id = _id;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (
    _action, _actor, _actor_email, _id, _target_email,
    jsonb_build_object(
      'entity', _entity,
      'previous_state', _current::text,
      'new_state', _next::text,
      'reason', COALESCE(_reason, '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.entity_lifecycle(text, uuid, public.entity_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.entity_lifecycle(text, uuid, public.entity_status, text) TO authenticated, service_role;

-- Teacher lifecycle now delegates. No duplicated rules.
CREATE OR REPLACE FUNCTION private.set_teacher_lifecycle(
  _teacher uuid,
  _next public.entity_status,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT private.entity_lifecycle('teacher', _teacher, _next, _reason);
$$;

REVOKE ALL ON FUNCTION private.set_teacher_lifecycle(uuid, public.entity_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.set_teacher_lifecycle(uuid, public.entity_status, text) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 8. Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE _bad integer; _priv integer;
BEGIN
  SELECT count(*)::int INTO _bad
    FROM public.students s JOIN public.user_roles r ON r.user_id = s.id
   WHERE r.role <> 'student';
  IF _bad > 0 THEN RAISE EXCEPTION 'students still contaminated: %', _bad; END IF;

  SELECT count(*)::int INTO _bad
    FROM public.teachers t JOIN public.user_roles r ON r.user_id = t.id
   WHERE r.role <> 'teacher';
  IF _bad > 0 THEN RAISE EXCEPTION 'teachers still contaminated: %', _bad; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_id_role_fkey') THEN
    RAISE EXCEPTION 'students_id_role_fkey missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_id_role_fkey') THEN
    RAISE EXCEPTION 'teachers_id_role_fkey missing';
  END IF;

  SELECT count(*)::int INTO _priv
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name IN ('students', 'teachers')
     AND grantee = 'authenticated' AND privilege_type = 'INSERT';
  IF _priv > 0 THEN RAISE EXCEPTION 'authenticated can still INSERT identity rows'; END IF;

  IF to_regprocedure('private.entity_dependencies(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'entity_dependencies missing';
  END IF;
  IF to_regprocedure('private.entity_lifecycle(text, uuid, public.entity_status, text)') IS NULL THEN
    RAISE EXCEPTION 'entity_lifecycle missing';
  END IF;

  RAISE NOTICE 'ADR-002 applied: role/identity integrity is structural.';
END $$;
