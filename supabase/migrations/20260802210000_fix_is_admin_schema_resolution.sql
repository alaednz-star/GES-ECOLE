-- Phase 0 / TD-1 (CRITICAL): repair private.is_admin().
--
-- Migration 20260802191718 moved has_role and is_admin from `public` into the
-- `private` schema so they stop being reachable as PostgREST RPC endpoints.
-- ALTER FUNCTION ... SET SCHEMA relocated both functions, and Postgres rewrote
-- every RLS policy to point at private.is_admin() automatically.
--
-- What it did NOT rewrite is the *body* of is_admin(), which still calls
-- public.has_role(...). Combined with `SET search_path TO 'public'`, the call
-- can never resolve, so every policy branch that evaluates is_admin() raises:
--
--   ERROR 42883: function public.has_role(uuid, unknown) does not exist
--
-- Policies therefore fail closed (deny), which is why no data was exposed --
-- but every admin read and write against the live database has been failing.
-- Self-filtered queries (WHERE id = auth.uid()) short-circuit the OR before
-- is_admin() is reached, which is why login and the student dashboard kept
-- working and the outage stayed invisible.
--
-- Fix: call the function by its real schema and put `private` on the
-- search_path. `public` is retained because has_role's body reads
-- public.user_roles.

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $function$
  SELECT private.has_role(auth.uid(), 'admin');
$function$;

-- has_role's body is already correct (it reads public.user_roles and its
-- search_path includes public), but pin `private` too so a future relocation
-- of a helper it calls cannot reintroduce this same class of failure.
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$function$;

-- CREATE OR REPLACE resets privileges to the default (EXECUTE to PUBLIC),
-- so re-apply the lockdown from migration 20260802191718.
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
