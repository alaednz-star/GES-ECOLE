-- ==================================================================
-- Fees and installments: what an enrollment OWES (ADR-005).
--
-- WHY THIS MIGRATION EXISTS
--
-- `payments` (20260820100000, 20260930100100) records money RECEIVED. Nothing recorded what a
-- family OWES, so no screen could answer "what does this student still have to pay?". This
-- migration adds the obligation side, next to -- never inside -- the payments ledger:
--
--   FEE / CHARGE   what is owed: an amount of a given fee type, on one enrollment.
--   INSTALLMENT    how a charge is split over time: amounts with due dates, summing to it.
--   PAYMENT        money received on an enrollment (unchanged table, unchanged rules).
--   BALANCE        derived, never stored: active charges minus payments, per enrollment.
--
-- MODEL
--
--   fee_types(id, code UNIQUE, name, built_in, status, position)
--       The kinds of fee an institution charges. Same shape as `formation_types`: built-in types
--       are displayed through the dictionaries by code (fr/ar/en), a future custom type shows its
--       name. Read-only for clients in this phase -- the built-in list covers the common cases and
--       `other` (with a mandatory label) covers the rest. An inactive type stays valid on the
--       charges that use it but cannot be given to a new charge.
--
--   charges(id, registration_id, fee_type, label, amount_dzd, note, status, created_*, cancelled_*)
--       One obligation on ONE enrollment (registration), not on the formation: two students of the
--       same group can owe different amounts (a sibling discount, a late start), and a payment is
--       already recorded against the enrollment. `registration_id` is ON DELETE RESTRICT, like
--       payments: an enrollment, group or student that carries fees cannot be deleted by accident.
--       A charge is never deleted by a client; an error is CANCELLED (with a reason), so the trail
--       of what was once asked of a family stays readable.
--
--   charge_installments(id, charge_id, position, amount_dzd, due_on)
--       Every charge has at least one installment (a single due date is a one-installment
--       schedule), at most 24. A deferred constraint trigger guarantees, at commit, that the
--       installments add up to the charge exactly and are numbered 1..n in due-date order.
--
-- WHAT IS DELIBERATELY NOT MODELLED
--
--   * Payment allocation. A payment is NOT tied to an installment, and one installment is not
--     assumed to be one payment: a family may pay two installments at once, or half of one.
--     The screen derives which installments are covered (oldest due date first) for display
--     only; nothing stores it. A future allocation table can reference payments and
--     installments without changing either.
--   * Discounts, grants, invoices, receipts, refunds, arrears reports, stored balances: later
--     phases. No placeholder tables.
--   * `groups.price_dzd` stays as it is (legacy, ADR-004 section 9); nothing here reads it.
--
-- SECURITY
--
--   Read: administrators everything; a student the charges of their OWN enrollments; teachers
--   nothing. Write: administrators only, and ONLY through `save_charge` / `cancel_charge`
--   (SECURITY DEFINER, admin check first, pinned search_path). `authenticated` holds no INSERT,
--   UPDATE or DELETE privilege on these tables at all, so no PostgREST request can bypass the
--   validation or the audit. Every creation, change and cancellation is written to `audit_log`
--   with the student as target and the before/after schedule as details.
--
-- ROLLBACK (only while no charge exists)
--   DROP FUNCTION IF EXISTS public.cancel_charge(uuid, text);
--   DROP FUNCTION IF EXISTS public.save_charge(uuid, uuid, text, text, integer, text, jsonb);
--   DROP FUNCTION IF EXISTS private.audit_charge(public.audit_action, uuid, jsonb);
--   DROP FUNCTION IF EXISTS private.charge_snapshot(uuid);
--   DROP TABLE IF EXISTS public.charge_installments, public.charges, public.fee_types;
--   DROP FUNCTION IF EXISTS public.check_charge_schedule(), public.guard_charge_change(),
--     public.guard_installment_change();
--   (the three audit_action values of 20261006100000 cannot be removed from the enum; unused
--   values are harmless)
-- ==================================================================

-- ------------------------------------------------------------------
-- Fee types
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fee_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  built_in   boolean NOT NULL DEFAULT false,
  status     public.entity_status NOT NULL DEFAULT 'active',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fee_types_name_unique ON public.fee_types (lower(btrim(name)));

COMMENT ON TABLE public.fee_types IS
  'Kinds of fee (registration, tuition, materials...). Built-in types are translated by code. '
  'Referenced by charges.fee_type (code). Read-only for clients.';

-- Built-in types: the fees Algerian private schools and training centres commonly ask for.
INSERT INTO public.fee_types (code, name, built_in, position) VALUES
  ('registration', 'Frais d''inscription',     true, 1),
  ('tuition',      'Frais de formation',       true, 2),
  ('materials',    'Fournitures et supports',  true, 3),
  ('exam',         'Frais d''examen',          true, 4),
  ('insurance',    'Assurance',                true, 5),
  ('transport',    'Transport',                true, 6),
  ('canteen',      'Cantine',                  true, 7),
  ('other',        'Autre',                    true, 8)
ON CONFLICT (code) DO NOTHING;

DROP TRIGGER IF EXISTS t_fee_types_updated ON public.fee_types;
CREATE TRIGGER t_fee_types_updated BEFORE UPDATE ON public.fee_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fee_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fee types read" ON public.fee_types;
CREATE POLICY "fee types read" ON public.fee_types FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.fee_types FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fee_types TO authenticated;

-- ------------------------------------------------------------------
-- Charges
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations (id) ON DELETE RESTRICT,
  fee_type        text NOT NULL REFERENCES public.fee_types (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  label           text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120),
  amount_dzd      integer NOT NULL CHECK (amount_dzd > 0),
  note            text CHECK (note IS NULL OR length(note) <= 500),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by      uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  cancelled_at    timestamptz,
  cancelled_by    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  cancel_reason   text,
  -- "Autre" says nothing on its own: the family must be able to read what it is for.
  CONSTRAINT charges_other_labelled CHECK (fee_type <> 'other' OR label IS NOT NULL),
  CONSTRAINT charges_cancellation_consistent CHECK (
    CASE WHEN status = 'cancelled'
      THEN cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL
           AND length(btrim(cancel_reason)) BETWEEN 1 AND 300
      ELSE cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL
    END)
);

CREATE INDEX IF NOT EXISTS charges_registration_idx ON public.charges (registration_id);

-- No duplicate obligation: one ACTIVE charge per enrollment, fee type and label. Two "materials"
-- charges are fine when their labels differ ("Livres", "Blouse"); a cancelled charge does not
-- block entering the corrected one.
CREATE UNIQUE INDEX IF NOT EXISTS charges_one_active_per_kind
  ON public.charges (registration_id, fee_type, lower(coalesce(btrim(label), '')))
  WHERE status = 'active';

COMMENT ON TABLE public.charges IS
  'What an enrollment owes: one fee (type, amount) split into installments. Never deleted by a '
  'client -- cancelled with a reason. Written only through save_charge / cancel_charge (audited). '
  'Not a payment: money received stays in payments.';

-- ------------------------------------------------------------------
-- Installments
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.charge_installments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id  uuid NOT NULL REFERENCES public.charges (id) ON DELETE CASCADE,
  position   smallint NOT NULL CHECK (position BETWEEN 1 AND 24),
  amount_dzd integer NOT NULL CHECK (amount_dzd > 0),
  due_on     date NOT NULL CHECK (due_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charge_installments_position_unique UNIQUE (charge_id, position),
  CONSTRAINT charge_installments_due_unique UNIQUE (charge_id, due_on)
);

COMMENT ON TABLE public.charge_installments IS
  'The schedule of a charge: 1 to 24 amounts with due dates, numbered in due-date order, summing '
  'exactly to the charge (deferred check). Not tied to payments: coverage is derived for display.';

-- ------------------------------------------------------------------
-- Integrity triggers
-- ------------------------------------------------------------------

-- The schedule must add up, checked at COMMIT so a charge and its installments can be written in
-- any order inside one transaction. SECURITY DEFINER so the check sees every installment whatever
-- the caller's row-level visibility.
CREATE OR REPLACE FUNCTION public.check_charge_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _charge uuid;
  _amount integer;
  _n      integer;
  _sum    bigint;
  _bad    integer;
BEGIN
  IF TG_TABLE_NAME = 'charges' THEN
    _charge := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    _charge := OLD.charge_id;
  ELSE
    _charge := NEW.charge_id;
  END IF;

  SELECT c.amount_dzd INTO _amount FROM public.charges c WHERE c.id = _charge;
  IF NOT FOUND THEN
    RETURN NULL; -- the charge itself is gone (cascade); nothing left to check
  END IF;

  SELECT count(*), coalesce(sum(i.amount_dzd), 0) INTO _n, _sum
    FROM public.charge_installments i WHERE i.charge_id = _charge;

  IF _n < 1 OR _n > 24 THEN
    RAISE EXCEPTION 'A fee must have between 1 and 24 installments (found %).', _n
      USING ERRCODE = 'check_violation';
  END IF;
  IF _sum <> _amount THEN
    RAISE EXCEPTION 'The installments (% DZD) must add up to the amount of the fee (% DZD).', _sum, _amount
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO _bad
    FROM (SELECT i.position, row_number() OVER (ORDER BY i.due_on) AS rn
            FROM public.charge_installments i WHERE i.charge_id = _charge) s
   WHERE s.position <> s.rn;
  IF _bad > 0 THEN
    RAISE EXCEPTION 'Installments must be numbered 1 to % in due-date order.', _n
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.check_charge_schedule() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_charges_schedule ON public.charges;
CREATE CONSTRAINT TRIGGER t_charges_schedule
  AFTER INSERT OR UPDATE OF amount_dzd ON public.charges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_charge_schedule();

DROP TRIGGER IF EXISTS t_charge_installments_schedule ON public.charge_installments;
CREATE CONSTRAINT TRIGGER t_charge_installments_schedule
  AFTER INSERT OR UPDATE OR DELETE ON public.charge_installments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_charge_schedule();

-- A charge keeps its enrollment for life, and a cancelled charge is frozen. These hold for EVERY
-- path, including SQL run outside the RPCs.
CREATE OR REPLACE FUNCTION public.guard_charge_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.registration_id <> OLD.registration_id THEN
    RAISE EXCEPTION 'The enrollment of a fee cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled fee cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_charge_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_charges_guard ON public.charges;
CREATE TRIGGER t_charges_guard BEFORE UPDATE ON public.charges
  FOR EACH ROW EXECUTE FUNCTION public.guard_charge_change();

DROP TRIGGER IF EXISTS t_charges_updated ON public.charges;
CREATE TRIGGER t_charges_updated BEFORE UPDATE ON public.charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guard_installment_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _status text;
BEGIN
  SELECT c.status INTO _status FROM public.charges c
   WHERE c.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.charge_id ELSE NEW.charge_id END;
  -- Not found: the charge is being deleted (cascade) -- allowed.
  IF _status = 'cancelled' THEN
    RAISE EXCEPTION 'The installments of a cancelled fee cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.charge_id <> OLD.charge_id THEN
    RAISE EXCEPTION 'An installment cannot be moved to another fee.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_installment_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_charge_installments_guard ON public.charge_installments;
CREATE TRIGGER t_charge_installments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.charge_installments
  FOR EACH ROW EXECUTE FUNCTION public.guard_installment_change();

-- ------------------------------------------------------------------
-- Row-level security: admins read everything, a student their own enrollments' fees
-- ------------------------------------------------------------------

ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charge_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "charges read" ON public.charges;
CREATE POLICY "charges read" ON public.charges FOR SELECT TO authenticated
  USING (
    private.is_admin()
    OR EXISTS (SELECT 1 FROM public.registrations r
                WHERE r.id = charges.registration_id AND r.student_id = auth.uid())
  );

-- Visible exactly when its charge is (the subquery runs under the caller's charges policy).
DROP POLICY IF EXISTS "charge installments read" ON public.charge_installments;
CREATE POLICY "charge installments read" ON public.charge_installments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.charges c WHERE c.id = charge_installments.charge_id));

-- No client write privilege at all: the two functions below are the only write path.
REVOKE ALL ON public.charges, public.charge_installments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.charges, public.charge_installments TO authenticated;

-- ------------------------------------------------------------------
-- Audit helpers (private schema: not callable through PostgREST)
-- ------------------------------------------------------------------

-- A charge and its schedule as one JSON document: what the audit log keeps before and after.
CREATE OR REPLACE FUNCTION private.charge_snapshot(p_charge uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'fee_type', c.fee_type, 'label', c.label, 'amount_dzd', c.amount_dzd,
           'note', c.note, 'status', c.status,
           'installments', coalesce((
             SELECT jsonb_agg(jsonb_build_object('position', i.position, 'due_on', i.due_on,
                                                 'amount_dzd', i.amount_dzd) ORDER BY i.position)
               FROM public.charge_installments i WHERE i.charge_id = c.id), '[]'::jsonb))
    FROM public.charges c WHERE c.id = p_charge;
$$;

REVOKE ALL ON FUNCTION private.charge_snapshot(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.audit_charge(
  p_action public.audit_action, p_charge uuid, p_details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _actor        uuid := auth.uid();
  _actor_mail   text;
  _student      uuid;
  _student_mail text;
  _registration uuid;
  _group        uuid;
BEGIN
  SELECT c.registration_id, r.student_id, r.group_id INTO _registration, _student, _group
    FROM public.charges c JOIN public.registrations r ON r.id = c.registration_id
   WHERE c.id = p_charge;
  SELECT p.email INTO _student_mail FROM public.profiles p WHERE p.id = _student;
  SELECT p.email INTO _actor_mail   FROM public.profiles p WHERE p.id = _actor;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (p_action, _actor, _actor_mail, _student, _student_mail,
          p_details || jsonb_build_object('charge_id', p_charge, 'registration_id', _registration,
                                          'group_id', _group));
END;
$$;

REVOKE ALL ON FUNCTION private.audit_charge(public.audit_action, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- Write path: save_charge (create or edit) and cancel_charge
-- ------------------------------------------------------------------

/*
  save_charge(p_charge, p_registration, p_fee_type, p_label, p_amount, p_note, p_installments)

  p_charge NULL creates a charge on p_registration (which must be an APPROVED enrollment);
  otherwise edits that ACTIVE charge (its enrollment never changes). p_installments is the whole
  schedule, a JSON array of {"due_on": "YYYY-MM-DD", "amount_dzd": n} in due-date order; an edit
  replaces the schedule. Returns the charge id. Errors are check_violation with a sentence the
  screen can show, or insufficient_privilege for a non-administrator.
*/
CREATE OR REPLACE FUNCTION public.save_charge(
  p_charge       uuid,
  p_registration uuid,
  p_fee_type     text,
  p_label        text,
  p_amount       integer,
  p_note         text,
  p_installments jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _label  text := nullif(btrim(coalesce(p_label, '')), '');
  _note   text := nullif(btrim(coalesce(p_note, '')), '');
  _old    public.charges;
  _reg    public.registrations;
  _type   public.fee_types;
  _id     uuid;
  _n      integer;
  _item   jsonb;
  _due    date;
  _amt    bigint;
  _prev   date;
  _sum    bigint := 0;
  _before jsonb;
  _after  jsonb;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage fees.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The fee
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'The amount of a fee must be greater than zero.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _type FROM public.fee_types WHERE code = p_fee_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown fee type.' USING ERRCODE = 'check_violation';
  END IF;
  IF _label IS NOT NULL AND length(_label) > 120 THEN
    RAISE EXCEPTION 'The label of a fee is limited to 120 characters.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_fee_type = 'other' AND _label IS NULL THEN
    RAISE EXCEPTION 'A fee of type "other" needs a label.' USING ERRCODE = 'check_violation';
  END IF;
  IF _note IS NOT NULL AND length(_note) > 500 THEN
    RAISE EXCEPTION 'The note of a fee is limited to 500 characters.' USING ERRCODE = 'check_violation';
  END IF;

  -- The schedule
  IF p_installments IS NULL OR jsonb_typeof(p_installments) <> 'array' THEN
    RAISE EXCEPTION 'A fee needs at least one installment.' USING ERRCODE = 'check_violation';
  END IF;
  _n := jsonb_array_length(p_installments);
  IF _n < 1 OR _n > 24 THEN
    RAISE EXCEPTION 'A fee must have between 1 and 24 installments.' USING ERRCODE = 'check_violation';
  END IF;
  FOR i IN 0 .. _n - 1 LOOP
    _item := p_installments -> i;
    BEGIN
      _due := (_item ->> 'due_on')::date;
      _amt := (_item ->> 'amount_dzd')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Installment % is not valid.', i + 1 USING ERRCODE = 'check_violation';
    END;
    IF _due IS NULL OR _due < DATE '2000-01-01' OR _due > DATE '2100-12-31' THEN
      RAISE EXCEPTION 'Installment % needs a valid due date.', i + 1 USING ERRCODE = 'check_violation';
    END IF;
    IF _amt IS NULL OR _amt <= 0 OR _amt > 2147483647 THEN
      RAISE EXCEPTION 'Installment % needs an amount greater than zero.', i + 1
        USING ERRCODE = 'check_violation';
    END IF;
    IF _prev IS NOT NULL AND _due <= _prev THEN
      RAISE EXCEPTION 'Installment due dates must follow one another, without repeats.'
        USING ERRCODE = 'check_violation';
    END IF;
    _prev := _due;
    _sum := _sum + _amt;
  END LOOP;
  IF _sum <> p_amount THEN
    RAISE EXCEPTION 'The installments (% DZD) must add up to the amount of the fee (% DZD).', _sum, p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_charge IS NULL THEN
    -- Create: on an approved enrollment, with a type still in use. FOR SHARE so a concurrent
    -- withdrawal waits for this transaction rather than slipping between the check and the insert.
    SELECT * INTO _reg FROM public.registrations WHERE id = p_registration FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This enrollment does not exist.' USING ERRCODE = 'check_violation';
    END IF;
    IF _reg.status <> 'approved' THEN
      RAISE EXCEPTION 'A fee can only be added to an active enrollment.' USING ERRCODE = 'check_violation';
    END IF;
    IF _type.status <> 'active' THEN
      RAISE EXCEPTION 'This fee type is no longer in use.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.charges (registration_id, fee_type, label, amount_dzd, note, created_by)
    VALUES (p_registration, p_fee_type, _label, p_amount, _note, auth.uid())
    RETURNING id INTO _id;
  ELSE
    SELECT * INTO _old FROM public.charges WHERE id = p_charge FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This fee no longer exists.' USING ERRCODE = 'check_violation';
    END IF;
    IF _old.status <> 'active' THEN
      RAISE EXCEPTION 'A cancelled fee cannot be changed.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_registration IS NOT NULL AND p_registration <> _old.registration_id THEN
      RAISE EXCEPTION 'The enrollment of a fee cannot be changed.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_fee_type <> _old.fee_type AND _type.status <> 'active' THEN
      RAISE EXCEPTION 'This fee type is no longer in use.' USING ERRCODE = 'check_violation';
    END IF;

    _before := private.charge_snapshot(p_charge);
    UPDATE public.charges
       SET fee_type = p_fee_type, label = _label, amount_dzd = p_amount, note = _note
     WHERE id = p_charge;
    DELETE FROM public.charge_installments WHERE charge_id = p_charge;
    _id := p_charge;
  END IF;

  INSERT INTO public.charge_installments (charge_id, position, amount_dzd, due_on)
  SELECT _id, t.ord, (t.e ->> 'amount_dzd')::integer, (t.e ->> 'due_on')::date
    FROM jsonb_array_elements(p_installments) WITH ORDINALITY AS t (e, ord);

  _after := private.charge_snapshot(_id);
  IF p_charge IS NULL THEN
    PERFORM private.audit_charge('charge_created', _id, jsonb_build_object('charge', _after));
  ELSIF _before IS DISTINCT FROM _after THEN
    PERFORM private.audit_charge('charge_updated', _id,
                                 jsonb_build_object('before', _before, 'after', _after));
  END IF;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_charge(uuid, uuid, text, text, integer, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_charge(uuid, uuid, text, text, integer, text, jsonb)
  TO authenticated;

/*
  cancel_charge(p_charge, p_reason): an ACTIVE charge becomes cancelled, with who, when and why.
  It stays listed (struck through) and no longer counts in what the enrollment owes. Final: a
  corrected obligation is entered as a new charge.
*/
CREATE OR REPLACE FUNCTION public.cancel_charge(p_charge uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reason text := btrim(coalesce(p_reason, ''));
  _old    public.charges;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage fees.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_reason) < 1 OR length(_reason) > 300 THEN
    RAISE EXCEPTION 'Cancelling a fee needs a reason (300 characters at most).'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO _old FROM public.charges WHERE id = p_charge FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This fee no longer exists.' USING ERRCODE = 'check_violation';
  END IF;
  IF _old.status <> 'active' THEN
    RAISE EXCEPTION 'This fee is already cancelled.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.charges
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = _reason
   WHERE id = p_charge;

  PERFORM private.audit_charge('charge_cancelled', p_charge,
                               jsonb_build_object('charge', private.charge_snapshot(p_charge),
                                                  'reason', _reason));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_charge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_charge(uuid, text) TO authenticated;

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE
  _t   text;
  _p   text;
  _fn  text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['fee_types', 'charges', 'charge_installments'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || _t)::regclass) THEN
      RAISE EXCEPTION 'SECURITY: RLS is not enabled on %', _t;
    END IF;
    FOREACH _p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege('authenticated', 'public.' || _t, _p)
         OR has_table_privilege('anon', 'public.' || _t, _p) THEN
        RAISE EXCEPTION 'SECURITY: a client role holds % on %', _p, _t;
      END IF;
    END LOOP;
    IF has_table_privilege('anon', 'public.' || _t, 'SELECT') THEN
      RAISE EXCEPTION 'SECURITY: anon can read %', _t;
    END IF;
  END LOOP;

  FOREACH _fn IN ARRAY ARRAY['public.save_charge(uuid, uuid, text, text, integer, text, jsonb)',
                             'public.cancel_charge(uuid, text)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = _fn::regprocedure) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER', _fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = _fn::regprocedure
                      AND proconfig @> ARRAY['search_path=public']) THEN
      RAISE EXCEPTION 'SECURITY: % has no pinned search_path', _fn;
    END IF;
    IF has_function_privilege('anon', _fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'SECURITY: anon can execute %', _fn;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'private.audit_charge(public.audit_action, uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.charge_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: the fee audit helpers are callable by clients';
  END IF;

  IF (SELECT confdeltype FROM pg_constraint
       WHERE conrelid = 'public.charges'::regclass AND contype = 'f'
         AND confrelid = 'public.registrations'::regclass) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'charges.registration_id must be ON DELETE RESTRICT';
  END IF;

  RAISE NOTICE 'Fees and installments installed.';
END $$;
