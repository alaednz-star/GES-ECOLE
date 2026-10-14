-- ==================================================================
-- Remises & bourses: what is waived on a student's fee (ADR-006 section 2).
--
--   discounts         the institution's catalogue: « Fratrie -10 % », « Bourse 100 % »,
--                     « Remise fidélité -2 000 DZD ». percent (1..100) or amount (DZD), optionally
--                     limited to one fee type.
--   charge_discounts  a discount GRANTED on one charge: its amount is computed and FROZEN at grant
--                     time (catalogue edits change no grant); cancelled, never deleted.
--
-- Balance = active charges - active discounts - payments (derived). A discount never edits the
-- charge nor any payment. The total of active discounts on a charge never exceeds the charge
-- (checked in grant_discount and by a deferred trigger, so editing a charge below its discounts
-- is refused too).
--
-- SECURITY: admins read everything; a student reads the discounts of their own charges; writes
-- only through save_discount / set_discount_active / grant_discount / cancel_discount (SECURITY
-- DEFINER, admin check, audited).
--
-- ROLLBACK (only while no discount is granted)
--   DROP FUNCTION public.cancel_discount(uuid, text), public.grant_discount(uuid, uuid, integer, text, text),
--     public.set_discount_active(uuid, boolean), public.save_discount(uuid, text, text, integer, text, text),
--     public.check_charge_discounts(), private.audit_discount(public.audit_action, uuid, jsonb);
--   DROP TABLE public.charge_discounts, public.discounts;
-- ==================================================================

CREATE TABLE IF NOT EXISTS public.discounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  kind        text NOT NULL CHECK (kind IN ('percent', 'amount')),
  value       integer NOT NULL CHECK (value > 0),
  fee_type    text REFERENCES public.fee_types (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  description text CHECK (description IS NULL OR length(description) <= 300),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by  uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discounts_percent_range CHECK (kind <> 'percent' OR value <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS discounts_name_unique
  ON public.discounts (lower(btrim(name))) WHERE status = 'active';

COMMENT ON TABLE public.discounts IS
  'Catalogue of discounts and grants (percent or fixed amount). Granting copies a frozen amount '
  'into charge_discounts; editing the catalogue changes no grant.';

CREATE TABLE IF NOT EXISTS public.charge_discounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id     uuid NOT NULL REFERENCES public.charges (id) ON DELETE CASCADE,
  discount_id   uuid REFERENCES public.discounts (id) ON DELETE SET NULL,
  label         text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  amount_dzd    integer NOT NULL CHECK (amount_dzd > 0),
  reason        text CHECK (reason IS NULL OR length(reason) <= 300),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  granted_by    uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  cancel_reason text,
  CONSTRAINT charge_discounts_cancellation_consistent CHECK (
    CASE WHEN status = 'cancelled'
      THEN cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL
           AND length(btrim(cancel_reason)) BETWEEN 1 AND 300
      ELSE cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL
    END)
);

CREATE INDEX IF NOT EXISTS charge_discounts_charge_idx ON public.charge_discounts (charge_id);
-- The same catalogue discount cannot be granted twice on one fee.
CREATE UNIQUE INDEX IF NOT EXISTS charge_discounts_once_per_charge
  ON public.charge_discounts (charge_id, discount_id)
  WHERE status = 'active' AND discount_id IS NOT NULL;

COMMENT ON TABLE public.charge_discounts IS
  'A discount granted on one charge, amount frozen at grant time. Cancelled, never deleted by a '
  'client. Reduces what is owed; never edits the charge or a payment.';

DROP TRIGGER IF EXISTS t_discounts_updated ON public.discounts;
CREATE TRIGGER t_discounts_updated BEFORE UPDATE ON public.discounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Never more waived than owed: checked at commit, on grants and on charge edits.
CREATE OR REPLACE FUNCTION public.check_charge_discounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _charge uuid;
  _amount integer;
  _waived bigint;
BEGIN
  -- Separate statements, not one CASE: PL/pgSQL resolves every record field of an expression,
  -- and a charges row has no charge_id.
  IF TG_TABLE_NAME = 'charges' THEN
    _charge := NEW.id;
  ELSE
    _charge := NEW.charge_id;
  END IF;
  SELECT amount_dzd INTO _amount FROM public.charges WHERE id = _charge;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(amount_dzd), 0) INTO _waived
    FROM public.charge_discounts WHERE charge_id = _charge AND status = 'active';
  IF _waived > _amount THEN
    RAISE EXCEPTION 'The discounts on this fee (% DZD) would exceed its amount (% DZD).', _waived, _amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.check_charge_discounts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_charge_discounts_within ON public.charge_discounts;
CREATE CONSTRAINT TRIGGER t_charge_discounts_within
  AFTER INSERT OR UPDATE ON public.charge_discounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_charge_discounts();

DROP TRIGGER IF EXISTS t_charges_discounts_within ON public.charges;
CREATE CONSTRAINT TRIGGER t_charges_discounts_within
  AFTER UPDATE OF amount_dzd ON public.charges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_charge_discounts();

-- Row-level security
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charge_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discounts admin read" ON public.discounts;
CREATE POLICY "discounts admin read" ON public.discounts FOR SELECT TO authenticated
  USING (private.is_admin());

-- Visible exactly when its charge is (admin, or the student's own enrollment).
DROP POLICY IF EXISTS "charge discounts read" ON public.charge_discounts;
CREATE POLICY "charge discounts read" ON public.charge_discounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.charges c WHERE c.id = charge_discounts.charge_id));

REVOKE ALL ON public.discounts, public.charge_discounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.discounts, public.charge_discounts TO authenticated;

-- Audit helper for the catalogue (no student target); grants use private.audit_charge.
CREATE OR REPLACE FUNCTION private.audit_discount(p_action public.audit_action, p_discount uuid, p_details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
BEGIN
  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (p_action, _actor, (SELECT email FROM public.profiles WHERE id = _actor), NULL, NULL,
          p_details || jsonb_build_object('discount_id', p_discount));
END;
$$;

REVOKE ALL ON FUNCTION private.audit_discount(public.audit_action, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ catalogue writes

CREATE OR REPLACE FUNCTION public.save_discount(
  p_id uuid, p_name text, p_kind text, p_value integer, p_fee_type text, p_description text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _name text := btrim(coalesce(p_name, ''));
  _desc text := nullif(btrim(coalesce(p_description, '')), '');
  _old  public.discounts;
  _id   uuid;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage discounts.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_name) < 1 OR length(_name) > 80 THEN
    RAISE EXCEPTION 'A discount needs a name (80 characters at most).' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind NOT IN ('percent', 'amount') THEN
    RAISE EXCEPTION 'Unknown discount kind.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_value IS NULL OR p_value <= 0 OR (p_kind = 'percent' AND p_value > 100) THEN
    RAISE EXCEPTION 'A percentage is between 1 and 100; an amount is greater than zero.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_fee_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fee_types WHERE code = p_fee_type) THEN
    RAISE EXCEPTION 'Unknown fee type.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.discounts (name, kind, value, fee_type, description, created_by)
    VALUES (_name, p_kind, p_value, p_fee_type, _desc, auth.uid()) RETURNING id INTO _id;
    PERFORM private.audit_discount('discount_created', _id,
      jsonb_build_object('discount', (SELECT to_jsonb(d) - 'updated_at' FROM public.discounts d WHERE d.id = _id)));
    RETURN _id;
  END IF;

  SELECT * INTO _old FROM public.discounts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This discount no longer exists.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.discounts SET name = _name, kind = p_kind, value = p_value, fee_type = p_fee_type,
         description = _desc WHERE id = p_id;
  PERFORM private.audit_discount('discount_updated', p_id, jsonb_build_object(
    'before', to_jsonb(_old) - 'updated_at',
    'after', (SELECT to_jsonb(d) - 'updated_at' FROM public.discounts d WHERE d.id = p_id)));
  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_discount(uuid, text, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_discount(uuid, text, text, integer, text, text) TO authenticated;

-- Archived discounts stay on the grants that used them but cannot be granted again.
CREATE OR REPLACE FUNCTION public.set_discount_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage discounts.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.discounts SET status = CASE WHEN p_active THEN 'active' ELSE 'archived' END WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This discount no longer exists.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM private.audit_discount('discount_updated', p_id, jsonb_build_object('active', p_active));
END;
$$;

REVOKE ALL ON FUNCTION public.set_discount_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_discount_active(uuid, boolean) TO authenticated;

-- ------------------------------------------------------------------ grants

/*
  grant_discount(p_charge, p_discount, p_amount, p_label, p_reason)
  With p_discount: the catalogue entry decides (percent of the charge, rounded down, or its fixed
  amount), capped at what the charge still allows. Without: a one-off discount of p_amount, named
  p_label. Returns the grant id.
*/
CREATE OR REPLACE FUNCTION public.grant_discount(
  p_charge uuid, p_discount uuid, p_amount integer, p_label text, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _charge public.charges;
  _d      public.discounts;
  _room   bigint;
  _amount bigint;
  _label  text := nullif(btrim(coalesce(p_label, '')), '');
  _reason text := nullif(btrim(coalesce(p_reason, '')), '');
  _id     uuid;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage discounts.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _charge FROM public.charges WHERE id = p_charge FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This fee no longer exists.' USING ERRCODE = 'check_violation';
  END IF;
  IF _charge.status <> 'active' THEN
    RAISE EXCEPTION 'A cancelled fee cannot receive a discount.' USING ERRCODE = 'check_violation';
  END IF;
  IF _reason IS NOT NULL AND length(_reason) > 300 THEN
    RAISE EXCEPTION 'The reason is limited to 300 characters.' USING ERRCODE = 'check_violation';
  END IF;
  _room := _charge.amount_dzd - coalesce((SELECT sum(amount_dzd) FROM public.charge_discounts
                                          WHERE charge_id = p_charge AND status = 'active'), 0);

  IF p_discount IS NOT NULL THEN
    SELECT * INTO _d FROM public.discounts WHERE id = p_discount;
    IF NOT FOUND OR _d.status <> 'active' THEN
      RAISE EXCEPTION 'This discount is not available.' USING ERRCODE = 'check_violation';
    END IF;
    IF _d.fee_type IS NOT NULL AND _d.fee_type <> _charge.fee_type THEN
      RAISE EXCEPTION 'This discount does not apply to this type of fee.' USING ERRCODE = 'check_violation';
    END IF;
    _amount := CASE WHEN _d.kind = 'percent' THEN (_charge.amount_dzd::bigint * _d.value) / 100
                    ELSE _d.value END;
    _amount := least(_amount, _room);
    _label := coalesce(_label, _d.name);
  ELSE
    IF _label IS NULL THEN
      RAISE EXCEPTION 'A one-off discount needs a label.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'The discount must be greater than zero.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_amount > _room THEN
      RAISE EXCEPTION 'The discount (% DZD) exceeds what is left on this fee (% DZD).', p_amount, _room
        USING ERRCODE = 'check_violation';
    END IF;
    _amount := p_amount;
  END IF;
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'Nothing is left to discount on this fee.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(_label) > 120 THEN
    RAISE EXCEPTION 'The label is limited to 120 characters.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.charge_discounts (charge_id, discount_id, label, amount_dzd, reason, granted_by)
  VALUES (p_charge, p_discount, _label, _amount, _reason, auth.uid()) RETURNING id INTO _id;
  PERFORM private.audit_charge('discount_granted', p_charge, jsonb_build_object(
    'grant', (SELECT to_jsonb(g) FROM public.charge_discounts g WHERE g.id = _id)));
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_discount(uuid, uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_discount(uuid, uuid, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_discount(p_grant uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reason text := btrim(coalesce(p_reason, ''));
  _g      public.charge_discounts;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can manage discounts.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_reason) < 1 OR length(_reason) > 300 THEN
    RAISE EXCEPTION 'Cancelling a discount needs a reason (300 characters at most).'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _g FROM public.charge_discounts WHERE id = p_grant FOR UPDATE;
  IF NOT FOUND OR _g.status <> 'active' THEN
    RAISE EXCEPTION 'This discount is not active.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.charge_discounts
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = _reason
   WHERE id = p_grant;
  PERFORM private.audit_charge('discount_cancelled', _g.charge_id, jsonb_build_object(
    'grant_id', p_grant, 'amount_dzd', _g.amount_dzd, 'label', _g.label, 'reason', _reason));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_discount(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_discount(uuid, text) TO authenticated;

-- ------------------------------------------------------------------ post-conditions
DO $$
DECLARE
  _t text;
  _p text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['discounts', 'charge_discounts'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || _t)::regclass) THEN
      RAISE EXCEPTION 'SECURITY: RLS is not enabled on %', _t;
    END IF;
    FOREACH _p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('authenticated', 'public.' || _t, _p) THEN
        RAISE EXCEPTION 'SECURITY: authenticated holds % on %', _p, _t;
      END IF;
    END LOOP;
    IF has_table_privilege('anon', 'public.' || _t, 'SELECT') THEN
      RAISE EXCEPTION 'SECURITY: anon can read %', _t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.grant_discount(uuid, uuid, integer, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: anon can grant discounts';
  END IF;
  RAISE NOTICE 'Discounts installed.';
END $$;
