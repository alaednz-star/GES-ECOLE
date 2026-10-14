-- ==================================================================
-- Payment management: integrity, immutability, audit, and totals.
--
-- WHY THIS MIGRATION EXISTS
--
-- `payments` (20260820100000) records money received, but four properties a financial
-- record needs were missing:
--
--   1. IT COULD BE DESTROYED BY ACCIDENT. `registration_id` was ON DELETE CASCADE, so
--      deleting a group -- or a student deleting their own registration over the API,
--      which the registrations delete policy permits -- silently erased every payment
--      against it. Measured in scripts/e2e/verify-payments.mjs, which asserted the cascade.
--   2. ITS IDENTITY WAS EDITABLE. `authenticated` held table-wide UPDATE, so an edit could
--      move a payment to a different family (`registration_id`) or re-attribute it
--      (`recorded_by`), and the row would show no trace of either.
--   3. NOTHING RECORDED CHANGES. A payment edited or deleted left no trail at all.
--   4. IT COULD NAME NOBODY. The insert policy accepted `recorded_by IS NULL`.
--
-- WHAT IT DOES
--
--   a. `registration_id` becomes ON DELETE RESTRICT. A registration, group or student
--      that carries payments can no longer be deleted until those payments are dealt
--      with deliberately. The database answers 23503, which the application already
--      renders as "in use".
--   b. Column-level UPDATE: only amount, date, method, note and reference are editable.
--   c. An AFTER trigger writes `payment_recorded` / `payment_updated` / `payment_deleted`
--      to `audit_log`, with the student as target and the old/new values as details. A
--      trigger rather than a server function so that NO path -- PostgREST, Studio, a
--      future screen -- can change money without leaving a record.
--   d. The insert policy requires `recorded_by = auth.uid()` and an APPROVED registration:
--      a pending or refused request is not a place, and money is not taken for it.
--   e. `reference` -- an optional cheque or transfer number, because two of the four
--      methods produce one and a bursar reconciling a bank statement needs it.
--   f. `paid_on` is bounded: not before 2000, not after tomorrow (one day of slack, since
--      the server's date is UTC and the school's is not).
--   g. `payment_daily_totals`, a security_invoker view summing payments per day, so the
--      Payments header can show all-time, today and this-month totals without fetching
--      every payment.
--
-- WHAT IT DOES NOT DO
--
--   No balances, expected fees, schedules, invoices or receipts. What a family OWES is not
--   modelled yet -- `groups.price_dzd` has no billing period -- and a figure pretending
--   otherwise would be wrong. That is the payment-schedule phase.
--
-- ROLLBACK
--   drop view if exists public.payment_daily_totals;
--   drop trigger if exists t_payments_audit on public.payments;
--   drop trigger if exists t_payments_validate on public.payments;
--   drop function if exists public.audit_payment_change();
--   drop function if exists public.validate_payment();
--   alter table public.payments drop constraint payments_registration_id_fkey,
--     add constraint payments_registration_id_fkey foreign key (registration_id)
--     references public.registrations(id) on delete cascade;
--   alter table public.payments drop constraint if exists payments_reference_length,
--     drop constraint if exists payments_paid_on_floor, drop column if exists reference;
--   grant update on public.payments to authenticated;
--   -- and restore "payments insert" from 20260820100000.
-- ==================================================================

-- ------------------------------------------------------------------
-- a. Financial history survives deletions
-- ------------------------------------------------------------------

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_registration_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_registration_id_fkey
  FOREIGN KEY (registration_id) REFERENCES public.registrations (id) ON DELETE RESTRICT;

-- ------------------------------------------------------------------
-- e, f. Reference number and date bounds
-- ------------------------------------------------------------------

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reference text;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_reference_length;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_reference_length
  CHECK (reference IS NULL OR (length(btrim(reference)) BETWEEN 1 AND 100));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_paid_on_floor;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_paid_on_floor CHECK (paid_on >= DATE '2000-01-01');

COMMENT ON COLUMN public.payments.reference IS
  'Optional cheque or transfer number, for reconciling against a bank statement. Not a receipt number.';

-- The upper bound depends on today's date, which a CHECK must not (it would be
-- re-evaluated inconsistently). A trigger evaluates it at write time instead.
CREATE OR REPLACE FUNCTION public.validate_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.paid_on > current_date + 1 THEN
    RAISE EXCEPTION 'A payment cannot be dated in the future (%).', NEW.paid_on
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_payments_validate ON public.payments;
CREATE TRIGGER t_payments_validate
  BEFORE INSERT OR UPDATE OF paid_on ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment();

-- ------------------------------------------------------------------
-- b. Immutable identity: column-level UPDATE
--
-- Table-wide UPDATE is withdrawn and re-granted on the five editable columns only.
-- `registration_id`, `recorded_by` and `created_at` are therefore not writable by any
-- client, admins included; `updated_at` is maintained by t_payments_touch.
-- ------------------------------------------------------------------

REVOKE UPDATE ON public.payments FROM authenticated;
GRANT UPDATE (amount_dzd, paid_on, method, note, reference) ON public.payments TO authenticated;

-- ------------------------------------------------------------------
-- d. Insert: attributed to the caller, against an approved place
-- ------------------------------------------------------------------

DROP POLICY IF EXISTS "payments insert" ON public.payments;
CREATE POLICY "payments insert" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_admin()
    AND recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.registrations r
       WHERE r.id = payments.registration_id
         AND r.status = 'approved'
    )
  );

-- ------------------------------------------------------------------
-- c. Audit trail
--
-- SECURITY DEFINER because `audit_log` has no INSERT policy for `authenticated` -- it is
-- append-only through privileged code by design. The actor is `auth.uid()`: null when the
-- write comes from SQL run as a superuser (local tooling), which is recorded as such.
-- An UPDATE that changes nothing observable is not logged.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row          public.payments;
  _student      uuid;
  _group        uuid;
  _student_mail text;
  _actor        uuid := auth.uid();
  _actor_mail   text;
  _action       public.audit_action;
  _details      jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN _row := OLD; ELSE _row := NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND (OLD.amount_dzd, OLD.paid_on, OLD.method, OLD.note, OLD.reference)
         IS NOT DISTINCT FROM
         (NEW.amount_dzd, NEW.paid_on, NEW.method, NEW.note, NEW.reference) THEN
    RETURN NULL;
  END IF;

  SELECT r.student_id, r.group_id INTO _student, _group
    FROM public.registrations r WHERE r.id = _row.registration_id;
  SELECT p.email INTO _student_mail FROM public.profiles p WHERE p.id = _student;
  SELECT p.email INTO _actor_mail   FROM public.profiles p WHERE p.id = _actor;

  IF TG_OP = 'INSERT' THEN
    _action  := 'payment_recorded';
    _details := jsonb_build_object('payment', to_jsonb(NEW) - 'updated_at');
  ELSIF TG_OP = 'UPDATE' THEN
    _action  := 'payment_updated';
    _details := jsonb_build_object(
      'before', jsonb_build_object('amount_dzd', OLD.amount_dzd, 'paid_on', OLD.paid_on,
                                   'method', OLD.method, 'note', OLD.note, 'reference', OLD.reference),
      'after',  jsonb_build_object('amount_dzd', NEW.amount_dzd, 'paid_on', NEW.paid_on,
                                   'method', NEW.method, 'note', NEW.note, 'reference', NEW.reference));
  ELSE
    _action  := 'payment_deleted';
    _details := jsonb_build_object('payment', to_jsonb(OLD) - 'updated_at');
  END IF;

  _details := _details || jsonb_build_object(
    'payment_id', _row.id, 'registration_id', _row.registration_id, 'group_id', _group);

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (_action, _actor, _actor_mail, _student, _student_mail, _details);

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_payment_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_payments_audit ON public.payments;
CREATE TRIGGER t_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_change();

-- ------------------------------------------------------------------
-- g. Daily totals for the Payments header
--
-- security_invoker, like every view here (ADR-003 §5.2): the caller's payments policies
-- apply, so an administrator sums everything, a student would sum only their own, and a
-- teacher sums nothing.
-- ------------------------------------------------------------------

CREATE OR REPLACE VIEW public.payment_daily_totals
WITH (security_invoker = true) AS
SELECT
  p.paid_on,
  sum(p.amount_dzd)::bigint AS total_dzd,
  count(*)::int             AS payment_count
FROM public.payments p
GROUP BY p.paid_on;

GRANT SELECT ON public.payment_daily_totals TO authenticated;

COMMENT ON VIEW public.payment_daily_totals IS
  'One row per day with payments: the sum and count of payments the CALLER may see (security_invoker). Actual money received only -- never an expected or outstanding figure.';

COMMENT ON TABLE public.payments IS
  'Fees received against an approved registration. Whole dinars, strictly positive. Identity (registration, recorder) is immutable; every insert, edit and delete is written to audit_log; a registration carrying payments cannot be deleted. Administrators write, students read their own, teachers see nothing.';

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE
  _deltype "char";
  _editable int;
BEGIN
  SELECT con.confdeltype INTO _deltype
    FROM pg_constraint con
   WHERE con.conname = 'payments_registration_id_fkey'
     AND con.conrelid = 'public.payments'::regclass;
  IF _deltype IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'payments.registration_id must be ON DELETE RESTRICT, found %', _deltype;
  END IF;

  IF has_table_privilege('authenticated', 'public.payments', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated still holds table-wide UPDATE on payments';
  END IF;
  IF has_column_privilege('authenticated', 'public.payments', 'registration_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.payments', 'recorded_by', 'UPDATE') THEN
    RAISE EXCEPTION 'payment identity columns are still updatable by authenticated';
  END IF;

  SELECT count(*) INTO _editable
    FROM unnest(ARRAY['amount_dzd','paid_on','method','note','reference']) c
   WHERE has_column_privilege('authenticated', 'public.payments', c, 'UPDATE');
  IF _editable <> 5 THEN
    RAISE EXCEPTION 'expected 5 editable payment columns, found %', _editable;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payments'::regclass AND tgname = 't_payments_audit'
  ) THEN
    RAISE EXCEPTION 'payment audit trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'payment_daily_totals'
       AND c.reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'SECURITY: payment_daily_totals lacks security_invoker=true; it would bypass RLS';
  END IF;

  RAISE NOTICE 'Payment management installed.';
END $$;
