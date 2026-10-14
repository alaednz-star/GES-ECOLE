-- ==================================================================
-- Finance management (ADR-006): discounts, receipts, invoices and report views, against the
-- LOCAL database, inside ONE transaction that is always ROLLED BACK.
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-finance.sql
-- ==================================================================

\set QUIET on
BEGIN;

CREATE TEMP TABLE results (n serial, name text, ok boolean, detail text);
GRANT ALL ON results TO PUBLIC;
GRANT ALL ON SEQUENCE results_n_seq TO PUBLIC;
CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON ids TO PUBLIC;

CREATE FUNCTION pg_temp.expect(p_name text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO results (name, ok, detail) VALUES (p_name, false, 'accepted');
  EXCEPTION WHEN others THEN
    INSERT INTO results (name, ok, detail) VALUES (p_name, SQLSTATE = p_code, SQLSTATE || ' ' || SQLERRM);
  END;
END $$;
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE TEMP TABLE ctx AS
  SELECT (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1) AS admin_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' LIMIT 1) AS teacher_id,
         gen_random_uuid() AS s_a, gen_random_uuid() AS s_b,
         gen_random_uuid() AS p_id, gen_random_uuid() AS g_id,
         gen_random_uuid() AS reg_a, gen_random_uuid() AS reg_b, gen_random_uuid() AS reg_empty,
         gen_random_uuid() AS g2_id;
GRANT SELECT ON ctx TO PUBLIC;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT u, 'e2e-fixture-fin-' || u || '@example.test', '{"full_name":"e2e-fixture FIN"}'::jsonb
  FROM ctx, unnest(ARRAY[s_a, s_b]) AS u;
INSERT INTO public.programs (id, name, category, status) SELECT p_id, 'e2e-fixture FIN Anglais', 'language', 'active' FROM ctx;
INSERT INTO public.groups (id, name, program_id, max_students, teacher_id)
SELECT g_id, 'e2e-fixture FIN Samedi', p_id, 10, teacher_id FROM ctx
UNION ALL SELECT g2_id, 'e2e-fixture FIN Mardi', p_id, 10, teacher_id FROM ctx;
INSERT INTO public.registrations (id, student_id, group_id, status, decided_at)
SELECT reg_a, s_a, g_id, 'approved'::public.registration_status, now() FROM ctx
UNION ALL SELECT reg_b, s_b, g_id, 'approved'::public.registration_status, now() FROM ctx
UNION ALL SELECT reg_empty, s_a, g2_id, 'approved'::public.registration_status, now() FROM ctx;

/* ------------------------------------------------------------------ discounts */
DO $$
DECLARE
  c ctx;
  _id uuid;
  _grant uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.admin_id);

  _id := public.save_charge(NULL, c.reg_a, 'tuition', NULL, 30000, NULL,
           '[{"due_on":"2026-10-01","amount_dzd":15000},{"due_on":"2026-11-01","amount_dzd":15000}]');
  INSERT INTO ids VALUES ('tuition_a', _id);
  _id := public.save_charge(NULL, c.reg_a, 'registration', NULL, 2000, NULL, '[{"due_on":"2026-10-01","amount_dzd":2000}]');
  INSERT INTO ids VALUES ('registration_a', _id);
  _id := public.save_charge(NULL, c.reg_b, 'tuition', NULL, 30000, NULL, '[{"due_on":"2026-10-01","amount_dzd":30000}]');
  INSERT INTO ids VALUES ('tuition_b', _id);

  _id := public.save_discount(NULL, 'e2e-fixture Fratrie', 'percent', 10, NULL, 'Deuxième enfant');
  INSERT INTO ids VALUES ('sibling', _id);
  _id := public.save_discount(NULL, 'e2e-fixture Fidélité', 'amount', 5000, 'tuition', NULL);
  INSERT INTO ids VALUES ('loyalty', _id);
  INSERT INTO results (name, ok, detail) SELECT 'an administrator builds a discount catalogue', count(*) = 2, count(*)::text
    FROM public.discounts WHERE name LIKE 'e2e-fixture%';

  PERFORM pg_temp.expect('a percentage above 100 is refused',
    $q$SELECT public.save_discount(NULL, 'x', 'percent', 120, NULL, NULL)$q$, '23514');
  PERFORM pg_temp.expect('a zero discount is refused',
    $q$SELECT public.save_discount(NULL, 'x', 'amount', 0, NULL, NULL)$q$, '23514');
  PERFORM pg_temp.expect('a discount needs a name',
    $q$SELECT public.save_discount(NULL, '  ', 'amount', 100, NULL, NULL)$q$, '23514');
  PERFORM pg_temp.expect('an active discount name is unique',
    $q$SELECT public.save_discount(NULL, 'e2e-fixture fratrie', 'percent', 5, NULL, NULL)$q$, '23505');

  _grant := public.grant_discount((SELECT id FROM ids WHERE name = 'tuition_a'), (SELECT id FROM ids WHERE name = 'sibling'), NULL, NULL, 'Frère inscrit');
  INSERT INTO ids VALUES ('grant_sibling', _grant);
  INSERT INTO results (name, ok, detail) SELECT
    'a percentage discount is computed on the fee and frozen (10 % of 30 000)',
    amount_dzd = 3000 AND label = 'e2e-fixture Fratrie' AND status = 'active', amount_dzd::text
    FROM public.charge_discounts WHERE id = _grant;

  -- Editing the catalogue changes no existing grant.
  PERFORM public.save_discount((SELECT id FROM ids WHERE name = 'sibling'), 'e2e-fixture Fratrie', 'percent', 20, NULL, NULL);
  INSERT INTO results (name, ok, detail) SELECT 'editing the catalogue leaves granted discounts as they were',
    amount_dzd = 3000, amount_dzd::text FROM public.charge_discounts WHERE id = _grant;

  PERFORM pg_temp.expect('the same discount cannot be granted twice on one fee',
    format($q$SELECT public.grant_discount(%L, %L, NULL, NULL, NULL)$q$,
      (SELECT id FROM ids WHERE name = 'tuition_a'), (SELECT id FROM ids WHERE name = 'sibling')), '23505');
  PERFORM pg_temp.expect('a discount limited to tuition does not apply to a registration fee',
    format($q$SELECT public.grant_discount(%L, %L, NULL, NULL, NULL)$q$,
      (SELECT id FROM ids WHERE name = 'registration_a'), (SELECT id FROM ids WHERE name = 'loyalty')), '23514');
  PERFORM pg_temp.expect('a one-off discount needs a label',
    format($q$SELECT public.grant_discount(%L, NULL, 1000, NULL, NULL)$q$, (SELECT id FROM ids WHERE name = 'tuition_a')), '23514');
  PERFORM pg_temp.expect('a one-off discount cannot exceed what is left on the fee',
    format($q$SELECT public.grant_discount(%L, NULL, 28000, 'Geste', NULL)$q$, (SELECT id FROM ids WHERE name = 'tuition_a')), '23514');

  _grant := public.grant_discount((SELECT id FROM ids WHERE name = 'tuition_a'), NULL, 27000, 'Bourse', 'Bourse sociale');
  INSERT INTO ids VALUES ('grant_full', _grant);
  INSERT INTO results (name, ok, detail) SELECT 'discounts may cover the whole fee, never more',
    sum(amount_dzd) = 30000, sum(amount_dzd)::text
    FROM public.charge_discounts WHERE charge_id = (SELECT id FROM ids WHERE name = 'tuition_a') AND status = 'active';
  PERFORM pg_temp.expect('nothing is left to discount on a fully waived fee',
    format($q$SELECT public.grant_discount(%L, %L, NULL, NULL, NULL)$q$,
      (SELECT id FROM ids WHERE name = 'tuition_a'), (SELECT id FROM ids WHERE name = 'loyalty')), '23514');

  -- A charge cannot be edited below what is waived on it (deferred check).
  BEGIN
    PERFORM public.save_charge((SELECT id FROM ids WHERE name = 'tuition_a'), NULL, 'tuition', NULL, 20000, NULL,
      '[{"due_on":"2026-10-01","amount_dzd":20000}]');
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO results (name, ok, detail) VALUES ('a fee cannot be reduced below its discounts', false, 'accepted');
  EXCEPTION WHEN others THEN
    -- Refused for the right reason (the discounts check), not by any other error.
    INSERT INTO results (name, ok, detail) VALUES ('a fee cannot be reduced below its discounts',
      SQLSTATE = '23514' AND SQLERRM LIKE '%discounts on this fee%', SQLSTATE || ' ' || SQLERRM);
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- Editing a discounted fee is fine as long as it stays above its discounts.
  PERFORM public.save_charge((SELECT id FROM ids WHERE name = 'tuition_a'), NULL, 'tuition', NULL, 31000, NULL,
    '[{"due_on":"2026-10-01","amount_dzd":16000},{"due_on":"2026-11-01","amount_dzd":15000}]');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO results (name, ok, detail) SELECT 'a discounted fee can still be edited above its discounts',
    amount_dzd = 31000, amount_dzd::text FROM public.charges WHERE id = (SELECT id FROM ids WHERE name = 'tuition_a');
  PERFORM public.save_charge((SELECT id FROM ids WHERE name = 'tuition_a'), NULL, 'tuition', NULL, 30000, NULL,
    '[{"due_on":"2026-10-01","amount_dzd":15000},{"due_on":"2026-11-01","amount_dzd":15000}]');

  PERFORM pg_temp.expect('cancelling a discount needs a reason',
    format($q$SELECT public.cancel_discount(%L, ' ')$q$, _grant), '23514');
  PERFORM public.cancel_discount(_grant, 'Bourse refusée');
  INSERT INTO results (name, ok, detail) SELECT 'a cancelled discount is kept, with who, when and why',
    status = 'cancelled' AND cancelled_by = c.admin_id AND cancel_reason = 'Bourse refusée', status
    FROM public.charge_discounts WHERE id = _grant;
  PERFORM pg_temp.expect('a cancelled discount cannot be cancelled again',
    format($q$SELECT public.cancel_discount(%L, 'encore')$q$, _grant), '23514');

  PERFORM public.cancel_charge((SELECT id FROM ids WHERE name = 'registration_a'), 'Offert');
  PERFORM pg_temp.expect('a cancelled fee cannot receive a discount',
    format($q$SELECT public.grant_discount(%L, NULL, 100, 'x', NULL)$q$, (SELECT id FROM ids WHERE name = 'registration_a')), '23514');
  PERFORM pg_temp.expect('clients cannot write discounts directly',
    format($q$INSERT INTO public.charge_discounts (charge_id, label, amount_dzd) VALUES (%L, 'x', 1)$q$, (SELECT id FROM ids WHERE name = 'tuition_b')), '42501');

  INSERT INTO results (name, ok, detail) SELECT 'granting and cancelling are audited on the student',
    count(*) FILTER (WHERE action = 'discount_granted') = 2 AND count(*) FILTER (WHERE action = 'discount_cancelled') = 1
      AND bool_and(target_id = c.s_a), count(*)::text
    FROM public.audit_log WHERE action IN ('discount_granted', 'discount_cancelled')
     AND details ->> 'charge_id' = (SELECT id FROM ids WHERE name = 'tuition_a')::text;
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ receipts */
DO $$
DECLARE
  c ctx;
  _pay uuid;
  _pay2 uuid;
  _n1 text;
  _n2 text;
  _lost text;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.admin_id);

  INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, reference, recorded_by)
  VALUES (c.reg_b, 10000, current_date, 'cheque', 'CHQ-77', c.admin_id) RETURNING id INTO _pay;
  INSERT INTO ids VALUES ('pay_b', _pay);
  SELECT number INTO _n1 FROM public.receipts WHERE payment_id = _pay AND status = 'issued';
  INSERT INTO results (name, ok, detail) SELECT 'recording a payment issues a numbered receipt with its snapshot',
    r.number ~ ('^REC-' || extract(year FROM current_date) || '-[0-9]{6}$') AND r.amount_dzd = 10000
      AND r.method = 'cheque' AND r.reference = 'CHQ-77' AND r.student_id = c.s_b
      AND r.group_name = 'e2e-fixture FIN Samedi' AND r.program_name = 'e2e-fixture FIN Anglais',
    r.number FROM public.receipts r WHERE r.payment_id = _pay;

  -- A payment that is rolled back does not consume a number.
  BEGIN
    INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
    VALUES (c.reg_b, 1000, current_date, 'cash', c.admin_id);
    SELECT max(number) INTO _lost FROM public.receipts;
    RAISE EXCEPTION 'rollback';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
  VALUES (c.reg_b, 5000, current_date, 'cash', c.admin_id) RETURNING id INTO _pay2;
  SELECT number INTO _n2 FROM public.receipts WHERE payment_id = _pay2;
  INSERT INTO results (name, ok, detail) SELECT 'numbers follow one another; a rolled-back payment consumes none',
    right(_n2, 6)::int = right(_n1, 6)::int + 1 AND _n2 = _lost, _n1 || ' -> ' || _n2 || ' (lost ' || _lost || ')';

  UPDATE public.payments SET note = 'Remis par la mère' WHERE id = _pay;
  INSERT INTO results (name, ok, detail) SELECT 'a note change keeps the receipt', count(*) = 1, count(*)::text
    FROM public.receipts WHERE payment_id = _pay;

  UPDATE public.payments SET amount_dzd = 12000 WHERE id = _pay;
  INSERT INTO results (name, ok, detail) SELECT
    'correcting the amount voids the receipt and issues a new number for the corrected payment',
    (SELECT count(*) FROM public.receipts WHERE payment_id = _pay AND status = 'voided' AND void_reason = 'Paiement modifié'
                                           AND replaced_by IS NOT NULL) = 1
      AND (SELECT amount_dzd FROM public.receipts WHERE payment_id = _pay AND status = 'issued') = 12000, '';

  DELETE FROM public.payments WHERE id = _pay2;
  INSERT INTO results (name, ok, detail) SELECT 'deleting a payment voids its receipt and keeps it readable',
    status = 'voided' AND payment_id IS NULL AND void_reason = 'Paiement supprimé' AND amount_dzd = 5000, status
    FROM public.receipts WHERE number = _n2;

  PERFORM pg_temp.expect('clients cannot write receipts',
    $q$UPDATE public.receipts SET amount_dzd = 1$q$, '42501');
  PERFORM pg_temp.expect('clients cannot touch the number counters',
    $q$SELECT * FROM public.document_sequences$q$, '42501');
  INSERT INTO results (name, ok, detail) SELECT 'every payment has exactly one issued receipt',
    NOT EXISTS (SELECT 1 FROM public.payments p WHERE (SELECT count(*) FROM public.receipts r
                  WHERE r.payment_id = p.id AND r.status = 'issued') <> 1), '';
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ invoices */
DO $$
DECLARE
  c ctx;
  _inv uuid;
  _before text;
BEGIN
  SELECT * INTO c FROM ctx;
  UPDATE public.center_settings SET nif = '000116001234567', legal_name = 'SARL e2e-fixture';
  PERFORM pg_temp.as_user(c.admin_id);

  SELECT (SELECT count(*) FROM public.charges WHERE registration_id = c.reg_a)::text || '/' ||
         (SELECT count(*) FROM public.payments)::text INTO _before;

  INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
  VALUES (c.reg_a, 0 + 1000, current_date, 'cash', c.admin_id);
  SELECT (SELECT count(*) FROM public.charges WHERE registration_id = c.reg_a)::text || '/' ||
         (SELECT count(*) FROM public.payments)::text INTO _before;

  _inv := public.issue_invoice(c.reg_a);
  INSERT INTO ids VALUES ('inv_a', _inv);
  -- reg_a: tuition 30 000 active (registration cancelled), discount 3 000 active, 1 000 paid.
  INSERT INTO results (name, ok, detail) SELECT
    'an invoice snapshots the active fees, discounts, payments and balance',
    number ~ ('^FAC-' || extract(year FROM current_date) || '-[0-9]{6}$')
      AND jsonb_array_length(lines) = 1 AND total_dzd = 30000 AND discount_dzd = 3000
      AND paid_dzd = 1000 AND balance_dzd = 26000
      AND issuer ->> 'nif' = '000116001234567' AND student_id = c.s_a
      AND jsonb_array_length(lines -> 0 -> 'installments') = 2,
    number || ' ' || total_dzd || '/' || discount_dzd || '/' || paid_dzd || '/' || balance_dzd
    FROM public.invoices WHERE id = _inv;
  INSERT INTO results (name, ok, detail) SELECT 'issuing an invoice changes no fee and no payment',
    (SELECT count(*) FROM public.charges WHERE registration_id = c.reg_a)::text || '/' ||
    (SELECT count(*) FROM public.payments)::text = _before, _before;

  PERFORM pg_temp.expect('an enrollment without fees cannot be invoiced',
    format($q$SELECT public.issue_invoice(%L)$q$, c.reg_empty), '23514');
  PERFORM pg_temp.expect('voiding an invoice needs a reason',
    format($q$SELECT public.void_invoice(%L, '')$q$, _inv), '23514');
  PERFORM public.void_invoice(_inv, 'Erreur de montant');
  INSERT INTO results (name, ok, detail) SELECT 'a voided invoice is kept, with who, when and why',
    status = 'voided' AND voided_by = c.admin_id AND void_reason = 'Erreur de montant', status
    FROM public.invoices WHERE id = _inv;
  PERFORM pg_temp.expect('a voided invoice cannot be voided again',
    format($q$SELECT public.void_invoice(%L, 'x')$q$, _inv), '23514');
  _inv := public.issue_invoice(c.reg_a);
  INSERT INTO results (name, ok, detail) SELECT 'a new invoice can be issued after voiding, with a new number',
    (SELECT number FROM public.invoices WHERE id = _inv) <> (SELECT number FROM public.invoices WHERE id = (SELECT id FROM ids WHERE name = 'inv_a')), '';
  PERFORM pg_temp.expect('clients cannot write invoices',
    $q$UPDATE public.invoices SET total_dzd = 1$q$, '42501');
  INSERT INTO results (name, ok, detail) SELECT 'issuing and voiding are audited', count(*) = 3, count(*)::text
    FROM public.audit_log WHERE action IN ('invoice_issued', 'invoice_voided') AND target_id = c.s_a
     AND created_at >= now() - interval '1 minute';
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ reports */
DO $$
DECLARE
  c ctx;
  n int;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.admin_id);
  SELECT coalesce(sum(total_dzd), 0) INTO n FROM public.finance_payments_monthly WHERE program_id = c.p_id;
  INSERT INTO results VALUES (DEFAULT, 'the monthly payments report sums the formation''s payments', n = 13000, n::text);
  SELECT coalesce(sum(charged_dzd), 0) INTO n FROM public.finance_charges_monthly WHERE program_id = c.p_id;
  INSERT INTO results VALUES (DEFAULT, 'the monthly charges report sums active fees only', n = 60000, n::text);
  SELECT coalesce(sum(discounted_dzd), 0) INTO n FROM public.finance_charges_monthly WHERE program_id = c.p_id;
  INSERT INTO results VALUES (DEFAULT, 'the monthly charges report sums active discounts', n = 3000, n::text);
  PERFORM set_config('role', 'postgres', true);

  PERFORM pg_temp.as_user(c.teacher_id);
  SELECT count(*) INTO n FROM public.finance_payments_monthly WHERE program_id = c.p_id;
  INSERT INTO results VALUES (DEFAULT, 'the teacher of the group sees no financial report row', n = 0, n::text);
  SELECT count(*) INTO n FROM public.receipts WHERE student_id IN (c.s_a, c.s_b);
  INSERT INTO results VALUES (DEFAULT, 'the teacher sees no receipt', n = 0, n::text);
  SELECT count(*) INTO n FROM public.invoices WHERE student_id IN (c.s_a, c.s_b);
  INSERT INTO results VALUES (DEFAULT, 'the teacher sees no invoice', n = 0, n::text);
  SELECT count(*) INTO n FROM public.charge_discounts;
  INSERT INTO results VALUES (DEFAULT, 'the teacher sees no discount', n = 0, n::text);
  PERFORM pg_temp.expect('a teacher cannot grant a discount',
    format($q$SELECT public.grant_discount(%L, NULL, 100, 'x', NULL)$q$, (SELECT id FROM ids WHERE name = 'tuition_b')), '42501');
  PERFORM pg_temp.expect('a teacher cannot issue an invoice', format($q$SELECT public.issue_invoice(%L)$q$, c.reg_b), '42501');
  PERFORM set_config('role', 'postgres', true);

  PERFORM pg_temp.as_user(c.s_b);
  SELECT count(*) INTO n FROM public.receipts WHERE student_id = c.s_b;
  INSERT INTO results VALUES (DEFAULT, 'a student reads their own receipts', n >= 2, n::text);
  SELECT count(*) INTO n FROM public.receipts WHERE student_id <> c.s_b;
  INSERT INTO results VALUES (DEFAULT, 'a student reads no one else''s receipt', n = 0, n::text);
  SELECT count(*) INTO n FROM public.invoices WHERE student_id = c.s_a;
  INSERT INTO results VALUES (DEFAULT, 'a student reads no one else''s invoice', n = 0, n::text);
  SELECT count(*) INTO n FROM public.charge_discounts WHERE charge_id = (SELECT id FROM ids WHERE name = 'tuition_a');
  INSERT INTO results VALUES (DEFAULT, 'a student reads no one else''s discounts', n = 0, n::text);
  SELECT count(*) INTO n FROM public.discounts;
  INSERT INTO results VALUES (DEFAULT, 'the discount catalogue is for administrators only', n = 0, n::text);
  PERFORM pg_temp.expect('a student cannot grant themselves a discount',
    format($q$SELECT public.grant_discount(%L, NULL, 100, 'x', NULL)$q$, (SELECT id FROM ids WHERE name = 'tuition_b')), '42501');
  PERFORM set_config('role', 'postgres', true);

  PERFORM set_config('role', 'anon', true);
  PERFORM pg_temp.expect('anonymous visitors cannot read receipts', 'SELECT count(*) FROM public.receipts', '42501');
  PERFORM pg_temp.expect('anonymous visitors cannot read invoices', 'SELECT count(*) FROM public.invoices', '42501');
  PERFORM pg_temp.expect('anonymous visitors cannot read financial reports', 'SELECT count(*) FROM public.finance_payments_monthly', '42501');
  PERFORM set_config('role', 'postgres', true);
END $$;
RESET ROLE;

\set QUIET off
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '  ' || name
       || CASE WHEN NOT ok AND detail <> '' THEN '  -> ' || detail ELSE '' END AS result
  FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE NOT ok) || ' FAILURES / ' || count(*) || ' checks' AS summary FROM results;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM results WHERE NOT ok) THEN
    RAISE EXCEPTION 'finance: some checks failed';
  END IF;
END $$;
ROLLBACK;
