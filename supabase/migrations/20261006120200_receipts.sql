-- ==================================================================
-- Reçus: one numbered receipt per payment (ADR-006 section 3).
--
--   document_sequences  (kind, year) -> last number. Incremented in the issuing transaction with a
--                       row lock (INSERT .. ON CONFLICT DO UPDATE), so numbers are unique, in order,
--                       and a rolled-back payment does not consume one.
--   receipts            REC-<year>-<000001>, a SNAPSHOT of the payment (student, group, formation,
--                       amount, date, method, reference). Never edited, never deleted by a client.
--
-- Lifecycle, driven by payments (no client writes at all):
--   payment recorded            -> receipt issued
--   amount/date/method/ref edit -> the receipt is voided ("Paiement modifié") and a new number is
--                                  issued for the corrected payment (replaced_by links them)
--   payment deleted             -> the receipt is voided ("Paiement supprimé"); payment_id becomes
--                                  NULL, the snapshot stays readable
-- Existing payments receive their receipt now, in payment order; no payment row is modified.
--
-- SECURITY: admins read all receipts; a student reads their own; no client write privilege.
--
-- ROLLBACK
--   DROP TRIGGER t_payments_receipt_issue / t_payments_receipt_update / t_payments_receipt_void ON public.payments;
--   DROP FUNCTION public.receipt_on_payment_insert(), public.receipt_on_payment_update(),
--     public.receipt_on_payment_delete(), private.issue_receipt(uuid, uuid), private.void_receipt(uuid, text),
--     private.next_document_number(text, text);
--   DROP TABLE public.receipts, public.document_sequences;
-- ==================================================================

CREATE TABLE IF NOT EXISTS public.document_sequences (
  kind       text NOT NULL CHECK (kind IN ('receipt', 'invoice')),
  year       integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (kind, year)
);
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_sequences FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.document_sequences IS
  'Yearly counters for receipt and invoice numbers. Written only by private.next_document_number.';

CREATE OR REPLACE FUNCTION private.next_document_number(p_kind text, p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _year  integer := extract(year FROM current_date)::integer;
  _value integer;
BEGIN
  INSERT INTO public.document_sequences (kind, year, last_value) VALUES (p_kind, _year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = public.document_sequences.last_value + 1
  RETURNING last_value INTO _value;
  RETURN format('%s-%s-%s', p_prefix, _year, lpad(_value::text, 6, '0'));
END;
$$;

REVOKE ALL ON FUNCTION private.next_document_number(text, text) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL UNIQUE,
  payment_id      uuid REFERENCES public.payments (id) ON DELETE SET NULL,
  registration_id uuid REFERENCES public.registrations (id) ON DELETE SET NULL,
  student_id      uuid,
  student_name    text,
  group_name      text,
  program_name    text,
  amount_dzd      integer NOT NULL CHECK (amount_dzd > 0),
  paid_on         date NOT NULL,
  method          text NOT NULL,
  reference       text,
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'voided')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid,
  voided_at       timestamptz,
  void_reason     text,
  replaced_by     uuid REFERENCES public.receipts (id) ON DELETE SET NULL,
  CONSTRAINT receipts_void_consistent CHECK (
    (status = 'voided') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS receipts_one_issued_per_payment
  ON public.receipts (payment_id) WHERE status = 'issued' AND payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS receipts_student_idx ON public.receipts (student_id);
CREATE INDEX IF NOT EXISTS receipts_issued_at_idx ON public.receipts (issued_at DESC);

COMMENT ON TABLE public.receipts IS
  'Numbered receipts, one per payment, issued and voided by triggers on payments. A snapshot of '
  'what was handed to the family; never edited or deleted by a client.';

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipts read" ON public.receipts;
CREATE POLICY "receipts read" ON public.receipts FOR SELECT TO authenticated
  USING (private.is_admin() OR student_id = auth.uid());
REVOKE ALL ON public.receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipts TO authenticated;

-- ------------------------------------------------------------------ issue / void

CREATE OR REPLACE FUNCTION private.issue_receipt(p_payment uuid, p_replaces uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _student uuid;
BEGIN
  INSERT INTO public.receipts (number, payment_id, registration_id, student_id, student_name,
                               group_name, program_name, amount_dzd, paid_on, method, reference, issued_by)
  SELECT private.next_document_number('receipt', 'REC'), p.id, p.registration_id, r.student_id,
         pr.full_name, g.name, pg.name, p.amount_dzd, p.paid_on, p.method, p.reference,
         coalesce(auth.uid(), p.recorded_by)
    FROM public.payments p
    JOIN public.registrations r ON r.id = p.registration_id
    LEFT JOIN public.profiles pr ON pr.id = r.student_id
    LEFT JOIN public.groups g ON g.id = r.group_id
    LEFT JOIN public.programs pg ON pg.id = g.program_id
   WHERE p.id = p_payment
  RETURNING id, student_id INTO _id, _student;

  IF p_replaces IS NOT NULL THEN
    UPDATE public.receipts SET replaced_by = _id WHERE id = p_replaces;
  END IF;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  SELECT 'receipt_issued', auth.uid(), (SELECT email FROM public.profiles WHERE id = auth.uid()),
         _student, (SELECT email FROM public.profiles WHERE id = _student),
         jsonb_build_object('receipt_id', _id, 'number', rc.number, 'payment_id', p_payment,
                            'amount_dzd', rc.amount_dzd, 'replaces', p_replaces)
    FROM public.receipts rc WHERE rc.id = _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION private.issue_receipt(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Voids the payment's issued receipt, if any; returns its id.
CREATE OR REPLACE FUNCTION private.void_receipt(p_payment uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _r public.receipts;
BEGIN
  UPDATE public.receipts SET status = 'voided', voided_at = now(), void_reason = p_reason
   WHERE payment_id = p_payment AND status = 'issued'
  RETURNING * INTO _r;
  IF _r.id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES ('receipt_voided', auth.uid(), (SELECT email FROM public.profiles WHERE id = auth.uid()),
          _r.student_id, (SELECT email FROM public.profiles WHERE id = _r.student_id),
          jsonb_build_object('receipt_id', _r.id, 'number', _r.number, 'payment_id', p_payment,
                             'reason', p_reason));
  RETURN _r.id;
END;
$$;

REVOKE ALL ON FUNCTION private.void_receipt(uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ triggers on payments

CREATE OR REPLACE FUNCTION public.receipt_on_payment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM private.issue_receipt(NEW.id, NULL);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.receipt_on_payment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _old uuid;
BEGIN
  IF (OLD.amount_dzd, OLD.paid_on, OLD.method, OLD.reference)
     IS NOT DISTINCT FROM (NEW.amount_dzd, NEW.paid_on, NEW.method, NEW.reference) THEN
    RETURN NULL; -- a note change does not change what the receipt says
  END IF;
  _old := private.void_receipt(NEW.id, 'Paiement modifié');
  PERFORM private.issue_receipt(NEW.id, _old);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.receipt_on_payment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM private.void_receipt(OLD.id, 'Paiement supprimé');
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.receipt_on_payment_insert(), public.receipt_on_payment_update(),
  public.receipt_on_payment_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_payments_receipt_issue ON public.payments;
CREATE TRIGGER t_payments_receipt_issue AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.receipt_on_payment_insert();

DROP TRIGGER IF EXISTS t_payments_receipt_update ON public.payments;
CREATE TRIGGER t_payments_receipt_update AFTER UPDATE OF amount_dzd, paid_on, method, reference ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.receipt_on_payment_update();

DROP TRIGGER IF EXISTS t_payments_receipt_void ON public.payments;
CREATE TRIGGER t_payments_receipt_void BEFORE DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.receipt_on_payment_delete();

-- ------------------------------------------------------------------ existing payments
-- One receipt each, in payment order. Payments themselves are not touched.
DO $$
DECLARE
  _p record;
BEGIN
  FOR _p IN SELECT p.id FROM public.payments p
             WHERE NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.payment_id = p.id)
             ORDER BY p.paid_on, p.created_at LOOP
    PERFORM private.issue_receipt(_p.id, NULL);
  END LOOP;
END $$;

-- ------------------------------------------------------------------ post-conditions
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.receipts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.receipts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.receipts', 'DELETE')
     OR has_table_privilege('anon', 'public.receipts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.document_sequences', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY: receipts or document_sequences are writable or readable by clients';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p
              WHERE NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.payment_id = p.id AND r.status = 'issued')) THEN
    RAISE EXCEPTION 'a payment has no receipt';
  END IF;
  RAISE NOTICE 'Receipts installed.';
END $$;
