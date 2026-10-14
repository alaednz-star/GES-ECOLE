-- Corrects the ADR-002 provisioning path.
--
-- WHAT WAS WRONG
--
-- 20260806180000 made handle_new_user() read the role from
-- NEW.raw_app_meta_data->>'role'. That looked right -- app_metadata is
-- service-role-only, so it cannot be forged by the browser -- but it does not
-- work, and the regression suite caught it:
--
--   trigger assigned teacher role from app_metadata  -> got 'student'
--   teachers row created by trigger                  -> got 0
--   NO students row created                          -> got 1
--
-- PROVEN CAUSE (measured, not inferred)
--
-- A probe trigger captured NEW.raw_app_meta_data at INSERT time:
--
--   {"provider": "email", "providers": ["email"]}
--
-- while the finished row holds:
--
--   {"role": "teacher", "provider": "email", "providers": ["email"]}
--
-- GoTrue's admin createUser INSERTs the user first and applies app_metadata in
-- a SUBSEQUENT UPDATE. An AFTER INSERT trigger therefore cannot see it. The
-- role simply is not knowable at that moment.
--
-- THE CORRECTION
--
-- Stop trying to know. The trigger returns to a pure invariant -- profile plus
-- least-privilege student identity -- and provisioning reconciles the identity
-- afterwards, which is where the role is actually decided. This is a better
-- separation than the version it replaces: the trigger now consults NO metadata
-- of any kind, so there is no field left for a future caller to forge.
--
-- ADR-002's structural guarantee is untouched: the composite FK still makes a
-- mismatched identity row unrepresentable, whichever path creates it.

-- ------------------------------------------------------------------
-- 1. Trigger: invariant only, zero metadata trust
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

  -- Least privilege, unconditionally. The role is NOT knowable here: GoTrue
  -- writes app_metadata in a later UPDATE (verified), and raw_user_meta_data is
  -- browser-writable so it must never influence authorisation (ADR-001 P0-B).
  --
  -- Staff are reconciled immediately afterwards by private.provision_staff,
  -- inside the same server-side operation.
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
-- 2. provision_staff: reconcile the identity
--
-- private.grant_role already retires the stale entity row when
-- entity_is_deletable permits, then creates the correct one. A freshly created
-- account has no dependencies, so the empty students row is removed cleanly and
-- the teachers row takes its place -- leaving exactly one identity, matching
-- the role.
--
-- Re-declared here so the reconciliation contract is explicit at the point
-- where provisioning happens, rather than implied two migrations away.
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

  -- Replaces the trigger's provisional student identity with the real one.
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

  -- Post-condition: exactly one identity row, and it matches the role.
  IF _role = 'teacher' AND NOT EXISTS (SELECT 1 FROM public.teachers WHERE id = _target) THEN
    RAISE EXCEPTION 'provision_staff: teacher identity was not created for %', _target;
  END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = _target) THEN
    RAISE EXCEPTION 'provision_staff: stale student identity remains for %', _target;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.provision_staff(uuid, public.app_role, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.provision_staff(uuid, public.app_role, integer, text, text) TO service_role;

-- ------------------------------------------------------------------
-- 3. Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE _src text;
BEGIN
  SELECT prosrc INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

  IF _src ~ 'raw_app_meta_data' THEN
    RAISE EXCEPTION 'handle_new_user still reads app_metadata, which is empty at INSERT time';
  END IF;
  IF _src ~ 'raw_user_meta_data\s*->>\s*''role''' THEN
    RAISE EXCEPTION 'handle_new_user reads a role from user metadata (ADR-001 P0-B)';
  END IF;

  RAISE NOTICE 'Provisioning reconciliation installed.';
END $$;
