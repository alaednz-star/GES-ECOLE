-- ------------------------------------------------------------------
-- A student may withdraw a PENDING request, and nothing else.
--
-- THE GAP. "registrations delete" (20260801203305) was
--   USING (public.is_admin() OR student_id = auth.uid())
-- with no status predicate. The product only ever offers withdrawal while a
-- request is pending (dashboard.registration.tsx and dashboard.my-registrations.tsx
-- render the withdraw action for `pending` alone), but over the API a student
-- could DELETE their own APPROVED place -- vanishing from rosters, attendance and
-- the payments ledger without an administrator knowing -- or their REJECTED row,
-- which the enrolment design keeps as history (20260807100000). Recorded as a
-- KNOWN gap by scripts/e2e/verify-enrollment-security.mjs.
--
-- Since 20260930100100 an approved registration that carries payments cannot be
-- deleted by anyone (RESTRICT). This closes the remaining case: an approved or
-- rejected registration without payments.
--
-- THE FIX. The student branch gains `status = 'pending'`. Administrators are
-- unchanged: they still correct, transfer and remove registrations by hand. No
-- other policy, table or trigger is touched, and the withdraw flow behaves exactly
-- as before for the only status it was ever offered on.
--
-- A request approved between the student loading the page and confirming the
-- withdrawal now answers "0 rows deleted" instead of removing a real place -- the
-- database decides at the moment of the delete, not the screen at render time.
--
-- ROLLBACK
--   drop policy if exists "registrations delete" on public.registrations;
--   create policy "registrations delete" on public.registrations for delete
--     to authenticated using (private.is_admin() or student_id = auth.uid());
-- ------------------------------------------------------------------

DROP POLICY IF EXISTS "registrations delete" ON public.registrations;
CREATE POLICY "registrations delete" ON public.registrations
  FOR DELETE TO authenticated
  USING (
    private.is_admin()
    OR (student_id = auth.uid() AND status = 'pending')
  );

DO $$
DECLARE
  _qual text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO _qual
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.registrations'::regclass
     AND pol.polname = 'registrations delete';

  IF _qual IS NULL OR _qual !~ 'pending' THEN
    RAISE EXCEPTION 'registrations delete policy must restrict students to pending requests; found %', _qual;
  END IF;

  RAISE NOTICE 'Students may now delete only their own pending registrations.';
END $$;
