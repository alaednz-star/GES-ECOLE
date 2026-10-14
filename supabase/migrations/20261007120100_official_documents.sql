-- ==================================================================
-- Documents officiels: numbered certificates per enrollment (ADR-007).
--
-- Kinds (the three a centre is asked for most):
--   enrollment  « Attestation d'inscription »   the student is enrolled in this group / formation
--   attendance  « Attestation d'assiduité »     + sessions present / late / excused / absent, rate
--   payment     « Attestation de paiement »     + payments received on the enrollment
--
-- Like invoices (ADR-006), a document is a frozen SNAPSHOT (student identity, enrollment,
-- figures, issuer) numbered ATT-<year>-<000001> from document_sequences; never edited, voided
-- with a reason. Nothing it describes is changed.
--
-- SECURITY: admins read all, a student their own; writes only through issue_official_document /
-- void_official_document (SECURITY DEFINER, admin check, audited document_*).
--
-- ROLLBACK
--   DROP FUNCTION public.void_official_document(uuid, text), public.issue_official_document(text, uuid);
--   DROP TABLE public.official_documents;
--   (document_sequences keeps accepting 'certificate'; harmless)
-- ==================================================================

ALTER TABLE public.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_kind_check;
ALTER TABLE public.document_sequences
  ADD CONSTRAINT document_sequences_kind_check CHECK (kind IN ('receipt', 'invoice', 'certificate'));

CREATE TABLE IF NOT EXISTS public.official_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL UNIQUE,
  kind            text NOT NULL CHECK (kind IN ('enrollment', 'attendance', 'payment')),
  registration_id uuid REFERENCES public.registrations (id) ON DELETE SET NULL,
  student_id      uuid,
  student_name    text,
  snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,
  issuer          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'voided')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid DEFAULT auth.uid(),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,
  CONSTRAINT official_documents_void_consistent CHECK (
    CASE WHEN status = 'voided'
      THEN voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 300
      ELSE voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL
    END)
);

CREATE INDEX IF NOT EXISTS official_documents_student_idx ON public.official_documents (student_id);
CREATE INDEX IF NOT EXISTS official_documents_issued_at_idx ON public.official_documents (issued_at DESC);

COMMENT ON TABLE public.official_documents IS
  'Numbered certificates (enrollment, attendance, payment): frozen snapshots, voided with a reason, '
  'never edited. Written only by issue_official_document / void_official_document.';

ALTER TABLE public.official_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "official documents read" ON public.official_documents;
CREATE POLICY "official documents read" ON public.official_documents FOR SELECT TO authenticated
  USING (private.is_admin() OR student_id = auth.uid());
REVOKE ALL ON public.official_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.official_documents TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_official_document(p_kind text, p_registration uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reg     public.registrations;
  _snap    jsonb;
  _extra   jsonb := '{}'::jsonb;
  _number  text;
  _id      uuid;
  _name    text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can issue official documents.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_kind NOT IN ('enrollment', 'attendance', 'payment') THEN
    RAISE EXCEPTION 'Unknown document type.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _reg FROM public.registrations WHERE id = p_registration;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This enrollment does not exist.' USING ERRCODE = 'check_violation';
  END IF;
  IF _reg.status NOT IN ('approved', 'withdrawn') THEN
    RAISE EXCEPTION 'A document can only be issued for an enrollment that was accepted.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT jsonb_build_object(
           'student_name', pr.full_name, 'date_of_birth', st.date_of_birth, 'gender', st.gender,
           'group_name', g.name, 'program_name', pg.name, 'subject_name', sj.name, 'level_name', lv.name,
           'enrolled_on', coalesce(_reg.decided_at, _reg.created_at)::date,
           'withdrawn_on', _reg.withdrawn_at::date, 'registration_status', _reg.status,
           'academic_year', (SELECT academic_year FROM public.center_settings LIMIT 1),
           'start_date', g.start_date, 'end_date', g.end_date),
         pr.full_name
    INTO _snap, _name
    FROM public.registrations r
    LEFT JOIN public.profiles pr ON pr.id = r.student_id
    LEFT JOIN public.students st ON st.id = r.student_id
    LEFT JOIN public.groups g ON g.id = r.group_id
    LEFT JOIN public.programs pg ON pg.id = g.program_id
    LEFT JOIN public.subjects sj ON sj.id = g.subject_id
    LEFT JOIN public.levels lv ON lv.id = g.level_id
   WHERE r.id = p_registration;

  IF p_kind = 'attendance' THEN
    SELECT jsonb_build_object(
             'present', count(*) FILTER (WHERE a.status = 'present'),
             'late', count(*) FILTER (WHERE a.status = 'late'),
             'excused', count(*) FILTER (WHERE a.status = 'excused'),
             'absent', count(*) FILTER (WHERE a.status = 'absent'),
             'total', count(*),
             'first', min(a.session_date), 'last', max(a.session_date))
      INTO _extra
      FROM public.attendance a
     WHERE a.student_id = _reg.student_id AND a.group_id = _reg.group_id;
  ELSIF p_kind = 'payment' THEN
    SELECT jsonb_build_object(
             'total_dzd', coalesce(sum(p.amount_dzd), 0),
             'payments', coalesce(jsonb_agg(jsonb_build_object('paid_on', p.paid_on, 'amount_dzd', p.amount_dzd,
                                                               'method', p.method) ORDER BY p.paid_on), '[]'::jsonb))
      INTO _extra
      FROM public.payments p WHERE p.registration_id = p_registration;
    IF (_extra ->> 'total_dzd')::bigint = 0 THEN
      RAISE EXCEPTION 'No payment has been received on this enrollment.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  _number := private.next_document_number('certificate', 'ATT');
  INSERT INTO public.official_documents (number, kind, registration_id, student_id, student_name, snapshot, issuer, issued_by)
  VALUES (_number, p_kind, p_registration, _reg.student_id, _name, _snap || _extra,
          (SELECT jsonb_build_object('school_name', cs.school_name, 'legal_name', cs.legal_name,
                                     'address', cs.address, 'phone', cs.phone, 'logo_url', cs.logo_url,
                                     'nif', cs.nif, 'nis', cs.nis, 'rc', cs.rc, 'tax_article', cs.tax_article)
             FROM public.center_settings cs LIMIT 1),
          auth.uid())
  RETURNING id INTO _id;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES ('document_issued', auth.uid(), (SELECT email FROM public.profiles WHERE id = auth.uid()),
          _reg.student_id, (SELECT email FROM public.profiles WHERE id = _reg.student_id),
          jsonb_build_object('document_id', _id, 'number', _number, 'kind', p_kind, 'registration_id', p_registration));
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_official_document(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_official_document(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_official_document(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reason text := btrim(coalesce(p_reason, ''));
  _doc    public.official_documents;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can void official documents.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_reason) < 1 OR length(_reason) > 300 THEN
    RAISE EXCEPTION 'Voiding a document needs a reason (300 characters at most).' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _doc FROM public.official_documents WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _doc.status <> 'issued' THEN
    RAISE EXCEPTION 'This document is not active.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.official_documents
     SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = _reason
   WHERE id = p_id;
  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES ('document_voided', auth.uid(), (SELECT email FROM public.profiles WHERE id = auth.uid()),
          _doc.student_id, (SELECT email FROM public.profiles WHERE id = _doc.student_id),
          jsonb_build_object('document_id', p_id, 'number', _doc.number, 'reason', _reason));
END;
$$;

REVOKE ALL ON FUNCTION public.void_official_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_official_document(uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.official_documents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.official_documents', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.official_documents', 'DELETE')
     OR has_table_privilege('anon', 'public.official_documents', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY: official_documents writable or readable by the wrong roles';
  END IF;
  RAISE NOTICE 'Official documents installed.';
END $$;
