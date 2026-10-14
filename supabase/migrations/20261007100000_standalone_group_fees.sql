-- ==================================================================
-- Prices for every course: a group WITHOUT formation (a subject class such as
-- « 3AS Sciences — Mathématiques ») can carry its own fee templates (ADR-005 / ADR-006).
--
-- fee_templates.program_id becomes nullable. A row is either
--   * a formation default        (program_id set,  group_id NULL)
--   * a formation group override (program_id set,  group_id = a group of that formation)
--   * a standalone group price   (program_id NULL, group_id = a group without formation)
-- Same table, same rules (schedule check, audit, admin-only RPCs), same materialisation when an
-- enrollment is approved; no second price system. Existing rows are unchanged.
--
-- ROLLBACK (only while no standalone row exists)
--   DELETE is not needed if none exist; then ALTER TABLE public.fee_templates
--     ALTER COLUMN program_id SET NOT NULL, DROP CONSTRAINT fee_templates_owner;
--   and restore the three functions from 20261006110100.
-- ==================================================================

ALTER TABLE public.fee_templates ALTER COLUMN program_id DROP NOT NULL;
ALTER TABLE public.fee_templates DROP CONSTRAINT IF EXISTS fee_templates_owner;
ALTER TABLE public.fee_templates
  ADD CONSTRAINT fee_templates_owner CHECK (program_id IS NOT NULL OR group_id IS NOT NULL);

DROP INDEX IF EXISTS public.fee_templates_one_active_per_kind;
CREATE UNIQUE INDEX fee_templates_one_active_per_kind
  ON public.fee_templates (coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid),
                           coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
                           fee_type, lower(coalesce(btrim(label), '')))
  WHERE status = 'active';

-- A group item belongs to a group OF THAT formation, or -- when there is no formation -- to a
-- group without one. An item never moves.
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
       SELECT 1 FROM public.groups g
        WHERE g.id = NEW.group_id AND g.program_id IS NOT DISTINCT FROM NEW.program_id) THEN
    RAISE EXCEPTION 'This group does not belong to this formation.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

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
    IF p_program IS NULL THEN
      -- A group without formation (a subject class) prices itself.
      IF p_group IS NULL OR NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group AND program_id IS NULL) THEN
        RAISE EXCEPTION 'A fee belongs to a formation, or to a group without formation.' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.programs WHERE id = p_program) THEN
      RAISE EXCEPTION 'This formation does not exist.' USING ERRCODE = 'check_violation';
    END IF;
    IF _type.status <> 'active' THEN
      RAISE EXCEPTION 'This fee type is no longer in use.' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.fee_templates (program_id, group_id, fee_type, label, amount_dzd, schedule, position, created_by)
    VALUES (p_program, p_group, p_fee_type, _label, p_amount, p_schedule,
            coalesce((SELECT max(position) + 1 FROM public.fee_templates
                       WHERE program_id IS NOT DISTINCT FROM p_program AND group_id IS NOT DISTINCT FROM p_group), 0),
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
  IF p_program IS DISTINCT FROM _old.program_id OR p_group IS DISTINCT FROM _old.group_id THEN
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

  -- A group's own items win (override, or the only prices of a group without formation);
  -- otherwise the formation's defaults.
  _use_group := EXISTS (SELECT 1 FROM public.fee_templates
                         WHERE group_id = _reg.group_id AND status = 'active');
  IF _program IS NULL AND NOT _use_group THEN
    RETURN 0;
  END IF;

  FOR _t IN SELECT * FROM public.fee_templates
             WHERE status = 'active'
               AND CASE WHEN _use_group THEN group_id = _reg.group_id
                        ELSE program_id = _program AND group_id IS NULL END
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


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_templates_owner') THEN
    RAISE EXCEPTION 'fee_templates_owner missing';
  END IF;
  RAISE NOTICE 'Standalone group fees installed.';
END $$;
