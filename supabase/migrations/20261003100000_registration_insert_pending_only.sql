-- ==================================================================
-- SEC-01: a student's registration request can only be created as a request.
--
-- THE HOLE
--
-- `registrations student insert` (20260804100000_registration_eligibility.sql) checked who the
-- row is for and whether the group is joinable, but not WHAT the row says. `authenticated` holds
-- column INSERT on `status`, `decided_at` and `note`, and no trigger forces `pending`, so a
-- student could POST
--
--     { "student_id": <self>, "group_id": <eligible>, "status": "approved" }
--
-- and hold a place nobody approved: a seat, the group's course material, visibility to its
-- teacher, and no decision notification (that trigger fires on UPDATE). Confirmed against the
-- local stack on 2026-10-01 (HTTP 201, stored `approved`). Capacity still applied.
--
-- THE RULE
--
-- A student's own insert must be exactly a request: `status = 'pending'`, no decision date, no
-- decision note. The decision belongs to the administration (`registrations admin update`).
-- The insert is REFUSED (42501) rather than silently rewritten: a client that sends a decision is
-- wrong, and saying so is safer than storing something other than what was sent.
--
-- UNCHANGED: the administrator branch (admins may insert any state -- the future admin enrolment
-- relies on it), eligibility (`private.can_join_group`), every trigger, every grant. The student
-- app sends only `student_id` and `group_id` (`useCreateRegistration`), so the defaults already
-- satisfy the new check.
--
-- ROLLBACK
--   DROP POLICY IF EXISTS "registrations student insert" ON public.registrations;
--   CREATE POLICY "registrations student insert" ON public.registrations
--     FOR INSERT TO authenticated
--     WITH CHECK (private.is_admin() OR (student_id = auth.uid() AND private.can_join_group(group_id)));
-- ==================================================================

DROP POLICY IF EXISTS "registrations student insert" ON public.registrations;
CREATE POLICY "registrations student insert" ON public.registrations
FOR INSERT TO authenticated
WITH CHECK (
  private.is_admin()
  OR (
    student_id = auth.uid()
    AND status = 'pending'
    AND decided_at IS NULL
    AND note IS NULL
    AND private.can_join_group(group_id)
  )
);

-- Post-condition: the student branch must carry the request-only conditions.
DO $$
DECLARE
  _check text;
BEGIN
  SELECT pg_get_expr(polwithcheck, polrelid) INTO _check
    FROM pg_policy
   WHERE polrelid = 'public.registrations'::regclass
     AND polname = 'registrations student insert';
  IF _check IS NULL
     OR _check NOT LIKE '%''pending''::registration_status%'
     OR _check NOT LIKE '%decided_at IS NULL%'
     OR _check NOT LIKE '%note IS NULL%' THEN
    RAISE EXCEPTION 'registrations student insert does not force a pending request: %', _check;
  END IF;
END $$;
