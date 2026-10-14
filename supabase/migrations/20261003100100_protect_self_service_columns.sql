-- ==================================================================
-- SEC-02: columns a user may NOT change about themselves.
--
-- THE HOLE
--
-- `students self update`, `teachers self update` and `profiles self update` all allow
-- `id = auth.uid()`, and the column-level UPDATE grants include fields that are authorisation
-- inputs or audit evidence, not personal preferences:
--
--   students.status                  a student could reactivate themselves once status means
--                                    something (student lifecycle, next phases)
--   students.level_id / stream_id    eligibility (`private.can_join_group`, `groups read`):
--   students.onboarded_at            a student could switch level at any time to see and request
--                                    other groups, or re-open onboarding
--   teachers.status                  bypasses the lifecycle RPC and its audit (not the ban)
--   profiles.email                   copied into audit_log by the payment and HR audit triggers
--                                    and read by the teacher-provisioning "email taken" check, so
--                                    a user could falsify audit records or block an address
--
-- WHY A TRIGGER, NOT GRANTS
--
-- Column grants cannot tell an administrator from the row's owner: both are `authenticated`.
-- Revoking the grants would break the existing admin screens (`useUpdateStudent` and
-- `useUpdateTeacher` write `status` and `level_id` directly). One guard per table, with an
-- explicit administrator bypass, keeps every admin path working and states the rule in one place.
--
-- WHO IT APPLIES TO
--
-- Only requests made as `authenticated` by a non-administrator. Server functions (service_role),
-- SECURITY DEFINER functions (`set_teacher_lifecycle`, `provision_staff`, `handle_new_user`) and
-- maintenance run as other roles and are unaffected. The function is SECURITY INVOKER so that
-- `current_user` is the caller's role.
--
-- ONBOARDING STILL WORKS: the wizard (`useCompleteOnboarding`) writes level, stream and
-- `onboarded_at` in one update while `onboarded_at` is still NULL. Only after that stamp are the
-- three frozen for the student; the administration changes them from then on (decision D1).
--
-- STILL SELF-EDITABLE: full_name, phone, avatar_url, password_change_required (cleared by the
-- password-change and reset flows), gender, date_of_birth, guardian_*, address, teachers.bio,
-- teachers.experience_years.
--
-- Refusals are 42501 with a sentence `lib/errors.ts` can show.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS t_students_guard_self_service ON public.students;
--   DROP TRIGGER IF EXISTS t_teachers_guard_self_service ON public.teachers;
--   DROP TRIGGER IF EXISTS t_profiles_guard_self_service ON public.profiles;
--   DROP FUNCTION IF EXISTS public.guard_self_service_columns();
-- ==================================================================

CREATE OR REPLACE FUNCTION public.guard_self_service_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'private'
AS $$
BEGIN
  -- Only a signed-in, non-administrator request is restricted.
  IF current_user <> 'authenticated' OR private.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'students' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only the administration can change a student''s status.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.onboarded_at IS NOT NULL AND (
         NEW.level_id     IS DISTINCT FROM OLD.level_id
      OR NEW.stream_id    IS DISTINCT FROM OLD.stream_id
      OR NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at
    ) THEN
      RAISE EXCEPTION 'Your level and stream are set by the administration after registration.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

  ELSIF TG_TABLE_NAME = 'teachers' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only the administration can change a teacher''s status.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'The account email cannot be changed here.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Nobody calls it directly; trigger firing does not check EXECUTE (same as validate_group_program).
REVOKE ALL ON FUNCTION public.guard_self_service_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_students_guard_self_service ON public.students;
CREATE TRIGGER t_students_guard_self_service
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.guard_self_service_columns();

DROP TRIGGER IF EXISTS t_teachers_guard_self_service ON public.teachers;
CREATE TRIGGER t_teachers_guard_self_service
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.guard_self_service_columns();

DROP TRIGGER IF EXISTS t_profiles_guard_self_service ON public.profiles;
CREATE TRIGGER t_profiles_guard_self_service
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_self_service_columns();

-- Post-condition: all three guards exist and the function is not a definer (it must see the
-- caller's role).
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('t_students_guard_self_service', 't_teachers_guard_self_service',
                    't_profiles_guard_self_service');
  IF n <> 3 THEN
    RAISE EXCEPTION 'expected 3 self-service guard triggers, found %', n;
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_self_service_columns()'::regprocedure) THEN
    RAISE EXCEPTION 'guard_self_service_columns must be SECURITY INVOKER';
  END IF;
END $$;
