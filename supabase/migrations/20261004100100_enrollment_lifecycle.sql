-- ==================================================================
-- Enrollment lifecycle, step 2 (ADR-004 section 4): history is kept, re-enrollment is possible,
-- capacity is serialised, an administrator's direct placement is notified.
--
-- THE PROBLEMS
--
--   UNIQUE (student_id, group_id) held whatever the status. A rejected request could never be
--   sent again (the catalogue's "Demander à nouveau" button failed with 23505), and a student
--   who left could never come back without deleting history.
--
--   A student who left an approved place had no state to be in: the options were deleting the
--   row (losing the record, refused anyway once payments exist) or mislabelling it "rejected".
--
--   enforce_group_capacity counted approved rows without a lock: two approvals racing for the
--   last seat could both pass.
--
--   An administrator inserting an approved registration (direct placement) sent no notification:
--   the trigger only fired on UPDATE.
--
-- THE RULES
--
--   1. One ACTIVE registration per (student, group): a partial unique index over
--      ('pending', 'approved'). Rejected and withdrawn rows are history and never block a new
--      request. Uniqueness is narrowed, not dropped. (A future `waitlisted` joins the predicate.)
--   2. `withdrawn` is reachable only from `approved`, is stamped with when and by whom, and is
--      terminal: coming back is a NEW registration, so every stint keeps its own payments and
--      dates. A registration never starts withdrawn.
--   3. Capacity locks the group row before counting, so approvals into one group are serialised.
--      Only approved rows count -- pending, rejected and withdrawn never consume a seat.
--   4. A registration inserted as approved notifies the student, like an approval does.
--
-- WHAT DOES NOT CHANGE
--
--   Who may do what: students still insert only pending requests for themselves (SEC-01) and
--   delete only their own pending ones; only administrators update (decide, withdraw). Payments
--   stay on the registration they were recorded against (ON DELETE RESTRICT); attendance is keyed
--   on (group, student, date) and is untouched. Every policy that grants access through
--   `status = 'approved'` (resources, teacher visibility, payments insert) automatically stops
--   granting it on withdrawal.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS t_registrations_0_lifecycle ON public.registrations;
--   DROP FUNCTION IF EXISTS public.enforce_registration_lifecycle();
--   ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_withdrawal_consistent;
--   ALTER TABLE public.registrations DROP COLUMN IF EXISTS withdrawn_at, DROP COLUMN IF EXISTS
--     withdrawn_by, DROP COLUMN IF EXISTS withdrawal_reason;
--   DROP INDEX IF EXISTS public.registrations_one_active_per_group;
--   ALTER TABLE public.registrations ADD CONSTRAINT registrations_student_id_group_id_key
--     UNIQUE (student_id, group_id);   -- only if no (student, group) has several rows by then
--   (and restore the previous bodies of enforce_group_capacity / notify_registration_decision)
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. One active registration per (student, group)
-- ------------------------------------------------------------------

ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_student_id_group_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS registrations_one_active_per_group
  ON public.registrations (student_id, group_id)
  WHERE status IN ('pending', 'approved');

-- The old constraint also served lookups by student; keep an ordinary index for them.
CREATE INDEX IF NOT EXISTS idx_registrations_student_group
  ON public.registrations (student_id, group_id);

-- ------------------------------------------------------------------
-- 2. Withdrawal: who, when, why
-- ------------------------------------------------------------------

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS withdrawal_reason text
    CHECK (withdrawal_reason IS NULL OR length(btrim(withdrawal_reason)) BETWEEN 1 AND 300);

ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_withdrawal_consistent;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_withdrawal_consistent CHECK (
  CASE WHEN status = 'withdrawn'
       THEN withdrawn_at IS NOT NULL
       ELSE withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_reason IS NULL
  END
);

COMMENT ON COLUMN public.registrations.withdrawn_at IS
  'When an approved place was given up (status withdrawn). Stamped by enforce_registration_lifecycle.';
COMMENT ON COLUMN public.registrations.withdrawal_reason IS
  'Optional reason recorded by the administration when withdrawing a student.';

-- Who can write these: `registrations` carries table-level INSERT/UPDATE grants, so the columns
-- are covered by the existing policies rather than by column grants. A student's insert cannot
-- carry them (the CHECK above requires them NULL unless the row is withdrawn, and a student's
-- insert must be pending -- SEC-01); only administrators update. The stamps are set by the
-- trigger below and frozen once set.

-- ------------------------------------------------------------------
-- 3. Lifecycle transitions
--
-- Named `0_` so it fires before every other BEFORE trigger on the table (they fire in name
-- order): an impossible transition is refused before capacity or subject rules run.
-- SECURITY INVOKER -- it only validates and stamps NEW.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_registration_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'withdrawn' THEN
      RAISE EXCEPTION 'A registration starts as a request or a place, never withdrawn.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- A closed stint stays closed: coming back is a new registration.
  IF OLD.status = 'withdrawn' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.group_id IS DISTINCT FROM OLD.group_id
    OR NEW.student_id IS DISTINCT FROM OLD.student_id
  ) THEN
    RAISE EXCEPTION 'This enrollment was withdrawn and is closed. Enroll the student again instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The stamps of a withdrawal are facts: nobody edits them afterwards.
  IF OLD.status = 'withdrawn' THEN
    NEW.withdrawn_at := OLD.withdrawn_at;
    NEW.withdrawn_by := OLD.withdrawn_by;
  END IF;

  IF NEW.status = 'withdrawn' AND OLD.status IS DISTINCT FROM 'withdrawn' THEN
    IF OLD.status <> 'approved' THEN
      RAISE EXCEPTION 'Only an active enrollment can be withdrawn.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.withdrawn_at := now();
    NEW.withdrawn_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_registration_lifecycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_registrations_0_lifecycle ON public.registrations;
CREATE TRIGGER t_registrations_0_lifecycle
  BEFORE INSERT OR UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_registration_lifecycle();

-- ------------------------------------------------------------------
-- 4. Capacity, serialised per group
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_group_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE taken int; capacity int;
BEGIN
  -- Only approved registrations consume a seat; pending, rejected and withdrawn do not.
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;

  -- Lock the group row: two approvals into the same group now run one after the other, so
  -- the second one counts the first. Without the lock both could see the last free seat.
  SELECT g.max_students INTO capacity FROM public.groups g WHERE g.id = NEW.group_id FOR UPDATE;
  IF capacity IS NULL OR capacity <= 0 THEN RETURN NEW; END IF;

  SELECT count(*) INTO taken
  FROM public.registrations r
  WHERE r.group_id = NEW.group_id
    AND r.status = 'approved'
    AND r.id <> NEW.id;

  IF taken >= capacity THEN
    RAISE EXCEPTION 'Group % is full (%/% seats)', NEW.group_id, taken, capacity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $function$;

-- ------------------------------------------------------------------
-- 5. A direct placement notifies the student, like an approval
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_registration_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE group_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NEW; END IF;
  -- Students can only insert pending requests (SEC-01), so an approved INSERT is always an
  -- administrator placing the student directly.
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;

  SELECT g.name INTO group_name FROM public.groups g WHERE g.id = NEW.group_id;

  INSERT INTO public.notifications (user_id, kind, params)
  VALUES (
    NEW.student_id,
    CASE WHEN NEW.status = 'approved'
         THEN 'registration_approved'::public.notification_kind
         ELSE 'registration_rejected'::public.notification_kind END,
    jsonb_build_object('group', COALESCE(group_name, ''))
  );
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS t_registration_decided ON public.registrations;
CREATE TRIGGER t_registration_decided
  AFTER INSERT OR UPDATE OF status ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.notify_registration_decision();

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.registrations'::regclass
                AND conname = 'registrations_student_id_group_id_key') THEN
    RAISE EXCEPTION 'the unconditional (student, group) unique constraint is still present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'registrations_one_active_per_group'
                    AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%pending%' AND indexdef LIKE '%approved%') THEN
    RAISE EXCEPTION 'registrations_one_active_per_group is missing or not partial';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 't_registrations_0_lifecycle') THEN
    RAISE EXCEPTION 't_registrations_0_lifecycle is missing';
  END IF;
  IF pg_get_functiondef('public.enforce_group_capacity()'::regprocedure) NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'enforce_group_capacity does not lock the group row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.registrations'::regclass
                    AND conname = 'registrations_withdrawal_consistent') THEN
    RAISE EXCEPTION 'registrations_withdrawal_consistent is missing';
  END IF;
END $$;
