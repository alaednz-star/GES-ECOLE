-- ==================================================================
-- Pre-registrations (20261005110000_applications.sql) -- data, permissions and acceptance,
-- against the LOCAL database, inside ONE transaction that is always ROLLED BACK.
--
-- Roles are simulated as PostgREST does: SET ROLE authenticated / anon + request.jwt.claims.
-- Runs inside the local DB container (no host port needed):
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-applications.sql
-- ==================================================================

\set QUIET on
BEGIN;

CREATE TEMP TABLE results (n serial, name text, ok boolean, detail text);
GRANT ALL ON results TO PUBLIC;
GRANT ALL ON SEQUENCE results_n_seq TO PUBLIC;

CREATE TEMP TABLE ctx AS
  SELECT (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1) AS admin_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' LIMIT 1) AS teacher_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'student' LIMIT 1) AS student_id,
         gen_random_uuid() AS program_id,
         gen_random_uuid() AS other_program_id,
         gen_random_uuid() AS group_id,
         gen_random_uuid() AS other_group_id,
         gen_random_uuid() AS new_student_id,
         gen_random_uuid() AS app_id,
         gen_random_uuid() AS app2_id;
GRANT SELECT ON ctx TO PUBLIC;

-- Fixtures (rolled back): a formation open to pre-registration with one group of 1 place, another
-- formation's group, a student created like any account (handle_new_user), two applications.
INSERT INTO public.programs (id, name, category, status, registration_open)
SELECT program_id, 'e2e-fixture APP Calcul mental', 'extracurricular', 'active', true FROM ctx
UNION ALL SELECT other_program_id, 'e2e-fixture APP Autre', 'other', 'active', false FROM ctx;
INSERT INTO public.groups (id, name, program_id, max_students)
SELECT group_id, 'e2e-fixture APP Samedi 10h', program_id, 1 FROM ctx
UNION ALL SELECT other_group_id, 'e2e-fixture APP Autre groupe', other_program_id, 5 FROM ctx;
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT new_student_id, 'e2e-fixture-app-' || new_student_id || '@example.test',
       '{"full_name":"e2e-fixture Ahmed Ben Ali"}'::jsonb FROM ctx;
INSERT INTO public.applications (id, program_id, program_name, first_name, last_name, date_of_birth,
                                 guardian_name, guardian_phone, guardian_relation, consent_at)
SELECT app_id, program_id, 'e2e-fixture APP Calcul mental', 'Ahmed', 'Ben Ali', DATE '2016-03-14',
       'Karim Ben Ali', '0550123456', 'father', now() FROM ctx
UNION ALL
SELECT app2_id, program_id, 'e2e-fixture APP Calcul mental', 'Sara', 'K', DATE '2015-01-01',
       'Leila K', '0661223344', 'mother', now() FROM ctx;

/* ------------------------------------------------------------------ structure */
DO $$
BEGIN
  INSERT INTO results (name, ok, detail) SELECT
    'admins are notified of each new pre-registration',
    (SELECT count(*) FROM public.notifications n, ctx
      WHERE n.kind = 'application_received' AND n.params ->> 'application_id' = ctx.app_id::text)
    = (SELECT count(*) FROM public.user_roles WHERE role = 'admin'), '';
  INSERT INTO results (name, ok, detail) SELECT
    'the guardian age is an institution setting (default 18)',
    (SELECT guardian_required_under_age FROM public.center_settings LIMIT 1) = 18, '';

  BEGIN
    INSERT INTO public.applications (program_id, program_name, first_name, last_name, date_of_birth, consent_at)
    SELECT program_id, 'x', 'No', 'Contact', DATE '2000-01-01', now() FROM ctx;
    INSERT INTO results VALUES (DEFAULT, 'an application without any phone is refused', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'an application without any phone is refused', true, '23514');
  END;
  BEGIN
    INSERT INTO public.applications (program_id, program_name, first_name, last_name, date_of_birth, phone, consent_at)
    SELECT program_id, 'x', 'Bad', 'Phone', DATE '2000-01-01', '05-50 abc', now() FROM ctx;
    INSERT INTO results VALUES (DEFAULT, 'a malformed phone is refused', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'a malformed phone is refused', true, '23514');
  END;
  BEGIN
    UPDATE public.applications SET status = 'rejected' WHERE id = (SELECT app2_id FROM ctx);
    INSERT INTO results VALUES (DEFAULT, 'a decision must be dated', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'a decision must be dated', true, '23514');
  END;
END $$;

/* ------------------------------------------------------------------ anonymous, teacher, student */
DO $$
DECLARE
  who record;
  n int;
  _ok boolean;
BEGIN
  PERFORM set_config('role', 'anon', true);
  BEGIN
    SELECT count(*) INTO n FROM public.applications;
    _ok := false;
  EXCEPTION WHEN insufficient_privilege THEN _ok := true;
  END;
  INSERT INTO results VALUES (DEFAULT, 'anonymous visitors cannot read applications', _ok, '');
  BEGIN
    INSERT INTO public.applications (program_name, first_name, last_name, date_of_birth, phone, consent_at)
    VALUES ('x', 'Anon', 'Forged', DATE '2000-01-01', '0550123456', now());
    _ok := false;
  EXCEPTION WHEN insufficient_privilege THEN _ok := true;
  END;
  INSERT INTO results VALUES (DEFAULT, 'anonymous visitors cannot insert directly (only the server function can)', _ok, '');
  PERFORM set_config('role', 'postgres', true);

  FOR who IN SELECT 'teacher' AS label, teacher_id AS id FROM ctx
             UNION ALL SELECT 'student', student_id FROM ctx LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO n FROM public.applications;
    INSERT INTO results VALUES (DEFAULT, who.label || ' sees no application (RLS)', n = 0, n::text);

    BEGIN
      INSERT INTO public.applications (program_name, first_name, last_name, date_of_birth, phone, consent_at)
      VALUES ('x', 'Forged', who.label, DATE '2000-01-01', '0550123456', now());
      _ok := false;
    EXCEPTION WHEN insufficient_privilege THEN _ok := true;
    END;
    INSERT INTO results VALUES (DEFAULT, who.label || ' cannot insert an application', _ok, '');

    UPDATE public.applications SET status = 'reviewing' WHERE id = (SELECT app_id FROM ctx);
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO results VALUES (DEFAULT, who.label || ' cannot change an application (0 rows)', n = 0, n::text);

    BEGIN
      PERFORM public.accept_application((SELECT app_id FROM ctx), who.id, (SELECT group_id FROM ctx));
      _ok := false;
    EXCEPTION WHEN insufficient_privilege THEN _ok := true;
    END;
    INSERT INTO results VALUES (DEFAULT, who.label || ' cannot accept an application', _ok, '');
    PERFORM set_config('role', 'postgres', true);
  END LOOP;
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ administrator */
DO $$
DECLARE
  c ctx;
  n int;
  reg uuid;
  _ok boolean;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO n FROM public.applications WHERE id IN (c.app_id, c.app2_id);
  INSERT INTO results VALUES (DEFAULT, 'an administrator reads the applications', n = 2, n::text);

  UPDATE public.applications SET status = 'reviewing' WHERE id = c.app_id;
  INSERT INTO results (name, ok, detail) SELECT 'an administrator starts the review', status = 'reviewing', status
    FROM public.applications WHERE id = c.app_id;

  BEGIN
    PERFORM public.accept_application(c.app_id, c.new_student_id, c.other_group_id);
    _ok := false;
  EXCEPTION WHEN check_violation THEN _ok := true;
  END;
  INSERT INTO results VALUES (DEFAULT, 'a group of another formation is refused', _ok, '');

  reg := public.accept_application(c.app_id, c.new_student_id, c.group_id);
  INSERT INTO results (name, ok, detail) SELECT
    'accepting places the student in the group with an APPROVED registration and closes the application',
    a.status = 'accepted' AND a.student_id = c.new_student_id AND a.registration_id = reg
      AND a.decided_by = c.admin_id AND a.decided_at IS NOT NULL
      AND r.status = 'approved' AND r.group_id = c.group_id AND r.student_id = c.new_student_id,
    a.status || ' / ' || r.status
    FROM public.applications a JOIN public.registrations r ON r.id = a.registration_id
   WHERE a.id = c.app_id;

  BEGIN
    PERFORM public.accept_application(c.app_id, c.new_student_id, c.group_id);
    _ok := false;
  EXCEPTION WHEN check_violation THEN _ok := true;
  END;
  INSERT INTO results VALUES (DEFAULT, 'an application cannot be accepted twice', _ok, '');

  -- The group had 1 place, now taken: the next placement is refused by the capacity rule.
  BEGIN
    PERFORM public.accept_application(c.app2_id, c.student_id, c.group_id);
    _ok := false;
  EXCEPTION WHEN OTHERS THEN _ok := true;
  END;
  INSERT INTO results (name, ok, detail) SELECT 'a full group refuses the placement, and the application stays open',
    _ok AND status = 'new', status FROM public.applications WHERE id = c.app2_id;

  UPDATE public.applications SET status = 'rejected', decided_at = now(), decision_note = 'Complet'
   WHERE id = c.app2_id;
  UPDATE public.applications SET status = 'reviewing', decided_at = NULL, decision_note = NULL
   WHERE id = c.app2_id;
  INSERT INTO results (name, ok, detail) SELECT 'a refused application can be reopened', status = 'reviewing', status
    FROM public.applications WHERE id = c.app2_id;
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
    RAISE EXCEPTION 'applications: some checks failed';
  END IF;
END $$;
ROLLBACK;
