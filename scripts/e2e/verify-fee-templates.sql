-- ==================================================================
-- Fee templates (20261006110100_fee_templates.sql) -- formation defaults, group overrides, and
-- their materialisation into a student's real charges when an enrollment is approved, against
-- the LOCAL database, inside ONE transaction that is always ROLLED BACK.
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-fee-templates.sql
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

CREATE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1),
                      'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE TEMP TABLE ctx AS
  SELECT (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1) AS admin_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' LIMIT 1) AS teacher_id,
         gen_random_uuid() AS s_old, gen_random_uuid() AS s_new, gen_random_uuid() AS s_pend,
         gen_random_uuid() AS s_g2, gen_random_uuid() AS s_late, gen_random_uuid() AS s_none,
         gen_random_uuid() AS s_app, gen_random_uuid() AS s_fail,
         gen_random_uuid() AS p_id, gen_random_uuid() AS q_id, gen_random_uuid() AS r_id,
         gen_random_uuid() AS g1, gen_random_uuid() AS g2, gen_random_uuid() AS gq, gen_random_uuid() AS gr,
         gen_random_uuid() AS reg_old, gen_random_uuid() AS app_id;
GRANT SELECT ON ctx TO PUBLIC;

-- Fixtures (rolled back): formation P (groups G1, G2), formation Q (group GQ), formation R
-- without fees (group GR), students created like any account, and one enrollment that exists
-- BEFORE any template.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT u, 'e2e-fixture-tpl-' || u || '@example.test', '{"full_name":"e2e-fixture TPL"}'::jsonb
  FROM ctx, unnest(ARRAY[s_old, s_new, s_pend, s_g2, s_late, s_none, s_app, s_fail]) AS u;
INSERT INTO public.programs (id, name, category, status)
SELECT p_id, 'e2e-fixture TPL Anglais A2', 'language', 'active' FROM ctx
UNION ALL SELECT q_id, 'e2e-fixture TPL Autre', 'other', 'active' FROM ctx
UNION ALL SELECT r_id, 'e2e-fixture TPL Sans frais', 'workshop', 'active' FROM ctx;
INSERT INTO public.groups (id, name, program_id, max_students)
SELECT g1, 'e2e-fixture TPL Samedi', p_id, 10 FROM ctx
UNION ALL SELECT g2, 'e2e-fixture TPL Intensif', p_id, 10 FROM ctx
UNION ALL SELECT gq, 'e2e-fixture TPL Q', q_id, 10 FROM ctx
UNION ALL SELECT gr, 'e2e-fixture TPL R', r_id, 10 FROM ctx;
INSERT INTO public.registrations (id, student_id, group_id, status, decided_at)
SELECT reg_old, s_old, g1, 'approved'::public.registration_status, now() FROM ctx;

/* ------------------------------------------------------------------ structure */
DO $$
BEGIN
  INSERT INTO results (name, ok, detail) SELECT
    'clients hold no write privilege on fee templates; anonymous visitors cannot read them',
    NOT has_table_privilege('authenticated', 'public.fee_templates', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.fee_templates', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.fee_templates', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.fee_templates', 'SELECT'), '';
  INSERT INTO results (name, ok, detail) SELECT
    'a charge remembers the template it came from', EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'charges' AND column_name = 'template_id'), '';
  INSERT INTO results (name, ok, detail) SELECT
    'templates belong to formations, never to subjects', NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'fee_templates' AND column_name LIKE 'subject%'), '';
END $$;

/* ------------------------------------------------------------------ administrator: formation defaults */
DO $$
DECLARE
  c ctx;
  _id uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  _id := public.save_fee_template(NULL, c.p_id, NULL, 'tuition', NULL, 30000,
           '[{"months":0,"amount_dzd":10000},{"months":1,"amount_dzd":10000},{"months":2,"amount_dzd":10000}]');
  INSERT INTO ids VALUES ('tuition', _id);
  _id := public.save_fee_template(NULL, c.p_id, NULL, 'registration', NULL, 2000, '[{"months":0,"amount_dzd":2000}]');
  INSERT INTO ids VALUES ('registration', _id);
  INSERT INTO results (name, ok, detail) SELECT
    'an administrator gives a formation several default fees', count(*) = 2, count(*)::text
    FROM public.fee_templates WHERE program_id = c.p_id AND group_id IS NULL AND status = 'active';

  PERFORM pg_temp.expect('installments that do not add up are refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 5000, '[{"months":0,"amount_dzd":2000}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('installments out of order are refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 2000, '[{"months":2,"amount_dzd":1000},{"months":1,"amount_dzd":1000}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('two installments in the same month are refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 2000, '[{"months":1,"amount_dzd":1000},{"months":1,"amount_dzd":1000}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('a negative installment is refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 1000, '[{"months":0,"amount_dzd":1500},{"months":1,"amount_dzd":-500}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('a zero amount is refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 0, '[{"months":0,"amount_dzd":0}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('more than 24 installments are refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 25, %L)$q$, c.p_id,
      (SELECT jsonb_agg(jsonb_build_object('months', g, 'amount_dzd', 1)) FROM generate_series(0, 24) g)), '23514');
  PERFORM pg_temp.expect('an installment beyond 120 months is refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 1000, '[{"months":121,"amount_dzd":1000}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('a non-numeric schedule is refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 1000, '[{"months":"soon","amount_dzd":1000}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('an "other" fee without a label is refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'other', ' ', 1000, '[{"months":0,"amount_dzd":1000}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('an unknown fee type is refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'gym', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, c.p_id), '23514');
  PERFORM pg_temp.expect('the same default fee twice is a duplicate',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'tuition', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, c.p_id), '23505');
  PERFORM pg_temp.expect('a group of another formation cannot carry this formation''s fees',
    format($q$SELECT public.save_fee_template(NULL, %L, %L, 'exam', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, c.p_id, c.gq), '23514');
  PERFORM pg_temp.expect('a fee on a formation that does not exist is refused',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, gen_random_uuid()), '23514');
  PERFORM pg_temp.expect('an administrator cannot write fee templates directly',
    format($q$INSERT INTO public.fee_templates (program_id, fee_type, amount_dzd, schedule) VALUES (%L, 'exam', 1, '[{"months":0,"amount_dzd":1}]')$q$, c.p_id), '42501');

  INSERT INTO results (name, ok, detail) SELECT
    'creating a template is audited', count(*) = 2, count(*)::text
    FROM public.audit_log WHERE action = 'fee_template_created'
     AND details ->> 'template_id' IN (SELECT id::text FROM ids);
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ materialisation */
DO $$
DECLARE
  c ctx;
  _reg uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  INSERT INTO results (name, ok, detail) SELECT
    'an enrollment that existed before the template receives nothing', count(*) = 0, count(*)::text
    FROM public.charges WHERE registration_id = c.reg_old;

  -- Admin placement: an approved enrollment.
  INSERT INTO public.registrations (student_id, group_id, status, decided_at)
  VALUES (c.s_new, c.g1, 'approved', now()) RETURNING id INTO _reg;
  INSERT INTO ids VALUES ('reg_new', _reg);
  INSERT INTO results (name, ok, detail) SELECT
    'a new approved enrollment receives one charge per default fee, linked to its template',
    count(*) = 2 AND bool_and(template_id IS NOT NULL AND status = 'active')
      AND sum(amount_dzd) = 32000, count(*)::text || ' / ' || coalesce(sum(amount_dzd), 0)
    FROM public.charges WHERE registration_id = _reg;
  INSERT INTO results (name, ok, detail) SELECT
    'the installments follow the template: today, +1 month, +2 months',
    array_agg(i.due_on ORDER BY i.position) =
      ARRAY[current_date, (current_date + interval '1 month')::date, (current_date + interval '2 months')::date]
      AND array_agg(i.amount_dzd ORDER BY i.position) = ARRAY[10000, 10000, 10000],
    array_agg(i.due_on ORDER BY i.position)::text
    FROM public.charge_installments i JOIN public.charges ch ON ch.id = i.charge_id
   WHERE ch.registration_id = _reg AND ch.fee_type = 'tuition';

  -- A request is not a place: no fee until it is approved.
  INSERT INTO public.registrations (student_id, group_id, status)
  VALUES (c.s_pend, c.g1, 'pending') RETURNING id INTO _reg;
  INSERT INTO results (name, ok, detail) SELECT
    'a pending request receives no charge', count(*) = 0, count(*)::text
    FROM public.charges WHERE registration_id = _reg;
  UPDATE public.registrations SET status = 'approved', decided_at = now() WHERE id = _reg;
  INSERT INTO results (name, ok, detail) SELECT
    'approving the request creates its charges', count(*) = 2, count(*)::text
    FROM public.charges WHERE registration_id = _reg;

  -- A formation without fees: the enrollment works and owes nothing.
  INSERT INTO public.registrations (student_id, group_id, status, decided_at)
  VALUES (c.s_none, c.gr, 'approved', now()) RETURNING id INTO _reg;
  INSERT INTO results (name, ok, detail) SELECT
    'a formation without fees: the enrollment is created, with no invented charge',
    count(*) = 0 AND EXISTS (SELECT 1 FROM public.registrations WHERE id = _reg AND status = 'approved'),
    count(*)::text FROM public.charges WHERE registration_id = _reg;
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ group override */
DO $$
DECLARE
  c ctx;
  _n int;
  _tuition uuid;
  _reg uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  _n := public.customize_group_fees(c.g2);
  INSERT INTO results (name, ok, detail) SELECT
    'customising a group starts from a copy of the formation''s fees', _n = 2, _n::text;
  PERFORM pg_temp.expect('a group that already has its own fees cannot be customised again',
    format($q$SELECT public.customize_group_fees(%L)$q$, c.g2), '23514');

  SELECT id INTO _tuition FROM public.fee_templates WHERE group_id = c.g2 AND fee_type = 'tuition';
  PERFORM public.save_fee_template(_tuition, c.p_id, c.g2, 'tuition', 'Intensif', 35000,
    '[{"months":0,"amount_dzd":20000},{"months":1,"amount_dzd":15000}]');
  PERFORM pg_temp.expect('an item cannot move to another group',
    format($q$SELECT public.save_fee_template(%L, %L, %L, 'tuition', NULL, 35000, '[{"months":0,"amount_dzd":35000}]')$q$, _tuition, c.p_id, c.g1), '23514');

  INSERT INTO public.registrations (student_id, group_id, status, decided_at)
  VALUES (c.s_g2, c.g2, 'approved', now()) RETURNING id INTO _reg;
  INSERT INTO results (name, ok, detail) SELECT
    'a group with an override charges its own fees to new enrollments',
    (SELECT amount_dzd FROM public.charges WHERE registration_id = _reg AND fee_type = 'tuition') = 35000
      AND (SELECT count(*) FROM public.charge_installments i JOIN public.charges ch ON ch.id = i.charge_id
            WHERE ch.registration_id = _reg AND ch.fee_type = 'tuition') = 2
      AND (SELECT count(*) FROM public.charges WHERE registration_id = _reg) = 2, '';
  INSERT INTO results (name, ok, detail) SELECT
    'the formation default stays as it was for groups without an override',
    amount_dzd = 30000, amount_dzd::text
    FROM public.fee_templates WHERE id = (SELECT id FROM ids WHERE name = 'tuition');
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ edits never rewrite history */
DO $$
DECLARE
  c ctx;
  _reg uuid;
  _before jsonb;
  _r text;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT jsonb_agg(jsonb_build_object('a', ch.amount_dzd, 'i', (SELECT jsonb_agg(jsonb_build_object('a', i.amount_dzd, 'd', i.due_on) ORDER BY i.position)
                                                            FROM public.charge_installments i WHERE i.charge_id = ch.id)) ORDER BY ch.fee_type)
    INTO _before FROM public.charges ch WHERE ch.registration_id = (SELECT id FROM ids WHERE name = 'reg_new');

  PERFORM public.save_fee_template((SELECT id FROM ids WHERE name = 'tuition'), c.p_id, NULL, 'tuition', NULL, 33000,
    '[{"months":0,"amount_dzd":33000}]');
  INSERT INTO results (name, ok, detail) SELECT
    'changing the formation''s fee leaves an enrolled student''s charges and installments as they were',
    jsonb_agg(jsonb_build_object('a', ch.amount_dzd, 'i', (SELECT jsonb_agg(jsonb_build_object('a', i.amount_dzd, 'd', i.due_on) ORDER BY i.position)
                                                       FROM public.charge_installments i WHERE i.charge_id = ch.id)) ORDER BY ch.fee_type) = _before,
    ''
    FROM public.charges ch WHERE ch.registration_id = (SELECT id FROM ids WHERE name = 'reg_new');
  INSERT INTO results (name, ok, detail) SELECT
    'the change is audited with before and after', count(*) = 1, count(*)::text
    FROM public.audit_log WHERE action = 'fee_template_updated'
     AND details ->> 'template_id' = (SELECT id FROM ids WHERE name = 'tuition')::text;

  INSERT INTO public.registrations (student_id, group_id, status, decided_at)
  VALUES (c.s_late, c.g1, 'approved', now()) RETURNING id INTO _reg;
  INSERT INTO results (name, ok, detail) SELECT
    'an enrollment after the change receives the new amount', amount_dzd = 33000, amount_dzd::text
    FROM public.charges WHERE registration_id = _reg AND fee_type = 'tuition';

  -- Removing: a used item is archived (its charges keep their source), an unused one deleted.
  _r := public.remove_fee_template((SELECT id FROM ids WHERE name = 'registration'));
  INSERT INTO results (name, ok, detail) SELECT
    'removing a fee that generated charges archives it; the charges stay',
    _r = 'archived' AND (SELECT status FROM public.fee_templates WHERE id = (SELECT id FROM ids WHERE name = 'registration')) = 'archived'
      AND (SELECT count(*) FROM public.charges WHERE template_id = (SELECT id FROM ids WHERE name = 'registration') AND status = 'active') >= 3,
    _r;
  _r := public.remove_fee_template(public.save_fee_template(NULL, c.p_id, NULL, 'materials', NULL, 1500, '[{"months":0,"amount_dzd":1500}]'));
  INSERT INTO results (name, ok, detail) SELECT 'removing an unused fee deletes it', _r = 'deleted', _r;
  PERFORM pg_temp.expect('an archived fee cannot be edited',
    format($q$SELECT public.save_fee_template(%L, %L, NULL, 'registration', NULL, 2000, '[{"months":0,"amount_dzd":2000}]')$q$,
      (SELECT id FROM ids WHERE name = 'registration'), c.p_id), '23514');
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ pre-registration, idempotence, rollback */
DO $$
DECLARE
  c ctx;
  _reg uuid;
  _n int;
BEGIN
  SELECT * INTO c FROM ctx;
  INSERT INTO public.applications (id, program_id, program_name, first_name, last_name, date_of_birth, phone, consent_at)
  VALUES (c.app_id, c.p_id, 'e2e-fixture TPL Anglais A2', 'Lina', 'Test', DATE '2000-01-01', '0550123456', now());

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  _reg := public.accept_application(c.app_id, c.s_app, c.g1);
  INSERT INTO results (name, ok, detail) SELECT
    'accepting a pre-registration charges the formation''s fees through the same path',
    count(*) = 1 AND bool_and(amount_dzd = 33000 AND template_id IS NOT NULL), count(*)::text
    FROM public.charges WHERE registration_id = _reg;

  -- The enrollment and its charges are one transaction: a failure afterwards leaves nothing.
  BEGIN
    INSERT INTO public.registrations (student_id, group_id, status, decided_at)
    VALUES (c.s_fail, c.g1, 'approved', now()) RETURNING id INTO _reg;
    INSERT INTO ids VALUES ('reg_fail', _reg);
    RAISE EXCEPTION 'simulated failure after the enrollment';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  INSERT INTO results (name, ok, detail) SELECT
    'a failed enrollment leaves no orphan charge',
    NOT EXISTS (SELECT 1 FROM public.registrations WHERE student_id = c.s_fail)
      AND NOT EXISTS (SELECT 1 FROM public.charges ch JOIN public.registrations r ON r.id = ch.registration_id
                       WHERE r.student_id = c.s_fail), '';
  PERFORM set_config('role', 'postgres', true);

  -- Applying twice never duplicates nor overwrites.
  _n := private.apply_fee_templates((SELECT id FROM ids WHERE name = 'reg_new'));
  INSERT INTO results (name, ok, detail) SELECT
    'an enrollment that already has charges is never charged again', _n = 0
      AND (SELECT count(*) FROM public.charges WHERE registration_id = (SELECT id FROM ids WHERE name = 'reg_new')) = 2,
    _n::text;

  -- Payments are untouched by the mechanism and still work.
  INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
  VALUES ((SELECT id FROM ids WHERE name = 'reg_new'), 7000, current_date, 'cash', c.admin_id);
  INSERT INTO results (name, ok, detail) SELECT
    'a partial payment is recorded as usual and changes no charge',
    (SELECT sum(amount_dzd) FROM public.charges WHERE registration_id = (SELECT id FROM ids WHERE name = 'reg_new')) = 32000, '';

  INSERT INTO results (name, ok, detail) SELECT
    'generated charges are audited as created from a template',
    count(*) >= 2, count(*)::text
    FROM public.audit_log WHERE action = 'charge_created' AND details ->> 'source' = 'fee_template'
     AND details ->> 'registration_id' = (SELECT id FROM ids WHERE name = 'reg_new')::text;
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ a group without formation */
DO $$
DECLARE
  c ctx;
  _gs uuid := gen_random_uuid();
  _st uuid := gen_random_uuid();
  _reg uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  INSERT INTO public.groups (id, name, max_students) VALUES (_gs, 'e2e-fixture TPL Maths 3AS', 10);
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (_st, 'e2e-fixture-tpl-gs-' || _st || '@example.test', '{"full_name":"e2e-fixture TPL GS"}');
  PERFORM pg_temp.as_admin();

  PERFORM public.save_fee_template(NULL, NULL, _gs, 'tuition', NULL, 9000,
    '[{"months":0,"amount_dzd":4500},{"months":1,"amount_dzd":4500}]');
  INSERT INTO results (name, ok, detail) SELECT 'a group without formation (a subject class) gets its own price',
    count(*) = 1 AND bool_and(program_id IS NULL), count(*)::text FROM public.fee_templates WHERE group_id = _gs;
  PERFORM pg_temp.expect('a formation group cannot be priced as if it had no formation',
    format($q$SELECT public.save_fee_template(NULL, NULL, %L, 'exam', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('a fee needs a formation or a group',
    $q$SELECT public.save_fee_template(NULL, NULL, NULL, 'exam', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, '23514');

  INSERT INTO public.registrations (student_id, group_id, status, decided_at)
  VALUES (_st, _gs, 'approved', now()) RETURNING id INTO _reg;
  INSERT INTO results (name, ok, detail) SELECT 'enrolling in that group charges its price with its schedule',
    (SELECT count(*) FROM public.charges WHERE registration_id = _reg AND amount_dzd = 9000 AND template_id IS NOT NULL) = 1
      AND (SELECT count(*) FROM public.charge_installments i JOIN public.charges ch ON ch.id = i.charge_id
            WHERE ch.registration_id = _reg) = 2, '';
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ other roles */
DO $$
DECLARE
  c ctx;
  who record;
  n int;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('role', 'anon', true);
  PERFORM pg_temp.expect('anonymous visitors cannot read fee templates', 'SELECT count(*) FROM public.fee_templates', '42501');
  PERFORM pg_temp.expect('anonymous visitors cannot create fee templates',
    format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, c.p_id), '42501');
  PERFORM set_config('role', 'postgres', true);

  FOR who IN SELECT 'teacher' AS label, teacher_id AS id FROM ctx UNION ALL SELECT 'student', s_new FROM ctx LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO n FROM public.fee_templates WHERE program_id = c.p_id;
    INSERT INTO results VALUES (DEFAULT, who.label || ' sees no fee template', n = 0, n::text);
    PERFORM pg_temp.expect(who.label || ' cannot create a fee template',
      format($q$SELECT public.save_fee_template(NULL, %L, NULL, 'exam', NULL, 1000, '[{"months":0,"amount_dzd":1000}]')$q$, c.p_id), '42501');
    PERFORM pg_temp.expect(who.label || ' cannot remove a fee template',
      format($q$SELECT public.remove_fee_template(%L)$q$, (SELECT id FROM ids WHERE name = 'tuition')), '42501');
    PERFORM pg_temp.expect(who.label || ' cannot customise a group''s fees',
      format($q$SELECT public.customize_group_fees(%L)$q$, c.g1), '42501');
    PERFORM pg_temp.expect(who.label || ' cannot apply templates directly',
      format($q$SELECT private.apply_fee_templates(%L)$q$, (SELECT id FROM ids WHERE name = 'reg_new')), '42501');
    PERFORM set_config('role', 'postgres', true);
  END LOOP;
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
    RAISE EXCEPTION 'fee templates: some checks failed';
  END IF;
END $$;
ROLLBACK;
