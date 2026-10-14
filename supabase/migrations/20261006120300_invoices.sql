-- ==================================================================
-- Factures: an invoice per enrollment, issued on demand (ADR-006 section 4).
--
-- An invoice is a DOCUMENT, not a ledger: a frozen snapshot of the enrollment's active fees
-- (lines with their installments), active discounts, payments received and balance at the moment
-- it is issued, numbered FAC-<year>-<000001> (document_sequences). It is never edited; it can be
-- voided (with a reason) and a new one issued. Charges, discounts and payments are never touched.
--
-- Billing identity: optional legal identifiers on center_settings (legal_name, nif, nis, rc,
-- tax_article), frozen into each invoice's `issuer` snapshot.
--
-- SECURITY: admins read all invoices; a student reads their own; writes only through
-- issue_invoice / void_invoice (SECURITY DEFINER, admin check, audited invoice_*).
--
-- ROLLBACK
--   DROP FUNCTION public.void_invoice(uuid, text), public.issue_invoice(uuid);
--   DROP TABLE public.invoices;
--   ALTER TABLE public.center_settings DROP COLUMN legal_name, DROP COLUMN nif, DROP COLUMN nis,
--     DROP COLUMN rc, DROP COLUMN tax_article;
-- ==================================================================

ALTER TABLE public.center_settings
  ADD COLUMN IF NOT EXISTS legal_name  text CHECK (legal_name IS NULL OR length(btrim(legal_name)) BETWEEN 1 AND 160),
  ADD COLUMN IF NOT EXISTS nif         text CHECK (nif IS NULL OR length(btrim(nif)) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS nis         text CHECK (nis IS NULL OR length(btrim(nis)) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS rc          text CHECK (rc IS NULL OR length(btrim(rc)) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS tax_article text CHECK (tax_article IS NULL OR length(btrim(tax_article)) BETWEEN 1 AND 40);

COMMENT ON COLUMN public.center_settings.nif IS 'Numéro d''identification fiscale, printed on invoices when set.';

CREATE TABLE IF NOT EXISTS public.invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL UNIQUE,
  registration_id uuid REFERENCES public.registrations (id) ON DELETE SET NULL,
  student_id      uuid,
  student_name    text,
  group_name      text,
  program_name    text,
  issuer          jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines           jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) >= 1),
  discounts       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(discounts) = 'array'),
  total_dzd       integer NOT NULL CHECK (total_dzd > 0),
  discount_dzd    integer NOT NULL DEFAULT 0 CHECK (discount_dzd >= 0),
  paid_dzd        integer NOT NULL DEFAULT 0 CHECK (paid_dzd >= 0),
  balance_dzd     integer NOT NULL CHECK (balance_dzd >= 0),
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'voided')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid DEFAULT auth.uid(),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,
  CONSTRAINT invoices_discount_within CHECK (discount_dzd <= total_dzd),
  CONSTRAINT invoices_void_consistent CHECK (
    CASE WHEN status = 'voided'
      THEN voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 300
      ELSE voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL
    END)
);

CREATE INDEX IF NOT EXISTS invoices_registration_idx ON public.invoices (registration_id);
CREATE INDEX IF NOT EXISTS invoices_student_idx ON public.invoices (student_id);
CREATE INDEX IF NOT EXISTS invoices_issued_at_idx ON public.invoices (issued_at DESC);

COMMENT ON TABLE public.invoices IS
  'Numbered invoices: frozen snapshots of an enrollment''s fees, discounts, payments and balance. '
  'Never edited; voided with a reason. Written only by issue_invoice / void_invoice.';

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices read" ON public.invoices;
CREATE POLICY "invoices read" ON public.invoices FOR SELECT TO authenticated
  USING (private.is_admin() OR student_id = auth.uid());
REVOKE ALL ON public.invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoices TO authenticated;

-- ------------------------------------------------------------------ issue / void

CREATE OR REPLACE FUNCTION public.issue_invoice(p_registration uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reg      public.registrations;
  _lines    jsonb;
  _disc     jsonb;
  _total    bigint;
  _discount bigint;
  _paid     bigint;
  _id       uuid;
  _number   text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can issue invoices.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _reg FROM public.registrations WHERE id = p_registration;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This enrollment does not exist.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'charge_id', c.id, 'fee_type', c.fee_type, 'label', c.label, 'amount_dzd', c.amount_dzd,
           'installments', (SELECT jsonb_agg(jsonb_build_object('position', i.position, 'due_on', i.due_on,
                                                                'amount_dzd', i.amount_dzd) ORDER BY i.position)
                              FROM public.charge_installments i WHERE i.charge_id = c.id))
           ORDER BY c.created_at),
         coalesce(sum(c.amount_dzd), 0)
    INTO _lines, _total
    FROM public.charges c WHERE c.registration_id = p_registration AND c.status = 'active';
  IF _lines IS NULL OR _total <= 0 THEN
    RAISE EXCEPTION 'This enrollment has no fee to invoice.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('label', d.label, 'amount_dzd', d.amount_dzd,
                                               'charge_id', d.charge_id) ORDER BY d.granted_at), '[]'::jsonb),
         coalesce(sum(d.amount_dzd), 0)
    INTO _disc, _discount
    FROM public.charge_discounts d JOIN public.charges c ON c.id = d.charge_id
   WHERE c.registration_id = p_registration AND c.status = 'active' AND d.status = 'active';

  SELECT coalesce(sum(amount_dzd), 0) INTO _paid FROM public.payments WHERE registration_id = p_registration;

  _number := private.next_document_number('invoice', 'FAC');
  INSERT INTO public.invoices (number, registration_id, student_id, student_name, group_name, program_name,
                               issuer, lines, discounts, total_dzd, discount_dzd, paid_dzd, balance_dzd, issued_by)
  SELECT _number, _reg.id, _reg.student_id, pr.full_name, g.name, pg.name,
         (SELECT jsonb_build_object('school_name', cs.school_name, 'legal_name', cs.legal_name,
                                    'address', cs.address, 'phone', cs.phone, 'logo_url', cs.logo_url,
                                    'nif', cs.nif, 'nis', cs.nis, 'rc', cs.rc, 'tax_article', cs.tax_article)
            FROM public.center_settings cs LIMIT 1),
         _lines, _disc, _total, _discount, least(_paid, 2147483647),
         greatest(_total - _discount - _paid, 0), auth.uid()
    FROM (SELECT 1) one
    LEFT JOIN public.profiles pr ON pr.id = _reg.student_id
    LEFT JOIN public.groups g ON g.id = _reg.group_id
    LEFT JOIN public.programs pg ON pg.id = g.program_id
  RETURNING id INTO _id;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES ('invoice_issued', auth.uid(), (SELECT email FROM public.profiles WHERE id = auth.uid()),
          _reg.student_id, (SELECT email FROM public.profiles WHERE id = _reg.student_id),
          jsonb_build_object('invoice_id', _id, 'number', _number, 'registration_id', _reg.id,
                             'total_dzd', _total, 'discount_dzd', _discount, 'paid_dzd', _paid));
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_invoice(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reason text := btrim(coalesce(p_reason, ''));
  _inv    public.invoices;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can void invoices.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_reason) < 1 OR length(_reason) > 300 THEN
    RAISE EXCEPTION 'Voiding an invoice needs a reason (300 characters at most).' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _inv FROM public.invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _inv.status <> 'issued' THEN
    RAISE EXCEPTION 'This invoice is not active.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.invoices SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = _reason
   WHERE id = p_id;
  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES ('invoice_voided', auth.uid(), (SELECT email FROM public.profiles WHERE id = auth.uid()),
          _inv.student_id, (SELECT email FROM public.profiles WHERE id = _inv.student_id),
          jsonb_build_object('invoice_id', p_id, 'number', _inv.number, 'reason', _reason));
END;
$$;

REVOKE ALL ON FUNCTION public.void_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.invoices', 'INSERT')
     OR has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.invoices', 'DELETE')
     OR has_table_privilege('anon', 'public.invoices', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY: invoices are writable or readable by the wrong roles';
  END IF;
  IF has_function_privilege('anon', 'public.issue_invoice(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: anon can issue invoices';
  END IF;
  RAISE NOTICE 'Invoices installed.';
END $$;
