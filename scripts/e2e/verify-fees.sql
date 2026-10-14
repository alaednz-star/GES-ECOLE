-- ==================================================================
-- Fees and installments (20261006100100_fees_installments.sql) -- security, integrity, the
-- enrollment relationship, the schedule and the audit trail, against the LOCAL database,
-- inside ONE transaction that is always ROLLED BACK.
--
-- Roles are simulated as PostgREST does: SET ROLE authenticated / anon + request.jwt.claims.
-- Runs inside the local DB container (no host port needed):
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-fees.sql
-- ==================================================================

\set QUIET on
BEGIN;

CREATE TEMP TABLE results (n serial, name text, ok boolean, detail text);
GRANT ALL ON results TO PUBLIC;
GRANT ALL ON SEQUENCE results_n_seq TO PUBLIC;

-- Named ids produced along the way (charges created by the administrator).
CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON ids TO PUBLIC;

-- Runs a statement as the CURRENT role and records whether it failed with the expected SQLSTATE.
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

CREATE TEMP TABLE ctx AS
  SELECT (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1) AS admin_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' LIMIT 1) AS teacher_id,
         gen_random_uuid() AS student_a,
         gen_random_uuid() AS student_b,
         gen_random_uuid() AS program_id,
         gen_random_uuid() AS group_id,
         gen_random_uuid() AS group2_id,
         gen_random_uuid() AS reg_a,
         gen_random_uuid() AS reg_b,
         gen_random_uuid() AS reg_pending,
         gen_random_uuid() AS reg_rejected;
GRANT SELECT ON ctx TO PUBLIC;

-- Fixtures (rolled back): a formation with two groups taught by the teacher, two students created
-- like any account (handle_new_user), approved enrollments for both, a pending and a refused one.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT student_a, 'e2e-fixture-fee-a-' || student_a || '@example.test', '{"full_name":"e2e-fixture Fee A"}'::jsonb FROM ctx
UNION ALL
SELECT student_b, 'e2e-fixture-fee-b-' || student_b || '@example.test', '{"full_name":"e2e-fixture Fee B"}'::jsonb FROM ctx;
INSERT INTO public.programs (id, name, category, status)
SELECT program_id, 'e2e-fixture FEE Anglais', 'language', 'active' FROM ctx;
INSERT INTO public.groups (id, name, program_id, max_students, teacher_id)
SELECT group_id, 'e2e-fixture FEE Groupe 1', program_id, 10, teacher_id FROM ctx
UNION ALL SELECT group2_id, 'e2e-fixture FEE Groupe 2', program_id, 10, teacher_id FROM ctx;
INSERT INTO public.registrations (id, student_id, group_id, status, decided_at)
SELECT reg_a, student_a, group_id, 'approved'::public.registration_status, now() FROM ctx
UNION ALL SELECT reg_b, student_b, group_id, 'approved', now() FROM ctx
UNION ALL SELECT reg_pending, student_a, group2_id, 'pending', NULL FROM ctx
UNION ALL SELECT reg_rejected, student_b, group2_id, 'rejected', now() FROM ctx;

/* ------------------------------------------------------------------ structure */
DO $$
BEGIN
  INSERT INTO results (name, ok, detail) SELECT
    'eight built-in fee types, all active',
    count(*) FILTER (WHERE built_in AND status = 'active') = 8
      AND bool_and(code IN ('registration','tuition','materials','exam','insurance','transport','canteen','other'))
        FILTER (WHERE built_in),
    count(*)::text FROM public.fee_types;
  INSERT INTO results (name, ok, detail) SELECT
    'a charge is RESTRICT-bound to its enrollment (never cascades away)',
    (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.charges'::regclass
        AND confrelid = 'public.registrations'::regclass) = 'r', '';
  INSERT INTO results (name, ok, detail) SELECT
    'clients hold no write privilege on charges or installments',
    NOT has_table_privilege('authenticated', 'public.charges', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.charges', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.charges', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.charge_installments', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.charge_installments', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.charge_installments', 'DELETE'), '';
END $$;

/* ------------------------------------------------------------------ administrator: create */
DO $$
DECLARE
  c ctx;
  _id uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  _id := public.save_charge(NULL, c.reg_a, 'registration', NULL, 3000, NULL,
                            '[{"due_on":"2026-09-15","amount_dzd":3000}]');
  INSERT INTO ids VALUES ('single', _id);
  INSERT INTO results (name, ok, detail) SELECT
    'an administrator adds a one-installment fee to an approved enrollment',
    ch.status = 'active' AND ch.amount_dzd = 3000 AND ch.created_by = c.admin_id
      AND (SELECT count(*) FROM public.charge_installments i WHERE i.charge_id = _id) = 1,
    ch.status FROM public.charges ch WHERE ch.id = _id;

  _id := public.save_charge(NULL, c.reg_a, 'tuition', NULL, 30000, 'Trimestre 1',
           '[{"due_on":"2026-10-01","amount_dzd":10000},{"due_on":"2026-11-01","amount_dzd":10000},{"due_on":"2026-12-01","amount_dzd":10000}]');
  INSERT INTO ids VALUES ('tuition', _id);
  INSERT INTO results (name, ok, detail) SELECT
    'a fee split in three installments is numbered 1..3 in due-date order',
    array_agg(position ORDER BY due_on) = ARRAY[1,2,3]::smallint[] AND sum(amount_dzd) = 30000,
    array_agg(position ORDER BY due_on)::text FROM public.charge_installments WHERE charge_id = _id;

  _id := public.save_charge(NULL, c.reg_b, 'materials', 'Livres', 2500, NULL,
                            '[{"due_on":"2026-09-20","amount_dzd":2500}]');
  INSERT INTO ids VALUES ('other_student', _id);

  -- Integrity: every refusal is a check_violation (23514) and creates nothing.
  PERFORM pg_temp.expect('installments that do not add up are refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 5000, NULL,
      '[{"due_on":"2026-10-01","amount_dzd":2000},{"due_on":"2026-11-01","amount_dzd":2000}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('a zero amount is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 0, NULL, '[{"due_on":"2026-10-01","amount_dzd":0}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('a negative amount is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, -500, NULL, '[{"due_on":"2026-10-01","amount_dzd":-500}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('a negative installment is refused even when the total matches',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL,
      '[{"due_on":"2026-10-01","amount_dzd":1500},{"due_on":"2026-11-01","amount_dzd":-500}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('a decimal installment amount is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":999.5}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('an impossible date (2026-02-30) is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-02-30","amount_dzd":1000}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('a due date outside 2000-2100 is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"1999-12-31","amount_dzd":1000}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('two installments on the same day are refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 2000, NULL,
      '[{"due_on":"2026-10-01","amount_dzd":1000},{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('installments out of date order are refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 2000, NULL,
      '[{"due_on":"2026-11-01","amount_dzd":1000},{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('a fee without installments is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('more than 24 installments are refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 25, NULL, %L)$q$, c.reg_a,
      (SELECT jsonb_agg(jsonb_build_object('due_on', DATE '2026-01-01' + g * 7, 'amount_dzd', 1))
         FROM generate_series(1, 25) g)), '23514');
  PERFORM pg_temp.expect('a fee of type "other" without a label is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'other', '   ', 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('an unknown fee type is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'gym', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('the same active fee twice on one enrollment is a duplicate',
    format($q$SELECT public.save_charge(NULL, %L, 'registration', NULL, 3000, NULL, '[{"due_on":"2026-09-15","amount_dzd":3000}]')$q$, c.reg_a), '23505');
  PERFORM pg_temp.expect('a pending enrollment cannot carry a fee',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_pending), '23514');
  PERFORM pg_temp.expect('a refused enrollment cannot carry a fee',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_rejected), '23514');
  PERFORM pg_temp.expect('a fee on an enrollment that does not exist is refused',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, gen_random_uuid()), '23514');

  INSERT INTO results (name, ok, detail) SELECT
    'the refused attempts created nothing', count(*) = 3, count(*)::text
    FROM public.charges WHERE registration_id IN (c.reg_a, c.reg_b, c.reg_pending, c.reg_rejected);

  -- Two "materials" fees with different labels are two obligations, not a duplicate.
  _id := public.save_charge(NULL, c.reg_a, 'materials', 'Blouse', 1200, NULL, '[{"due_on":"2026-09-20","amount_dzd":1200}]');
  _id := public.save_charge(NULL, c.reg_a, 'materials', 'Livres', 2500, NULL, '[{"due_on":"2026-09-20","amount_dzd":2500}]');
  INSERT INTO ids VALUES ('books', _id);
  INSERT INTO results (name, ok, detail) SELECT
    'the same fee type with different labels is allowed', count(*) = 2, count(*)::text
    FROM public.charges WHERE registration_id = c.reg_a AND fee_type = 'materials';

  -- Direct table writes are refused even to an administrator: the functions are the only path.
  PERFORM pg_temp.expect('an administrator cannot insert a charge directly',
    format($q$INSERT INTO public.charges (registration_id, fee_type, amount_dzd) VALUES (%L, 'exam', 100)$q$, c.reg_a), '42501');
  PERFORM pg_temp.expect('an administrator cannot update a charge directly',
    format($q$UPDATE public.charges SET amount_dzd = 1 WHERE id = %L$q$, (SELECT id FROM ids WHERE name = 'single')), '42501');
  PERFORM pg_temp.expect('an administrator cannot delete a charge (cancel instead)',
    format($q$DELETE FROM public.charges WHERE id = %L$q$, (SELECT id FROM ids WHERE name = 'single')), '42501');
  PERFORM pg_temp.expect('an administrator cannot delete an installment directly',
    format($q$DELETE FROM public.charge_installments WHERE charge_id = %L$q$, (SELECT id FROM ids WHERE name = 'tuition')), '42501');
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ administrator: edit, cancel */
DO $$
DECLARE
  c ctx;
  _tuition uuid := (SELECT id FROM ids WHERE name = 'tuition');
  _books   uuid := (SELECT id FROM ids WHERE name = 'books');
  _audits  int;
  _id      uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Rescheduled from 3 x 10 000 to 2 installments of a reduced total.
  PERFORM public.save_charge(_tuition, NULL, 'tuition', NULL, 24000, 'Trimestre 1 (remise fratrie)',
    '[{"due_on":"2026-10-01","amount_dzd":12000},{"due_on":"2026-12-01","amount_dzd":12000}]');
  INSERT INTO results (name, ok, detail) SELECT
    'an administrator reschedules a fee (amount and installments replaced together)',
    ch.amount_dzd = 24000 AND (SELECT count(*) FROM public.charge_installments i WHERE i.charge_id = _tuition) = 2,
    ch.amount_dzd::text FROM public.charges ch WHERE ch.id = _tuition;

  PERFORM pg_temp.expect('an edit whose installments do not add up is refused (the old schedule stays)',
    format($q$SELECT public.save_charge(%L, NULL, 'tuition', NULL, 24000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, _tuition), '23514');
  INSERT INTO results (name, ok, detail) SELECT
    'after the refused edit the schedule is intact', sum(amount_dzd) = 24000 AND count(*) = 2, sum(amount_dzd)::text
    FROM public.charge_installments WHERE charge_id = _tuition;

  PERFORM pg_temp.expect('a fee cannot be moved to another enrollment',
    format($q$SELECT public.save_charge(%L, %L, 'tuition', NULL, 24000, NULL,
      '[{"due_on":"2026-10-01","amount_dzd":12000},{"due_on":"2026-12-01","amount_dzd":12000}]')$q$, _tuition, c.reg_b), '23514');

  -- Saving the same values again is not a change and is not logged.
  PERFORM public.save_charge(_tuition, NULL, 'tuition', NULL, 24000, 'Trimestre 1 (remise fratrie)',
    '[{"due_on":"2026-10-01","amount_dzd":12000},{"due_on":"2026-12-01","amount_dzd":12000}]');

  PERFORM pg_temp.expect('cancelling needs a reason',
    format($q$SELECT public.cancel_charge(%L, '  ')$q$, _books), '23514');
  PERFORM public.cancel_charge(_books, 'Livres fournis par la famille');
  INSERT INTO results (name, ok, detail) SELECT
    'an administrator cancels a fee: kept, with who, when and why',
    status = 'cancelled' AND cancelled_by = c.admin_id AND cancelled_at IS NOT NULL
      AND cancel_reason = 'Livres fournis par la famille'
      AND (SELECT count(*) FROM public.charge_installments i WHERE i.charge_id = _books) = 1,
    status FROM public.charges WHERE id = _books;
  PERFORM pg_temp.expect('a cancelled fee cannot be cancelled again',
    format($q$SELECT public.cancel_charge(%L, 'encore')$q$, _books), '23514');
  PERFORM pg_temp.expect('a cancelled fee cannot be edited',
    format($q$SELECT public.save_charge(%L, NULL, 'materials', 'Livres', 2500, NULL, '[{"due_on":"2026-09-20","amount_dzd":2500}]')$q$, _books), '23514');

  _id := public.save_charge(NULL, c.reg_a, 'materials', 'Livres', 2000, NULL, '[{"due_on":"2026-09-25","amount_dzd":2000}]');
  INSERT INTO results (name, ok, detail) SELECT
    'after a cancellation the corrected fee can be entered', _id IS NOT NULL, '';

  -- The enrollment relationship: a payment is still money received, never a fee, and the
  -- enrollment that carries fees cannot be deleted.
  INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
  VALUES (c.reg_a, 5000, current_date, 'cash', c.admin_id);
  INSERT INTO results (name, ok, detail) SELECT
    'recording a payment leaves the fees untouched (payment is not a fee)',
    (SELECT count(*) FROM public.charges WHERE registration_id = c.reg_a) = 5
      AND (SELECT sum(amount_dzd) FROM public.charges WHERE registration_id = c.reg_a AND status = 'active') = 30200,
    (SELECT sum(amount_dzd) FROM public.charges WHERE registration_id = c.reg_a AND status = 'active')::text;
END $$;
RESET ROLE;

DO $$
DECLARE
  c ctx;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM pg_temp.expect('an enrollment carrying fees cannot be deleted (RESTRICT)',
    format($q$DELETE FROM public.registrations WHERE id = %L$q$, c.reg_b), '23503');
  PERFORM pg_temp.expect('a group whose enrollments carry fees cannot be deleted',
    format($q$DELETE FROM public.groups WHERE id = %L$q$, c.group_id), '23503');

  -- Withdrawal keeps the obligation: the administration decides whether to cancel it.
  UPDATE public.registrations SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = c.admin_id,
         withdrawal_reason = 'Déménagement'
   WHERE id = c.reg_b;
  INSERT INTO results (name, ok, detail) SELECT
    'withdrawing an enrollment keeps its fees (history is never erased)',
    (SELECT status FROM public.registrations WHERE id = c.reg_b) = 'withdrawn'
      AND (SELECT count(*) FROM public.charges WHERE registration_id = c.reg_b AND status = 'active') = 1, '';
  PERFORM pg_temp.expect('a withdrawn enrollment cannot receive a new fee',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_b), '23514');
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ audit */
DO $$
DECLARE
  c ctx;
  _tuition uuid := (SELECT id FROM ids WHERE name = 'tuition');
  _books   uuid := (SELECT id FROM ids WHERE name = 'books');
BEGIN
  SELECT * INTO c FROM ctx;
  INSERT INTO results (name, ok, detail) SELECT
    'creating a fee is audited (actor, student as target, the schedule)',
    count(*) = 1 AND bool_and(actor_id = c.admin_id AND target_id = c.student_a
                              AND jsonb_array_length(details -> 'charge' -> 'installments') = 1),
    count(*)::text
    FROM public.audit_log WHERE action = 'charge_created' AND details ->> 'charge_id' = (SELECT id FROM ids WHERE name = 'single')::text;
  INSERT INTO results (name, ok, detail) SELECT
    'a change is audited once with before/after; an identical save is not logged',
    count(*) = 1 AND bool_and((details -> 'before' ->> 'amount_dzd')::int = 30000
                              AND (details -> 'after' ->> 'amount_dzd')::int = 24000),
    count(*)::text
    FROM public.audit_log WHERE action = 'charge_updated' AND details ->> 'charge_id' = _tuition::text;
  INSERT INTO results (name, ok, detail) SELECT
    'a cancellation is audited with its reason',
    count(*) = 1 AND bool_and(details ->> 'reason' = 'Livres fournis par la famille'), count(*)::text
    FROM public.audit_log WHERE action = 'charge_cancelled' AND details ->> 'charge_id' = _books::text;
END $$;

/* ------------------------------------------------------------------ anonymous, teacher, students */
DO $$
DECLARE
  c ctx;
  who record;
  n int;
  _ok boolean;
BEGIN
  SELECT * INTO c FROM ctx;

  PERFORM set_config('role', 'anon', true);
  PERFORM pg_temp.expect('anonymous visitors cannot read fees', 'SELECT count(*) FROM public.charges', '42501');
  PERFORM pg_temp.expect('anonymous visitors cannot read fee types', 'SELECT count(*) FROM public.fee_types', '42501');
  PERFORM pg_temp.expect('anonymous visitors cannot call save_charge',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_a), '42501');
  PERFORM set_config('role', 'postgres', true);

  -- The teacher TEACHES both students' group and still sees no money.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.teacher_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.charges WHERE registration_id IN (c.reg_a, c.reg_b);
  INSERT INTO results VALUES (DEFAULT, 'the teacher of the group sees none of its fees', n = 0, n::text);
  SELECT count(*) INTO n FROM public.charge_installments i
    JOIN (SELECT id FROM ids) x ON x.id = i.charge_id;
  INSERT INTO results VALUES (DEFAULT, 'the teacher sees no installment', n = 0, n::text);
  PERFORM pg_temp.expect('a teacher cannot add a fee',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_a), '42501');
  PERFORM pg_temp.expect('a teacher cannot cancel a fee',
    format($q$SELECT public.cancel_charge(%L, 'x')$q$, (SELECT id FROM ids WHERE name = 'single')), '42501');
  PERFORM set_config('role', 'postgres', true);

  -- Student A: their own fees only.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.student_a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.charges WHERE registration_id = c.reg_a;
  INSERT INTO results VALUES (DEFAULT, 'a student reads the fees of their own enrollment', n = 5, n::text);
  SELECT count(*) INTO n FROM public.charge_installments i JOIN public.charges ch ON ch.id = i.charge_id
   WHERE ch.registration_id = c.reg_a;
  INSERT INTO results VALUES (DEFAULT, 'a student reads their own installments', n = 6, n::text);
  SELECT count(*) INTO n FROM public.charges WHERE registration_id = c.reg_b;
  INSERT INTO results VALUES (DEFAULT, 'a student cannot see another student''s fees', n = 0, n::text);
  SELECT count(*) INTO n FROM public.charge_installments WHERE charge_id = (SELECT id FROM ids WHERE name = 'other_student');
  INSERT INTO results VALUES (DEFAULT, 'a student cannot see another student''s installments', n = 0, n::text);
  PERFORM pg_temp.expect('a student cannot add a fee, even to their own enrollment',
    format($q$SELECT public.save_charge(NULL, %L, 'exam', NULL, 1000, NULL, '[{"due_on":"2026-10-01","amount_dzd":1000}]')$q$, c.reg_a), '42501');
  PERFORM pg_temp.expect('a student cannot reduce their own fee',
    format($q$SELECT public.save_charge(%L, NULL, 'registration', NULL, 1, NULL, '[{"due_on":"2026-09-15","amount_dzd":1}]')$q$,
      (SELECT id FROM ids WHERE name = 'single')), '42501');
  PERFORM pg_temp.expect('a student cannot cancel their own fee',
    format($q$SELECT public.cancel_charge(%L, 'non')$q$, (SELECT id FROM ids WHERE name = 'single')), '42501');
  PERFORM pg_temp.expect('a student cannot update a fee directly',
    format($q$UPDATE public.charges SET amount_dzd = 1 WHERE id = %L$q$, (SELECT id FROM ids WHERE name = 'single')), '42501');
  PERFORM pg_temp.expect('a student cannot delete an installment directly',
    format($q$DELETE FROM public.charge_installments WHERE charge_id = %L$q$, (SELECT id FROM ids WHERE name = 'tuition')), '42501');
  PERFORM set_config('role', 'postgres', true);
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ invariants beyond the functions */
-- Even SQL run as the database owner (Studio, a script) cannot break a schedule or rewrite history.
DO $$
DECLARE
  c ctx;
  _single uuid := (SELECT id FROM ids WHERE name = 'single');
  _books  uuid := (SELECT id FROM ids WHERE name = 'books');
BEGIN
  SELECT * INTO c FROM ctx;
  BEGIN
    UPDATE public.charge_installments SET amount_dzd = amount_dzd + 1 WHERE charge_id = _single;
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO results (name, ok, detail) VALUES ('a schedule that no longer adds up is refused at commit', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (name, ok, detail) VALUES ('a schedule that no longer adds up is refused at commit', true, SQLERRM);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    INSERT INTO public.charges (registration_id, fee_type, amount_dzd) VALUES (c.reg_a, 'exam', 100);
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO results (name, ok, detail) VALUES ('a charge without installments is refused at commit', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (name, ok, detail) VALUES ('a charge without installments is refused at commit', true, SQLERRM);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    UPDATE public.charges SET registration_id = c.reg_b WHERE id = _single;
    INSERT INTO results (name, ok, detail) VALUES ('a charge never changes enrollment, whoever writes', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (name, ok, detail) VALUES ('a charge never changes enrollment, whoever writes', true, '23514');
  END;
  BEGIN
    UPDATE public.charge_installments SET due_on = due_on + 1 WHERE charge_id = _books;
    INSERT INTO results (name, ok, detail) VALUES ('the installments of a cancelled fee are frozen', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (name, ok, detail) VALUES ('the installments of a cancelled fee are frozen', true, '23514');
  END;
  BEGIN
    INSERT INTO public.charges (registration_id, fee_type, amount_dzd) VALUES (c.reg_a, 'exam', -1);
    INSERT INTO results (name, ok, detail) VALUES ('a negative charge is refused by the table itself', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results (name, ok, detail) VALUES ('a negative charge is refused by the table itself', true, '23514');
  END;
END $$;

\set QUIET off
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '  ' || name
       || CASE WHEN NOT ok AND detail <> '' THEN '  -> ' || detail ELSE '' END AS result
  FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE NOT ok) || ' FAILURES / ' || count(*) || ' checks' AS summary FROM results;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM results WHERE NOT ok) THEN
    RAISE EXCEPTION 'fees: some checks failed';
  END IF;
END $$;
ROLLBACK;
