-- ==================================================================
-- Fee templates: the NORMAL fees of a formation, with an optional group override, turned into a
-- student's real charges when an enrollment is approved (ADR-005, "Formation fee templates").
--
-- TEMPLATE  "What is normally charged?"       fee_templates (configuration)
-- CHARGE    "What was charged to this student?" charges + charge_installments (history)
-- PAYMENT   "What was received?"               payments (unchanged)
--
-- MODEL
--   fee_templates(id, program_id, group_id NULL, fee_type, label, amount_dzd, schedule, status, position)
--     program_id   the formation the fee belongs to (never a subject)
--     group_id     NULL = the formation's default; set = an item of that group's OVERRIDE. A group
--                  with at least one active item of its own uses its own set for new enrollments;
--                  otherwise it inherits the formation's default set.
--     fee_type     the existing fee_types (no second type system)
--     schedule     [{"months": m, "amount_dzd": n}, ...] -- installments due m months after the
--                  enrollment date, same rules as charges: 1 to 24, amounts > 0, strictly
--                  increasing, summing exactly to amount_dzd (CHECK fee_templates_schedule_valid)
--     status       active / archived. A template that generated charges is archived, never
--                  deleted, when removed; an unused one is deleted.
--
-- MATERIALISATION
--   AFTER INSERT OR UPDATE OF status ON registrations: when a row BECOMES approved (admin
--   placement, approval of a request, pre-registration acceptance -- every path writes this
--   table), `private.apply_fee_templates` copies the applicable set into charges and installments
--   (due dates = approval date + months), in the SAME transaction: if the enrollment fails, no
--   charge remains. An enrollment that already has charges is never touched, and existing
--   enrollments are never backfilled. Each charge keeps `template_id` (its source); later template
--   edits change no existing charge, because the charge holds its own copied amounts and dates.
--
-- SECURITY
--   Read and write: administrators only. Writes only through save_fee_template /
--   remove_fee_template / customize_group_fees (SECURITY DEFINER, admin check, audited
--   fee_template_*); generated charges are audited charge_created with source "fee_template".
--   `groups.price_dzd` is not read.
--
-- ROLLBACK (only while no charge references a template)
--   DROP TRIGGER IF EXISTS t_registrations_z_fee_templates ON public.registrations;
--   DROP FUNCTION IF EXISTS public.charge_new_enrollment(), private.apply_fee_templates(uuid),
--     public.save_fee_template(uuid, uuid, uuid, text, text, integer, jsonb),
--     public.remove_fee_template(uuid), public.customize_group_fees(uuid),
--     private.audit_fee_template(public.audit_action, uuid, jsonb), public.guard_fee_template();
--   ALTER TABLE public.charges DROP COLUMN IF EXISTS template_id;
--   DROP TABLE IF EXISTS public.fee_templates; DROP FUNCTION IF EXISTS private.fee_schedule_error(integer, jsonb);
-- ==================================================================

-- ------------------------------------------------------------------
-- Schedule rule (the same rules as charge installments, expressed in months)
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.fee_schedule_error(p_amount integer, p_schedule jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _n     integer;
  _item  jsonb;
  _m     integer;
  _a     bigint;
  _prev  integer;
  _total bigint := 0;
BEGIN
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' THEN
    RETURN 'A fee needs at least one installment.';
  END IF;
  _n := jsonb_array_length(p_schedule);
  IF _n < 1 OR _n > 24 THEN
    RETURN 'A fee must have between 1 and 24 installments.';
  END IF;
  FOR i IN 0 .. _n - 1 LOOP
    _item := p_schedule -> i;
    IF jsonb_typeof(_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(_item -> 'months') IS DISTINCT FROM 'number'
       OR jsonb_typeof(_item -> 'amount_dzd') IS DISTINCT FROM 'number' THEN
      RETURN format('Installment %s is not valid.', i + 1);
    END IF;
    BEGIN
      _m := (_item ->> 'months')::integer;
      _a := (_item ->> 'amount_dzd')::bigint;
    EXCEPTION WHEN others THEN
      RETURN format('Installment %s is not valid.', i + 1);
    END;
    IF _m < 0 OR _m > 120 THEN
      RETURN format('Installment %s must fall between 0 and 120 months after enrollment.', i + 1);
    END IF;
    IF _a <= 0 OR _a > 2147483647 THEN
      RETURN format('Installment %s needs an amount greater than zero.', i + 1);
    END IF;
    IF _prev IS NOT NULL AND _m <= _prev THEN
      RETURN 'Installments must follow one another, without repeats.';
    END IF;
    _prev := _m;
    _total := _total + _a;
  END LOOP;
  IF _total <> p_amount THEN
    RETURN format('The installments (%s DZD) must add up to the amount of the fee (%s DZD).',
                  _total, p_amount);
  END IF;
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------------
-- Table
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fee_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs (id) ON DELETE CASCADE,
  group_id   uuid REFERENCES public.groups (id) ON DELETE CASCADE,
  fee_type   text NOT NULL REFERENCES public.fee_types (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  label      text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120),
  amount_dzd integer NOT NULL CHECK (amount_dzd > 0),
  schedule   jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  position   integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_templates_other_labelled CHECK (fee_type <> 'other' OR label IS NOT NULL),
  CONSTRAINT fee_templates_schedule_valid CHECK (private.fee_schedule_error(amount_dzd, schedule) IS NULL)
);

CREATE INDEX IF NOT EXISTS fee_templates_program_idx ON public.fee_templates (program_id);
CREATE INDEX IF NOT EXISTS fee_templates_group_idx ON public.fee_templates (group_id) WHERE group_id IS NOT NULL;

-- One active item per (formation or group, fee type, label): the same fee twice is a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS fee_templates_one_active_per_kind
  ON public.fee_templates (program_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
                           fee_type, lower(coalesce(btrim(label), '')))
  WHERE status = 'active';

COMMENT ON TABLE public.fee_templates IS
  'The normal fees of a formation (group_id NULL) or of a group override (group_id set). '
  'Configuration only: copied into charges when an enrollment is approved; never changes an '
  'existing charge. Admin-only; written through save_fee_template / remove_fee_template / '
  'customize_group_fees.';

-- The charge remembers which template it came from (NULL for charges entered by hand).
ALTER TABLE public.charges
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.fee_templates (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS charges_template_idx ON public.charges (template_id) WHERE template_id IS NOT NULL;

-- A group override belongs to a group OF THAT formation; an item never moves.
CREATE OR REPLACE FUNCTION public.guard_fee_template()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.program_id IS DISTINCT FROM OLD.program_id
                           OR NEW.group_id IS DISTINCT FROM OLD.group_id) THEN
    RAISE EXCEPTION 'A fee template cannot be moved to another formation or group.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.group_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.groups g WHERE g.id = NEW.group_id AND g.program_id = NEW.program_id) THEN
    RAISE EXCEPTION 'This group does not belong to this formation.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_fee_template() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_fee_templates_guard ON public.fee_templates;
CREATE TRIGGER t_fee_templates_guard BEFORE INSERT OR UPDATE ON public.fee_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_fee_template();

DROP TRIGGER IF EXISTS t_fee_templates_updated ON public.fee_templates;
CREATE TRIGGER t_fee_templates_updated BEFORE UPDATE ON public.fee_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------
-- Row-level security: administrators only
-- ------------------------------------------------------------------

ALTER TABLE public.fee_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fee templates admin read" ON public.fee_templates;
CREATE POLICY "fee templates admin read" ON public.fee_templates FOR SELECT TO authenticated
  USING (private.is_admin());

REVOKE ALL ON public.fee_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fee_templates TO authenticated;

-- ------------------------------------------------------------------
-- Audit helper (private schema)
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.audit_fee_template(
  p_action public.audit_action, p_template uuid, p_details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _actor      uuid := auth.uid();
  _actor_mail text;
BEGIN
  SELECT p.email INTO _actor_mail FROM public.profiles p WHERE p.id = _actor;
  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (p_action, _actor, _actor_mail, NULL, NULL,
          p_details || jsonb_build_object('template_id', p_template));
END;
$$;

REVOKE ALL ON FUNCTION private.audit_fee_template(public.audit_action, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- Write path
-- ------------------------------------------------------------------

/*
  save_fee_template(p_id, p_program, p_group, p_fee_type, p_label, p_amount, p_schedule)
  p_id NULL creates an item on the formation (p_group NULL) or on a group override; otherwise
  edits that ACTIVE item (its formation and group never change). An edit applies to FUTURE
  enrollments only: existing charges hold their own copy.
*/
CREATE OR REPLACE FUNCTION public.save_fee_template(
  p_id       uuid,
  p_program  uuid,
  p_group    uuid,
  p_fee_type text,
  p_label    text,
  p_amount   integer,
  p_schedule jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _label  text := nullif(btrim(coalesce(p_label, '')), '');
  _old    public.fee_templates;
  _type   public.fee_types;
  _error  text;
  _id     uuid;
  _after  jsonb;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage fees.' USING ERRCODE = 'insufficient_privilege';
  END IF;
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
  _error := private.fee_schedule_error(p_amount, p_schedule);
  IF _error IS NOT NULL THEN
    RAISE EXCEPTION '%', _error USING ERRCODE = 'check_violation';
  END IF;

  IF p_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.programs WHERE id = p_program) THEN
      RAISE EXCEPTION 'This formation does not exist.' USING ERRCODE = 'check_violation';
    END IF;
    IF _type.status <> 'active' THEN
      RAISE EXCEPTION 'This fee type is no longer in use.' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.fee_templates (program_id, group_id, fee_type, label, amount_dzd, schedule, position, created_by)
    VALUES (p_program, p_group, p_fee_type, _label, p_amount, p_schedule,
            coalesce((SELECT max(position) + 1 FROM public.fee_templates
                       WHERE program_id = p_program AND group_id IS NOT DISTINCT FROM p_group), 0),
            auth.uid())
    RETURNING id INTO _id;
    PERFORM private.audit_fee_template('fee_template_created', _id, jsonb_build_object(
      'template', (SELECT to_jsonb(t) - 'updated_at' FROM public.fee_templates t WHERE t.id = _id)));
    RETURN _id;
  END IF;

  SELECT * INTO _old FROM public.fee_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This fee no longer exists.' USING ERRCODE = 'check_violation';
  END IF;
  IF _old.status <> 'active' THEN
    RAISE EXCEPTION 'A removed fee cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF (p_program IS NOT NULL AND p_program <> _old.program_id)
     OR p_group IS DISTINCT FROM _old.group_id THEN
    RAISE EXCEPTION 'A fee template cannot be moved to another formation or group.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_fee_type <> _old.fee_type AND _type.status <> 'active' THEN
    RAISE EXCEPTION 'This fee type is no longer in use.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.fee_templates
     SET fee_type = p_fee_type, label = _label, amount_dzd = p_amount, schedule = p_schedule
   WHERE id = p_id;
  SELECT to_jsonb(t) - 'updated_at' INTO _after FROM public.fee_templates t WHERE t.id = p_id;
  IF (to_jsonb(_old) - 'updated_at') IS DISTINCT FROM _after THEN
    PERFORM private.audit_fee_template('fee_template_updated', p_id, jsonb_build_object(
      'before', to_jsonb(_old) - 'updated_at', 'after', _after));
  END IF;
  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_fee_template(uuid, uuid, uuid, text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_fee_template(uuid, uuid, uuid, text, text, integer, jsonb) TO authenticated;

/*
  remove_fee_template(p_id): stops an item from applying to new enrollments. Deleted when no
  charge came from it; archived (kept, inactive) when some did, so the source of those charges
  stays readable. Returns 'deleted' or 'archived'. Existing charges are never touched.
*/
CREATE OR REPLACE FUNCTION public.remove_fee_template(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _old public.fee_templates;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage fees.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _old FROM public.fee_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _old.status <> 'active' THEN
    RAISE EXCEPTION 'This fee no longer exists.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.charges WHERE template_id = p_id) THEN
    UPDATE public.fee_templates SET status = 'archived' WHERE id = p_id;
    PERFORM private.audit_fee_template('fee_template_removed', p_id, jsonb_build_object(
      'template', to_jsonb(_old) - 'updated_at', 'outcome', 'archived'));
    RETURN 'archived';
  END IF;

  DELETE FROM public.fee_templates WHERE id = p_id;
  PERFORM private.audit_fee_template('fee_template_removed', p_id, jsonb_build_object(
    'template', to_jsonb(_old) - 'updated_at', 'outcome', 'deleted'));
  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.remove_fee_template(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_fee_template(uuid) TO authenticated;

/*
  customize_group_fees(p_group): starts a group override from the formation's current default
  set (a copy the administrator then edits). Refused when the group already has its own fees.
  Returns the number of items copied.
*/
CREATE OR REPLACE FUNCTION public.customize_group_fees(p_group uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _program uuid;
  _t       public.fee_templates;
  _id      uuid;
  _n       integer := 0;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage fees.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT program_id INTO _program FROM public.groups WHERE id = p_group FOR UPDATE;
  IF _program IS NULL THEN
    RAISE EXCEPTION 'Only a group of a formation can have its own fees.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fee_templates WHERE group_id = p_group AND status = 'active') THEN
    RAISE EXCEPTION 'This group already has its own fees.' USING ERRCODE = 'check_violation';
  END IF;

  FOR _t IN SELECT * FROM public.fee_templates
             WHERE program_id = _program AND group_id IS NULL AND status = 'active'
             ORDER BY position, created_at LOOP
    INSERT INTO public.fee_templates (program_id, group_id, fee_type, label, amount_dzd, schedule, position, created_by)
    VALUES (_program, p_group, _t.fee_type, _t.label, _t.amount_dzd, _t.schedule, _t.position, auth.uid())
    RETURNING id INTO _id;
    PERFORM private.audit_fee_template('fee_template_created', _id, jsonb_build_object(
      'template', (SELECT to_jsonb(x) - 'updated_at' FROM public.fee_templates x WHERE x.id = _id),
      'copied_from', _t.id));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.customize_group_fees(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customize_group_fees(uuid) TO authenticated;

-- ------------------------------------------------------------------
-- Materialisation: an approved enrollment receives the applicable fees
-- ------------------------------------------------------------------

/*
  Copies the applicable template set into charges for ONE enrollment: the group's own active
  items if it has any, otherwise the formation's default items. Does nothing unless the
  enrollment is approved, belongs to a group of a formation, and has no charge yet. Due dates are
  today (the approval date) plus each installment's months; month ends are clamped (31 January +
  1 month = 28/29 February), always counted from the approval date. Returns the charges created.
*/
CREATE OR REPLACE FUNCTION private.apply_fee_templates(p_registration uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reg       public.registrations;
  _program   uuid;
  _use_group boolean;
  _t         public.fee_templates;
  _charge    uuid;
  _base      date := current_date;
  _n         integer := 0;
BEGIN
  SELECT * INTO _reg FROM public.registrations WHERE id = p_registration;
  IF NOT FOUND OR _reg.status <> 'approved' THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.charges WHERE registration_id = p_registration) THEN
    RETURN 0; -- never add to, or overwrite, an enrollment's existing fees
  END IF;
  SELECT g.program_id INTO _program FROM public.groups g WHERE g.id = _reg.group_id;
  IF _program IS NULL THEN
    RETURN 0;
  END IF;

  _use_group := EXISTS (SELECT 1 FROM public.fee_templates
                         WHERE group_id = _reg.group_id AND status = 'active');

  FOR _t IN SELECT * FROM public.fee_templates
             WHERE program_id = _program AND status = 'active'
               AND CASE WHEN _use_group THEN group_id = _reg.group_id ELSE group_id IS NULL END
             ORDER BY position, created_at LOOP
    INSERT INTO public.charges (registration_id, fee_type, label, amount_dzd, template_id, created_by)
    VALUES (p_registration, _t.fee_type, _t.label, _t.amount_dzd, _t.id, auth.uid())
    RETURNING id INTO _charge;
    INSERT INTO public.charge_installments (charge_id, position, amount_dzd, due_on)
    SELECT _charge, s.ord, (s.e ->> 'amount_dzd')::integer,
           (_base + make_interval(months => (s.e ->> 'months')::integer))::date
      FROM jsonb_array_elements(_t.schedule) WITH ORDINALITY AS s (e, ord);
    PERFORM private.audit_charge('charge_created', _charge, jsonb_build_object(
      'charge', private.charge_snapshot(_charge), 'source', 'fee_template', 'template_id', _t.id));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_fee_templates(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.charge_new_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM private.apply_fee_templates(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.charge_new_enrollment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_registrations_z_fee_templates ON public.registrations;
CREATE TRIGGER t_registrations_z_fee_templates
  AFTER INSERT OR UPDATE OF status ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.charge_new_enrollment();

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE
  _p  text;
  _fn text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.fee_templates'::regclass) THEN
    RAISE EXCEPTION 'SECURITY: RLS is not enabled on fee_templates';
  END IF;
  FOREACH _p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege('authenticated', 'public.fee_templates', _p)
       OR has_table_privilege('anon', 'public.fee_templates', _p) THEN
      RAISE EXCEPTION 'SECURITY: a client role holds % on fee_templates', _p;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.fee_templates', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY: anon can read fee_templates';
  END IF;
  FOREACH _fn IN ARRAY ARRAY['public.save_fee_template(uuid, uuid, uuid, text, text, integer, jsonb)',
                             'public.remove_fee_template(uuid)',
                             'public.customize_group_fees(uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = _fn::regprocedure) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER', _fn;
    END IF;
    IF has_function_privilege('anon', _fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'SECURITY: anon can execute %', _fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'private.apply_fee_templates(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: clients can materialise fees directly';
  END IF;
  RAISE NOTICE 'Fee templates installed.';
END $$;
