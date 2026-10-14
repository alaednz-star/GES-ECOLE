-- ------------------------------------------------------------------
-- Administrator accounts: deactivate, reactivate, and delete safely.
--
-- Teachers have had a lifecycle since 20260806155000; administrators have only
-- ever been created. An administrator who leaves therefore kept a working login
-- with full access, and the only way to stop them was to have somebody edit the
-- database by hand.
--
-- WHERE "DEACTIVATED" LIVES. In `auth.users.banned_until`, exactly as it does
-- for a suspended teacher -- because that is the field GoTrue itself checks
-- when a token is issued or refreshed. A status column on `profiles` would be a
-- second copy of the truth that grants nothing and can disagree with it, and an
-- account that *looks* deactivated while still able to sign in is worse than one
-- that was never deactivated at all.
--
-- WHY THE RULES ARE IN THE DATABASE. Counting inside a SECURITY DEFINER
-- function the caller cannot bypass puts the check next to the data and applies
-- it to every path, not just the one screen: a forged POST to the server
-- function meets the same rule the menu shows.
--
-- WHAT THIS DOES NOT GUARANTEE, STATED PLAINLY. The ban itself is applied by
-- GoTrue through its admin API, in a separate round trip from this check, so
-- check-and-act is not atomic and no amount of locking here can make it so. Two
-- administrators deactivating EACH OTHER within the same instant would both read
-- "2 active", both be permitted, and both proceed -- leaving nobody able to sign
-- in. The single-actor version of that mistake, which is the one that actually
-- happens, is refused outright by the self rule below. Closing the two-actor
-- window would mean either writing `auth.users.banned_until` from inside this
-- transaction, or re-counting after the ban and undoing it when the count has
-- reached zero. Neither is done here; the limitation is recorded rather than
-- implied away.
--
-- `FOR UPDATE` below locks the TARGET's role row. That serialises two callers
-- acting on the same account -- it does not serialise callers acting on
-- different accounts, which is the case described above.
--
-- Nothing here deletes an audit row or weakens a constraint.
-- ------------------------------------------------------------------

-- New audit actions. Added, never used, in this migration: PostgreSQL forbids
-- using an enum value in the same transaction that introduces it.
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'admin_deactivated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'admin_reactivated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'admin_deleted';

-- ------------------------------------------------------------------
-- How many administrators can actually sign in right now.
--
-- "Active" is not "has the admin role" -- a banned administrator holds the role
-- and cannot use it. Counting roles alone would let the last usable account be
-- deactivated because a disabled one appeared to be standing behind it.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.active_admin_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public', 'auth'
AS $$
  SELECT count(*)::int
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.role = 'admin'
     AND u.deleted_at IS NULL
     AND (u.banned_until IS NULL OR u.banned_until <= now());
$$;

REVOKE ALL ON FUNCTION private.active_admin_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.active_admin_count() TO authenticated, service_role;

-- ------------------------------------------------------------------
-- The guard. Raises rather than returns: a caller that forgets to inspect a
-- boolean would proceed, and this is the check standing between a school and
-- losing access to its own system.
--
-- `_action` is one of 'deactivate' or 'delete'. Reactivation needs no guard --
-- it can only ever increase the number of people who can get in.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.assert_admin_removable(
  _target uuid,
  _actor  uuid,
  _action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public', 'auth'
AS $$
DECLARE
  target_is_admin boolean;
  target_active   boolean;
  remaining       integer;
BEGIN
  IF _action NOT IN ('deactivate', 'delete') THEN
    RAISE EXCEPTION 'Unknown administrator action: %', _action USING ERRCODE = '22023';
  END IF;

  -- An administrator must not lock themselves out. This is separate from the
  -- last-administrator rule and fires even when others remain: the mistake it
  -- prevents is the common one -- acting on the wrong row in a list of names --
  -- and its consequence is immediate, because the session ends underneath them.
  IF _target = _actor THEN
    RAISE EXCEPTION 'An administrator cannot % their own account', _action
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _target AND role = 'admin'
            FOR UPDATE
         )
    INTO target_is_admin;

  -- Only administrators are counted for lockout. Removing a teacher account
  -- through this path cannot reduce the number of people who can administer.
  IF NOT target_is_admin THEN
    RETURN;
  END IF;

  SELECT (u.banned_until IS NULL OR u.banned_until <= now())
    INTO target_active
    FROM auth.users u
   WHERE u.id = _target;

  -- Deactivating an already-deactivated account changes nothing, and deleting
  -- one cannot reduce a count it was never part of.
  IF target_active IS NOT TRUE THEN
    RETURN;
  END IF;

  remaining := private.active_admin_count() - 1;

  IF remaining < 1 THEN
    RAISE EXCEPTION
      'This is the last administrator who can sign in; % would lock everyone out', _action
      USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_admin_removable(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.assert_admin_removable(uuid, uuid, text) TO service_role;

-- NO PUBLIC WRAPPER FOR THE COUNT. The page needs to know how many
-- administrators can sign in, but it already holds that: the user list it has
-- just loaded carries the role and the active flag for every one of them, so
-- counting it client-side asks nothing new. A second, PostgREST-reachable way
-- to ask the same question would be exposed surface bought for nothing, and the
-- count the decision actually rests on is the one read inside the guard below,
-- in the same statement that performs the check.

COMMENT ON FUNCTION private.assert_admin_removable(uuid, uuid, text) IS
  'Refuses an administrator deactivation or deletion that would lock the school out, and '
  'refuses one aimed at the caller''s own account. Raises; never returns a boolean to ignore.';

-- ------------------------------------------------------------------
-- The guard, reachable by the server.
--
-- `private` is not exposed to PostgREST, and the server functions reach the
-- database through it. This wrapper is granted to `service_role` ALONE: the
-- guard is not something a signed-in user should be able to call directly, and
-- unlike the count above it is not merely informational.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_admin_removable(
  _target uuid,
  _actor  uuid,
  _action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  PERFORM private.assert_admin_removable(_target, _actor, _action);
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_removable(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_admin_removable(uuid, uuid, text) TO service_role;
