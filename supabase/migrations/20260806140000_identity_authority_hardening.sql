-- Security Release 001 -- identity authority hardening (ADR-001 steps 1-5).
--
-- Closes a verified privilege-escalation hole and makes role assignment an
-- admin-only, audited, server-side operation.
--
-- WHAT WAS WRONG
--
-- 1. P0-A (verified by exploit): `teachers admin insert` allowed
--       WITH CHECK (private.is_admin() OR id = auth.uid())
--    so any authenticated user could POST /rest/v1/teachers with their own uid
--    and receive HTTP 201. `students insert` had the same clause. No capability
--    was granted today -- every follow-on attack returned 403 -- but it left a
--    user who is `student` in user_roles and `teacher` in teachers. The moment
--    any code authorises on "has a teachers row", that becomes real escalation.
--
-- 2. P1: handle_new_user() hardcoded every signup as 'student' and always
--    inserted a students row. Admin-provisioned teachers therefore landed as
--    students with no teachers row, so the application's
--    `.from("teachers").update(...)` matched zero rows and silently succeeded.
--
-- 3. P0-B: the browser transmitted `role` in signUp metadata. The hardcoded
--    trigger discarded it, which is the only reason this was not exploitable.
--    Naively "fixing" the trigger to honour user_metadata would have opened
--    self-registration as admin. The client-side removal ships with this
--    migration for exactly that reason.
--
-- DESIGN: one writer per fact.
--   trigger  -> the INVARIANT: every auth user gets a profile + least-privilege
--               identity. No branching, never reads user_metadata.
--   service  -> the DECISION: which role, which entity row. Runs as an admin,
--               through private.grant_role(), and is audited.
--
-- A trigger cannot distinguish self-registration from admin provisioning; it
-- sees only a row. Encoding that decision in the trigger requires trusting
-- user_metadata, which is user-writable. Hence the split.
--
-- ROLLBACK (see docs/SECURITY_RELEASE_001_analysis.md §4). Prior definitions:
--
--   CREATE POLICY "teachers admin insert" ON public.teachers
--     FOR INSERT TO authenticated
--     WITH CHECK (private.is_admin() OR (id = auth.uid()));
--
--   CREATE POLICY "students insert" ON public.students
--     FOR INSERT TO authenticated
--     WITH CHECK ((id = auth.uid()) OR private.is_admin());
--
--   CREATE POLICY "teachers read" ON public.teachers
--     FOR SELECT TO authenticated USING (true);
--
--   handle_new_user() body:
--     INSERT INTO public.profiles (id, full_name, email, phone)
--     VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''),
--             NEW.email, NEW.raw_user_meta_data->>'phone');
--     INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
--     INSERT INTO public.students (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
--     RETURN NEW;
--
-- No DROP TABLE / DROP COLUMN / DELETE / UPDATE of existing rows: this migration
-- cannot lose data. The only irreversible element is the audit_action enum
-- additions (Postgres cannot remove enum values); they are additive and inert.

-- ------------------------------------------------------------------
-- 1. Audit vocabulary for role changes
-- ------------------------------------------------------------------

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'role_granted';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'role_revoked';

-- NOTE: no COMMIT here, deliberately.
--
-- Postgres forbids *using* a new enum value in the same transaction that adds
-- it, which tempts one to insert `COMMIT; BEGIN;` at this point. Do not: when
-- the whole file is submitted as one statement (Studio, pgMeta, psql -c), an
-- explicit COMMIT closes the surrounding transaction and every statement after
-- it is silently discarded -- while the endpoint still returns success.
--
-- It is unnecessary anyway: the new values are only referenced inside function
-- *bodies*, which are parsed at definition time and evaluated later, at call
-- time. Nothing below uses them during this transaction.

-- ------------------------------------------------------------------
-- 2. STEP 4 -- remove self-insert from identity tables
--
-- Identity rows are assigned, never self-claimed. After this, only an admin
-- (or the service role, which bypasses RLS) can create them.
--
-- Safe for student onboarding: it writes with UPDATE, not INSERT -- the row
-- already exists from the trigger. Verified before writing this migration.
-- ------------------------------------------------------------------

DROP POLICY IF EXISTS "teachers admin insert" ON public.teachers;
CREATE POLICY "teachers admin insert" ON public.teachers
FOR INSERT TO authenticated
WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS "students insert" ON public.students;
CREATE POLICY "students insert" ON public.students
FOR INSERT TO authenticated
WITH CHECK (private.is_admin());

-- `profiles admin insert` deliberately keeps `id = auth.uid()`: a profile is
-- descriptive, not authoritative, and self-service profile creation is the
-- documented Supabase pattern. It grants no privilege.

-- ------------------------------------------------------------------
-- 3. STEP 5 -- scope teacher visibility
--
-- Was USING (true): every authenticated user could read every teacher row.
--
-- Three legitimate readers, mirroring the existing `students read` shape:
--   - staff (admin or teacher)
--   - the teacher themselves
--   - a student enrolled in one of that teacher's groups
--
-- The third clause is required, not generosity: students read teacher names for
-- their own registrations (src/features/school/my-registrations.ts). A
-- staff-only policy would silently blank those names.
-- ------------------------------------------------------------------

DROP POLICY IF EXISTS "teachers read" ON public.teachers;
CREATE POLICY "teachers read" ON public.teachers
FOR SELECT TO authenticated
USING (
  private.is_staff()
  OR id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.registrations r
    JOIN public.groups g ON g.id = r.group_id
    WHERE r.student_id = auth.uid()
      AND r.status = 'approved'
      AND g.teacher_id = teachers.id
  )
);

-- ------------------------------------------------------------------
-- 4. STEP 3 -- the audited elevation path
--
-- The ONLY supported way to change a role. Atomic: role row, entity row and
-- audit entry all commit together or not at all.
--
-- SECURITY DEFINER so it can write user_roles regardless of the caller's RLS,
-- but it asserts private.is_admin() first -- the definer rights are what make
-- the operation possible, not what make it permitted.
--
-- search_path is pinned: a SECURITY DEFINER function without it can be hijacked
-- by a caller-controlled search_path.
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
  -- Authorisation first. The service role has no auth.uid(); it bypasses RLS by
  -- design and is trusted to have performed its own check server-side.
  IF _actor IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can assign roles'
      USING ERRCODE = '42501';
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
    RETURN; -- already correct; stay idempotent and write no audit noise
  END IF;

  -- Exactly one role per user in this product. Multi-role is a deliberate
  -- future change (ADR-001 P3) and must not be introduced by accident here.
  DELETE FROM public.user_roles WHERE user_id = _target;
  INSERT INTO public.user_roles (user_id, role) VALUES (_target, _role);

  -- Move the entity row to match. Keep the old row rather than deleting it:
  -- a demoted teacher's history (groups taught) must survive, and students
  -- carry academic data that is expensive to reconstruct.
  IF _role = 'teacher' THEN
    INSERT INTO public.teachers (id) VALUES (_target) ON CONFLICT (id) DO NOTHING;
  ELSIF _role = 'student' THEN
    INSERT INTO public.students (id) VALUES (_target) ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT email INTO _actor_email FROM public.profiles WHERE id = _actor;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (
    'role_granted',
    _actor,
    _actor_email,
    _target,
    _target_email,
    jsonb_build_object(
      'previous_role', COALESCE(_previous::text, 'none'),
      'new_role', _role::text
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.grant_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.grant_role(uuid, public.app_role) TO authenticated, service_role;

COMMENT ON FUNCTION private.grant_role(uuid, public.app_role) IS
  'Sole supported path for changing a user role. Admin-only, atomic, audited. Never call from client code.';

-- ------------------------------------------------------------------
-- 5. STEP 3 -- staff provisioning helper
--
-- Called by the server immediately after auth.admin.createUser(). Sets the role,
-- creates the teachers row, and flags the temporary password for replacement --
-- in one transaction, so a half-provisioned staff account cannot exist.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.provision_staff(
  _target uuid,
  _role public.app_role,
  _experience_years integer DEFAULT 0,
  _bio text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  IF _role NOT IN ('teacher', 'admin') THEN
    RAISE EXCEPTION 'provision_staff: % is not a staff role', _role
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.grant_role(_target, _role);

  IF _role = 'teacher' THEN
    UPDATE public.teachers
       SET experience_years = COALESCE(_experience_years, 0),
           bio = _bio,
           status = 'active'
     WHERE id = _target;
  END IF;

  UPDATE public.profiles
     SET password_change_required = true,
         phone = COALESCE(_phone, phone)
   WHERE id = _target;
END;
$$;

REVOKE ALL ON FUNCTION private.provision_staff(uuid, public.app_role, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.provision_staff(uuid, public.app_role, integer, text, text) TO service_role;

COMMENT ON FUNCTION private.provision_staff(uuid, public.app_role, integer, text, text) IS
  'Server-only staff provisioning. service_role only -- authenticated deliberately has no EXECUTE.';

-- PostgREST only exposes schemas in its `db-schemas` list, and `private` is
-- deliberately not one of them (verified: Accept-Profile: private -> HTTP 406).
-- The server therefore cannot call private.provision_staff over RPC directly.
--
-- Rather than exposing the whole `private` schema -- which would put is_admin(),
-- has_role() and the academic-identity helper on the public API surface -- this
-- thin wrapper lives in `public` and is granted to service_role ONLY.
-- `authenticated` and `anon` get no EXECUTE, so it is unreachable with a user
-- JWT even though it sits in an exposed schema.
CREATE OR REPLACE FUNCTION public.provision_staff(
  _target uuid,
  _role public.app_role,
  _experience_years integer DEFAULT 0,
  _bio text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT private.provision_staff(_target, _role, _experience_years, _bio, _phone);
$$;

REVOKE ALL ON FUNCTION public.provision_staff(uuid, public.app_role, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_staff(uuid, public.app_role, integer, text, text) TO service_role;

COMMENT ON FUNCTION public.provision_staff(uuid, public.app_role, integer, text, text) IS
  'RPC entry point for server-side staff provisioning. service_role only; not callable with a user JWT.';

-- ------------------------------------------------------------------
-- 6. STEP 3 -- trigger narrowed to the invariant
--
-- Identical in effect to the previous version, but now DELIBERATE rather than
-- accidental: least privilege is the documented default, and elevation is a
-- separate audited action.
--
-- It must never read raw_user_meta_data->>'role'. That field is written by the
-- browser at signup; honouring it is remote privilege escalation. The
-- post-condition in section 7 enforces this mechanically.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  );

  -- Least privilege, unconditionally. Staff are elevated afterwards by
  -- private.grant_role() under an admin check. Do not branch on metadata here.
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
  INSERT INTO public.students (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------
-- 7. Post-conditions -- fail loudly rather than half-apply
--
-- The first two are regression guards for the exact defects this release fixes.
-- ------------------------------------------------------------------

DO $$
DECLARE
  _bad text;
  _src text;
BEGIN
  -- No staff INSERT policy may permit self-claiming an identity row.
  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO _bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('teachers', 'students')
     AND cmd = 'INSERT'
     AND with_check LIKE '%auth.uid()%';

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'P0-A not closed: self-insert still permitted by %', _bad;
  END IF;

  -- The trigger must not consult metadata for a role.
  SELECT prosrc INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

  -- Match the dangerous construct precisely: a `role` key read out of user
  -- metadata. A looser '%raw_user_meta_data%role%' pattern false-positives on
  -- this very function, whose body legitimately contains both
  -- `raw_user_meta_data->>'phone'` and the table name `user_roles`.
  IF _src ~ 'raw_user_meta_data\s*->>\s*''role''' THEN
    RAISE EXCEPTION 'P0-B risk: handle_new_user reads a role from user metadata';
  END IF;

  IF to_regprocedure('private.grant_role(uuid, public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'private.grant_role is missing';
  END IF;

  IF to_regprocedure('private.provision_staff(uuid, public.app_role, integer, text, text)') IS NULL THEN
    RAISE EXCEPTION 'private.provision_staff is missing';
  END IF;

  -- teachers read must no longer be unconditional.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'teachers'
       AND policyname = 'teachers read' AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'P2 not closed: teachers read is still USING (true)';
  END IF;

  RAISE NOTICE 'Security Release 001 applied: identity authority hardened.';
END $$;
