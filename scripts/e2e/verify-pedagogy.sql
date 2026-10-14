-- ==================================================================
-- Pédagogie (ADR-008): lesson log, assessments and scores, academic periods, report-card remarks,
-- chapter completion -- against the LOCAL database, inside ONE transaction that is always
-- ROLLED BACK.
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-pedagogy.sql
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
-- Runs a statement and records how many rows it touched (RLS hides rows rather than raising).
CREATE FUNCTION pg_temp.touched(p_sql text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  _n integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE TEMP TABLE ctx AS
  SELECT (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1) AS admin_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' ORDER BY user_id LIMIT 1) AS teacher_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' ORDER BY user_id OFFSET 1 LIMIT 1) AS other_teacher,
         gen_random_uuid() AS s_a, gen_random_uuid() AS s_b, gen_random_uuid() AS s_out,
         gen_random_uuid() AS g1, gen_random_uuid() AS g2,
         gen_random_uuid() AS ch1, gen_random_uuid() AS ch_other;
GRANT SELECT ON ctx TO PUBLIC;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT u, 'e2e-fixture-ped-' || u || '@example.test', '{"full_name":"e2e-fixture PED"}'::jsonb
  FROM ctx, unnest(ARRAY[s_a, s_b, s_out]) AS u;
-- G1: the teacher's group, Tuesday and Sunday, from 2026-09-01 (a Tuesday) to 2026-12-31.
INSERT INTO public.groups (id, name, max_students, teacher_id, status, start_date, end_date)
SELECT g1, 'e2e-fixture PED G1', 10, teacher_id, 'active'::public.entity_status, DATE '2026-09-01', DATE '2026-12-31' FROM ctx
UNION ALL SELECT g2, 'e2e-fixture PED G2', 10, other_teacher, 'active', DATE '2026-09-01', NULL FROM ctx;
INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time)
SELECT g1, 2, TIME '10:00', TIME '11:30' FROM ctx UNION ALL SELECT g1, 0, '14:00', '15:30' FROM ctx;
INSERT INTO public.registrations (student_id, group_id, status, decided_at)
SELECT s_a, g1, 'approved'::public.registration_status, now() FROM ctx
UNION ALL SELECT s_b, g1, 'approved', now() FROM ctx
UNION ALL SELECT s_out, g1, 'pending', NULL FROM ctx;
INSERT INTO public.chapters (id, group_id, title, position, is_published)
SELECT ch1, g1, 'e2e-fixture Chapitre 1', 1, true FROM ctx
UNION ALL SELECT ch_other, g2, 'e2e-fixture Chapitre G2', 1, true FROM ctx;

/* ------------------------------------------------------------------ cahier de textes */
DO $$
DECLARE
  c ctx;
  _e uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO public.lesson_entries (group_id, session_date, chapter_id, summary, homework, homework_due)
  VALUES (c.g1, DATE '2026-09-01', c.ch1, 'Introduction et rappels', 'Exercices 1 a 5', DATE '2026-09-06')
  RETURNING id INTO _e;
  INSERT INTO ids VALUES ('entry', _e);
  INSERT INTO results (name, ok, detail) SELECT 'the group''s teacher writes a lesson entry (author stamped)',
    created_by = c.teacher_id AND updated_by = c.teacher_id, coalesce(created_by::text, 'null')
    FROM public.lesson_entries WHERE id = _e;

  PERFORM pg_temp.expect('one entry per session',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (%L, DATE '2026-09-01', 'Bis')$q$, c.g1), '23505');
  PERFORM pg_temp.expect('an entry on a day without a slot is refused',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (%L, DATE '2026-09-07', 'Lundi')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('an entry before the group starts is refused',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (%L, DATE '2026-08-30', 'Avant')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('an entry after the group ends is refused',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (%L, DATE '2027-01-03', 'Apres')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('an empty summary is refused',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (%L, DATE '2026-09-06', '  ')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('homework due before the session is refused',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary, homework, homework_due) VALUES (%L, DATE '2026-09-06', 'x', 'y', DATE '2026-09-05')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('a due date without homework is refused',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary, homework_due) VALUES (%L, DATE '2026-09-06', 'x', DATE '2026-09-08')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('a chapter of another group is refused',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary, chapter_id) VALUES (%L, DATE '2026-09-06', 'x', %L)$q$, c.g1, c.ch_other), '23514');
  PERFORM pg_temp.expect('an entry cannot move to another session',
    format($q$UPDATE public.lesson_entries SET session_date = DATE '2026-09-08' WHERE id = %L$q$, _e), '23514');

  UPDATE public.lesson_entries SET summary = 'Introduction, rappels et methode' WHERE id = _e;
  INSERT INTO results (name, ok, detail) SELECT 'the teacher edits the entry',
    summary LIKE '%methode', summary FROM public.lesson_entries WHERE id = _e;

  PERFORM pg_temp.as_user(c.other_teacher);
  INSERT INTO results (name, ok, detail) SELECT 'another teacher cannot read the entry', count(*) = 0, count(*)::text
    FROM public.lesson_entries WHERE group_id = c.g1;
  PERFORM pg_temp.expect('another teacher cannot write in the group',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (%L, DATE '2026-09-06', 'x')$q$, c.g1), '42501');
  INSERT INTO results (name, ok, detail) SELECT 'another teacher cannot edit the entry',
    pg_temp.touched(format($q$UPDATE public.lesson_entries SET summary = 'pirate' WHERE id = %L$q$, _e)) = 0, '';

  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'an enrolled student reads the lesson log', count(*) = 1, count(*)::text
    FROM public.lesson_entries WHERE group_id = c.g1;
  PERFORM pg_temp.expect('a student cannot write the lesson log',
    format($q$INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (%L, DATE '2026-09-06', 'x')$q$, c.g1), '42501');
  INSERT INTO results (name, ok, detail) SELECT 'a student cannot edit the lesson log',
    pg_temp.touched(format($q$UPDATE public.lesson_entries SET summary = 'x' WHERE id = %L$q$, _e)) = 0, '';
  PERFORM pg_temp.as_user(c.s_out);
  INSERT INTO results (name, ok, detail) SELECT 'a pending student does not read the lesson log', count(*) = 0, count(*)::text
    FROM public.lesson_entries WHERE group_id = c.g1;

  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO public.lesson_entries (group_id, session_date, summary) VALUES (c.g1, DATE '2026-09-06', 'Seance 2');
  INSERT INTO results (name, ok, detail) SELECT 'an administrator writes in any group', count(*) = 2, count(*)::text
    FROM public.lesson_entries WHERE group_id = c.g1;
  RESET role;
END $$;

/* ------------------------------------------------------------------ periods */
DO $$
DECLARE
  c ctx;
  _p uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO public.academic_periods (name, academic_year, starts_on, ends_on, position)
  VALUES ('e2e-fixture Trimestre 1', 'e2e-2026', DATE '2026-09-01', DATE '2026-11-30', 1) RETURNING id INTO _p;
  INSERT INTO ids VALUES ('p1', _p);
  INSERT INTO public.academic_periods (name, academic_year, starts_on, ends_on, position)
  VALUES ('e2e-fixture Trimestre 2', 'e2e-2026', DATE '2026-12-01', DATE '2027-02-28', 2) RETURNING id INTO _p;
  INSERT INTO ids VALUES ('p2', _p);
  INSERT INTO results (name, ok, detail) SELECT 'an administrator creates periods', count(*) = 2, count(*)::text
    FROM public.academic_periods WHERE academic_year = 'e2e-2026';
  PERFORM pg_temp.expect('a period cannot end before it starts',
    $q$INSERT INTO public.academic_periods (name, starts_on, ends_on) VALUES ('e2e-fixture bad', DATE '2026-10-01', DATE '2026-09-01')$q$, '23514');
  PERFORM pg_temp.expect('period names are unique within a year',
    $q$INSERT INTO public.academic_periods (name, academic_year, starts_on, ends_on) VALUES ('E2E-FIXTURE trimestre 1', 'e2e-2026', DATE '2026-09-01', DATE '2026-09-02')$q$, '23505');

  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO results (name, ok, detail) SELECT 'a teacher reads the periods', count(*) = 2, count(*)::text
    FROM public.academic_periods WHERE academic_year = 'e2e-2026';
  PERFORM pg_temp.expect('a teacher cannot create a period',
    $q$INSERT INTO public.academic_periods (name, starts_on, ends_on) VALUES ('e2e-fixture T', DATE '2026-09-01', DATE '2026-09-02')$q$, '42501');
  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a student reads the periods', count(*) = 2, count(*)::text
    FROM public.academic_periods WHERE academic_year = 'e2e-2026';
  INSERT INTO results (name, ok, detail) SELECT 'a student cannot edit a period',
    pg_temp.touched($q$UPDATE public.academic_periods SET name = 'x' WHERE academic_year = 'e2e-2026'$q$) = 0, '';
  RESET role;
END $$;

/* ------------------------------------------------------------------ assessments and scores */
DO $$
DECLARE
  c ctx;
  _a uuid;
  _a2 uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO public.assessments (group_id, title, kind, held_on, max_score, coefficient)
  VALUES (c.g1, 'e2e-fixture Devoir 1', 'test', DATE '2026-09-08', 20, 2) RETURNING id INTO _a;
  INSERT INTO ids VALUES ('a1', _a);
  INSERT INTO results (name, ok, detail) SELECT 'the group''s teacher creates an assessment (unpublished by default)',
    NOT published AND created_by = c.teacher_id, published::text FROM public.assessments WHERE id = _a;
  PERFORM pg_temp.expect('an assessment on a day without a slot is refused',
    format($q$INSERT INTO public.assessments (group_id, title, held_on) VALUES (%L, 'x', DATE '2026-09-07')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('an unknown kind is refused',
    format($q$INSERT INTO public.assessments (group_id, title, kind, held_on) VALUES (%L, 'x', 'party', DATE '2026-09-08')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('a maximum above 100 is refused',
    format($q$INSERT INTO public.assessments (group_id, title, held_on, max_score) VALUES (%L, 'x', DATE '2026-09-08', 150)$q$, c.g1), '23514');
  PERFORM pg_temp.expect('a zero coefficient is refused',
    format($q$INSERT INTO public.assessments (group_id, title, held_on, coefficient) VALUES (%L, 'x', DATE '2026-09-08', 0)$q$, c.g1), '23514');
  PERFORM pg_temp.expect('an assessment cannot move to another group',
    format($q$UPDATE public.assessments SET group_id = %L WHERE id = %L$q$, c.g2, _a), '23514');

  INSERT INTO public.assessment_scores (assessment_id, student_id, score, comment) VALUES (_a, c.s_a, 15.5, 'Bien');
  INSERT INTO public.assessment_scores (assessment_id, student_id, absent) VALUES (_a, c.s_b, true);
  INSERT INTO results (name, ok, detail) SELECT 'the teacher enters scores and absences', count(*) = 2, count(*)::text
    FROM public.assessment_scores WHERE assessment_id = _a;
  INSERT INTO results (name, ok, detail) SELECT 'the score''s editor is stamped', updated_by = c.teacher_id, ''
    FROM public.assessment_scores WHERE assessment_id = _a AND student_id = c.s_a;
  PERFORM pg_temp.expect('a score above the maximum is refused',
    format($q$UPDATE public.assessment_scores SET score = 21 WHERE assessment_id = %L AND student_id = %L$q$, _a, c.s_a), '23514');
  PERFORM pg_temp.expect('a negative score is refused',
    format($q$UPDATE public.assessment_scores SET score = -1 WHERE assessment_id = %L AND student_id = %L$q$, _a, c.s_a), '23514');
  PERFORM pg_temp.expect('absent with a score is refused',
    format($q$UPDATE public.assessment_scores SET score = 10 WHERE assessment_id = %L AND student_id = %L$q$, _a, c.s_b), '23514');
  PERFORM pg_temp.expect('a student without an approved enrollment cannot be scored',
    format($q$INSERT INTO public.assessment_scores (assessment_id, student_id, score) VALUES (%L, %L, 10)$q$, _a, c.s_out), '23514');
  PERFORM pg_temp.expect('the maximum cannot drop below an existing score',
    format($q$UPDATE public.assessments SET max_score = 10 WHERE id = %L$q$, _a), '23514');
  UPDATE public.assessments SET max_score = 16 WHERE id = _a;
  INSERT INTO results (name, ok, detail) SELECT 'the maximum can drop while every score still fits', max_score = 16, max_score::text
    FROM public.assessments WHERE id = _a;
  UPDATE public.assessments SET max_score = 20 WHERE id = _a;

  -- Unpublished: the student sees nothing.
  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a student does not see an unpublished assessment', count(*) = 0, count(*)::text
    FROM public.assessments WHERE id = _a;
  INSERT INTO results (name, ok, detail) SELECT 'a student does not see unpublished scores', count(*) = 0, count(*)::text
    FROM public.assessment_scores WHERE assessment_id = _a;

  PERFORM pg_temp.as_user(c.teacher_id);
  UPDATE public.assessments SET published = true WHERE id = _a;

  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a student sees the published assessment', count(*) = 1, count(*)::text
    FROM public.assessments WHERE id = _a;
  INSERT INTO results (name, ok, detail) SELECT 'a student sees only their own score', count(*) = 1 AND bool_and(student_id = c.s_a), count(*)::text
    FROM public.assessment_scores WHERE assessment_id = _a;
  INSERT INTO results (name, ok, detail) SELECT 'a student cannot change their score',
    pg_temp.touched(format($q$UPDATE public.assessment_scores SET score = 20 WHERE assessment_id = %L$q$, _a)) = 0, '';
  -- An enrolled student (the trigger lets it through) is stopped by RLS.
  PERFORM pg_temp.expect('a student cannot add a score',
    format($q$INSERT INTO public.assessment_scores (assessment_id, student_id, score) VALUES (%L, %L, 20) ON CONFLICT DO NOTHING$q$, _a, c.s_a), '42501');
  INSERT INTO results (name, ok, detail) SELECT 'a student cannot unpublish',
    pg_temp.touched(format($q$UPDATE public.assessments SET published = false WHERE id = %L$q$, _a)) = 0, '';

  PERFORM pg_temp.as_user(c.s_out);
  INSERT INTO results (name, ok, detail) SELECT 'a pending student does not see the published assessment', count(*) = 0, count(*)::text
    FROM public.assessments WHERE id = _a;

  PERFORM pg_temp.as_user(c.other_teacher);
  INSERT INTO results (name, ok, detail) SELECT 'another teacher sees neither the assessment nor its scores',
    (SELECT count(*) FROM public.assessments WHERE id = _a) = 0 AND (SELECT count(*) FROM public.assessment_scores WHERE assessment_id = _a) = 0, '';
  PERFORM pg_temp.expect('another teacher cannot create an assessment in the group',
    format($q$INSERT INTO public.assessments (group_id, title, held_on) VALUES (%L, 'x', DATE '2026-09-08')$q$, c.g1), '42501');
  INSERT INTO results (name, ok, detail) SELECT 'another teacher cannot change scores',
    pg_temp.touched(format($q$UPDATE public.assessment_scores SET score = 0 WHERE assessment_id = %L$q$, _a)) = 0, '';

  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO public.assessments (group_id, title, kind, held_on, max_score, published)
  VALUES (c.g1, 'e2e-fixture Examen T2', 'exam', DATE '2026-12-06', 40, true) RETURNING id INTO _a2;
  INSERT INTO public.assessment_scores (assessment_id, student_id, score) VALUES (_a2, c.s_a, 30), (_a2, c.s_b, 22);
  INSERT INTO results (name, ok, detail) SELECT 'an administrator creates and scores in any group', count(*) = 2, count(*)::text
    FROM public.assessment_scores WHERE assessment_id = _a2;
  DELETE FROM public.assessments WHERE id = _a2;
  INSERT INTO results (name, ok, detail) SELECT 'deleting an assessment deletes its scores', count(*) = 0, count(*)::text
    FROM public.assessment_scores WHERE assessment_id = _a2;
  RESET role;
END $$;

/* ------------------------------------------------------------------ report-card remarks */
DO $$
DECLARE
  c ctx;
  _p uuid := (SELECT id FROM ids WHERE name = 'p1');
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO public.report_comments (period_id, student_id, group_id, comment) VALUES (_p, c.s_a, c.g1, 'Bon trimestre');
  INSERT INTO results (name, ok, detail) SELECT 'the group''s teacher writes a group remark', count(*) = 1, count(*)::text
    FROM public.report_comments WHERE student_id = c.s_a;
  PERFORM pg_temp.expect('one remark per period, student and group',
    format($q$INSERT INTO public.report_comments (period_id, student_id, group_id, comment) VALUES (%L, %L, %L, 'bis')$q$, _p, c.s_a, c.g1), '23505');
  PERFORM pg_temp.expect('a teacher cannot write the general remark',
    format($q$INSERT INTO public.report_comments (period_id, student_id, comment) VALUES (%L, %L, 'general')$q$, _p, c.s_a), '42501');

  PERFORM pg_temp.as_user(c.other_teacher);
  PERFORM pg_temp.expect('another teacher cannot write a remark for the group',
    format($q$INSERT INTO public.report_comments (period_id, student_id, group_id, comment) VALUES (%L, %L, %L, 'x')$q$, _p, c.s_b, c.g1), '42501');
  INSERT INTO results (name, ok, detail) SELECT 'another teacher cannot read the group''s remarks', count(*) = 0, count(*)::text
    FROM public.report_comments WHERE student_id = c.s_a;

  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO public.report_comments (period_id, student_id, comment) VALUES (_p, c.s_a, 'Eleve serieux');
  PERFORM pg_temp.expect('one general remark per period and student',
    format($q$INSERT INTO public.report_comments (period_id, student_id, comment) VALUES (%L, %L, 'bis')$q$, _p, c.s_a), '23505');

  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a student reads their own remarks', count(*) = 2, count(*)::text
    FROM public.report_comments WHERE student_id = c.s_a;
  INSERT INTO results (name, ok, detail) SELECT 'a student cannot edit a remark',
    pg_temp.touched($q$UPDATE public.report_comments SET comment = 'Excellent' WHERE true$q$) = 0, '';
  PERFORM pg_temp.as_user(c.s_b);
  INSERT INTO results (name, ok, detail) SELECT 'a student does not read another student''s remarks', count(*) = 0, count(*)::text
    FROM public.report_comments WHERE student_id = c.s_a;
  RESET role;
END $$;

/* ------------------------------------------------------------------ chapter completion */
DO $$
DECLARE
  c ctx;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  UPDATE public.chapters SET completed_on = DATE '2026-09-08' WHERE id = c.ch1;
  INSERT INTO results (name, ok, detail) SELECT 'the group''s teacher marks a chapter done', completed_on = DATE '2026-09-08', ''
    FROM public.chapters WHERE id = c.ch1;
  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a student cannot mark a chapter done',
    pg_temp.touched(format($q$UPDATE public.chapters SET completed_on = NULL WHERE id = %L$q$, c.ch1)) = 0, '';
  PERFORM pg_temp.as_user(c.other_teacher);
  INSERT INTO results (name, ok, detail) SELECT 'another teacher cannot mark the chapter done',
    pg_temp.touched(format($q$UPDATE public.chapters SET completed_on = NULL WHERE id = %L$q$, c.ch1)) = 0, '';
  RESET role;
END $$;

/* ------------------------------------------------------------------ anonymous and cascades */
DO $$
DECLARE
  c ctx;
  _t text;
BEGIN
  SELECT * INTO c FROM ctx;
  FOREACH _t IN ARRAY ARRAY['lesson_entries', 'academic_periods', 'assessments', 'assessment_scores', 'report_comments'] LOOP
    INSERT INTO results (name, ok, detail) SELECT 'anon has no privilege on ' || _t,
      NOT has_table_privilege('anon', 'public.' || _t, 'SELECT')
      AND NOT has_table_privilege('anon', 'public.' || _t, 'INSERT'), '';
    INSERT INTO results (name, ok, detail) SELECT 'RLS is enabled on ' || _t,
      relrowsecurity, '' FROM pg_class WHERE oid = ('public.' || _t)::regclass;
  END LOOP;
  INSERT INTO results (name, ok, detail) SELECT 'the session-date check is not callable by clients',
    NOT has_function_privilege('authenticated', 'public.validate_session_date()', 'EXECUTE'), '';

  DELETE FROM public.chapters WHERE id = c.ch1;
  INSERT INTO results (name, ok, detail) SELECT 'deleting a chapter keeps the lesson entry, without chapter',
    count(*) = 1 AND bool_and(chapter_id IS NULL), count(*)::text
    FROM public.lesson_entries WHERE group_id = c.g1 AND session_date = DATE '2026-09-01';
  DELETE FROM public.groups WHERE id = c.g1;
  INSERT INTO results (name, ok, detail) SELECT 'deleting a group deletes its pedagogy',
    (SELECT count(*) FROM public.lesson_entries WHERE group_id = c.g1) = 0
    AND (SELECT count(*) FROM public.assessments WHERE group_id = c.g1) = 0
    AND (SELECT count(*) FROM public.report_comments WHERE group_id = c.g1) = 0, '';
END $$;

\set QUIET off
SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS r, name, detail FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM results;
ROLLBACK;
