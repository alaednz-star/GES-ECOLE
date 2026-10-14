-- Admin-provisioned teacher accounts.
--
-- ARCHITECTURE NOTE -- why this migration is small:
--
-- `handle_new_user()` (migration 1) already runs AFTER INSERT ON auth.users and,
-- inside that same transaction, creates the profile, assigns the role from
-- `raw_user_meta_data->>'role'`, and inserts the matching `teachers` row.
--
-- That means provisioning a teacher is ONE privileged call --
-- `auth.admin.createUser({ user_metadata: { role: 'teacher' } })` -- and the
-- database does the rest atomically. There is no multi-step workflow to unwind,
-- so the "orphaned auth user / orphaned teacher row" failure mode cannot occur:
-- either the auth insert commits and the trigger commits with it, or neither
-- does. Re-implementing that linkage in application code would duplicate logic
-- that already exists and is already transactional.
--
-- What is genuinely missing is (a) a way to force a password change on first
-- login, and (b) an audit trail. This migration adds only those.

-- ------------------------------------------------------------------
-- 1. Forced password change
--
-- Stored on `profiles` rather than in auth metadata: RLS can read it, so the
-- guard is enforceable by the database rather than by the client asserting its
-- own state. NULL/false means no change is pending.
-- ------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.password_change_required IS
  'Set when an admin provisions or resets an account with a temporary password. Cleared only after the user completes a password change.';

-- A user may clear their own flag (after actually changing the password) and an
-- admin may set it (when resetting). Nobody else can touch it -- the existing
-- "profiles self update" policy already scopes UPDATE to `id = auth.uid()` or
-- admin, so no new policy is needed; the column inherits that protection.

CREATE INDEX IF NOT EXISTS idx_profiles_password_change_required
  ON public.profiles (id) WHERE password_change_required;

-- ------------------------------------------------------------------
-- 2. Audit log
--
-- Deliberately append-only from the application's perspective: admins may read
-- it, nobody may update or delete through PostgREST. Inserts are performed by
-- the server function using the service role, which bypasses RLS -- so the
-- policies below govern *reads* and block client-side tampering.
--
-- `details` is jsonb for forward compatibility. It must never contain a
-- password: the server function writes only non-secret context.
-- ------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.audit_action AS ENUM (
    'teacher_created',
    'teacher_updated',
    'teacher_disabled',
    'teacher_enabled',
    'teacher_password_reset'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action public.audit_action NOT NULL,
  -- Who performed it. Kept even if the admin account is later removed, so the
  -- trail survives staff turnover.
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email text,
  -- Who it was done to.
  target_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_email text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Defence in depth: reject anything that looks like a credential leaking
  -- into the trail, even if application code is later changed carelessly.
  CONSTRAINT audit_log_no_secrets CHECK (
    NOT (details ? 'password')
    AND NOT (details ? 'temporary_password')
    AND NOT (details ? 'temp_password')
  )
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Admins read the trail. No INSERT/UPDATE/DELETE policy exists for
-- `authenticated`, so the table is append-only via the service role and
-- immutable to every client, including admins.
DROP POLICY IF EXISTS "audit_log admin read" ON public.audit_log;
CREATE POLICY "audit_log admin read" ON public.audit_log
FOR SELECT TO authenticated USING (private.is_admin());

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target
  ON public.audit_log (target_id, created_at DESC);

-- ------------------------------------------------------------------
-- 3. Post-conditions
-- ------------------------------------------------------------------
DO $$
DECLARE has_col boolean; has_tbl boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='password_change_required') INTO has_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='audit_log') INTO has_tbl;

  IF NOT has_col THEN RAISE EXCEPTION 'password_change_required column missing'; END IF;
  IF NOT has_tbl THEN RAISE EXCEPTION 'audit_log table missing'; END IF;

  RAISE NOTICE 'Teacher provisioning support installed.';
END $$;
