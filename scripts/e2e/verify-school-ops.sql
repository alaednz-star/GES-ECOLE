-- ==================================================================
-- School operations (ADR-007): rooms and room conflicts, official documents, statistics view,
-- against the LOCAL database, inside ONE transaction that is always ROLLED BACK.
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-school-ops.sql
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
         gen_random_uuid() AS g1, gen_random_uuid() AS g2, gen_random_uuid() AS g3, gen_random_uuid() AS g4,
         gen_random_uuid() AS reg_a, gen_random_uuid() AS reg_b, gen_random_uuid() AS reg_pend;
GRANT SELECT ON ctx TO PUBLIC;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT u, 'e2e-fixture-ops-' || u || '@example.test', '{"full_name":"e2e-fixture OPS"}'::jsonb
  FROM ctx, unnest(ARRAY[s_a, s_b]) AS u;
UPDATE public.students SET date_of_birth = DATE '2010-05-04' WHERE id = (SELECT s_a FROM ctx);
INSERT INTO public.groups (id, name, max_students, teacher_id, status)
SELECT g1, 'e2e-fixture OPS G1', 10, teacher_id, 'active'::public.entity_status FROM ctx
UNION ALL SELECT g2, 'e2e-fixture OPS G2', 10, NULL, 'active' FROM ctx
UNION ALL SELECT g3, 'e2e-fixture OPS G3 inactive', 10, NULL, 'inactive' FROM ctx
UNION ALL SELECT g4, 'e2e-fixture OPS G4 later', 10, NULL, 'active' FROM ctx;
UPDATE public.groups SET start_date = DATE '2026-09-01' WHERE id = (SELECT g1 FROM ctx);
UPDATE public.groups SET start_date = DATE '2026-09-01', end_date = DATE '2026-12-31' WHERE id = (SELECT g2 FROM ctx);
UPDATE public.groups SET start_date = DATE '2027-01-01', end_date = DATE '2027-06-30' WHERE id = (SELECT g4 FROM ctx);
INSERT INTO public.registrations (id, student_id, group_id, status, decided_at)
SELECT reg_a, s_a, g1, 'approved'::public.registration_status, now() FROM ctx
UNION ALL SELECT reg_b, s_b, g1, 'approved'::public.registration_status, now() FROM ctx
UNION ALL SELECT reg_pend, s_b, g2, 'pending'::public.registration_status, NULL FROM ctx;

/* ------------------------------------------------------------------ rooms */
DO $$
DECLARE
  c ctx;
  _r1 uuid;
  _r2 uuid;
  _slot uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  INSERT INTO results (name, ok, detail) SELECT 'every existing free-text room was turned into a linked room',
    NOT EXISTS (SELECT 1 FROM public.group_schedules WHERE room IS NOT NULL AND btrim(room) <> '' AND room_id IS NULL), '';

  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO public.rooms (name, capacity, location) VALUES ('e2e-fixture Salle 1', 20, 'RDC') RETURNING id INTO _r1;
  INSERT INTO public.rooms (name, capacity) VALUES ('e2e-fixture Salle 2', 12) RETURNING id INTO _r2;
  INSERT INTO ids VALUES ('r1', _r1), ('r2', _r2);
  INSERT INTO results (name, ok, detail) SELECT 'an administrator creates rooms', count(*) = 2, count(*)::text
    FROM public.rooms WHERE name LIKE 'e2e-fixture%';
  PERFORM pg_temp.expect('room names are unique', $q$INSERT INTO public.rooms (name) VALUES ('E2E-FIXTURE salle 1')$q$, '23505');

  INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room_id)
  VALUES (c.g1, 2, '10:00', '11:30', _r1) RETURNING id INTO _slot;
  INSERT INTO ids VALUES ('slot1', _slot);
  INSERT INTO results (name, ok, detail) SELECT 'a slot takes its room''s name', room = 'e2e-fixture Salle 1', room
    FROM public.group_schedules WHERE id = _slot;

  PERFORM pg_temp.expect('two active groups cannot share a room at overlapping times',
    format($q$INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room_id) VALUES (%L, 2, '11:00', '12:00', %L)$q$, c.g2, _r1), '23514');
  INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room_id) VALUES (c.g2, 2, '11:30', '13:00', _r1);
  INSERT INTO results VALUES (DEFAULT, 'back-to-back slots in the same room are fine', true, '');
  PERFORM pg_temp.expect('moving a slot onto an occupied time is refused',
    format($q$UPDATE public.group_schedules SET start_time = '12:30', end_time = '13:30' WHERE id = %L$q$, _slot), '23514');
  INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room_id) VALUES (c.g3, 2, '10:00', '11:30', _r1);
  INSERT INTO results VALUES (DEFAULT, 'an inactive group does not block a room', true, '');
  INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room_id) VALUES (c.g4, 2, '11:30', '13:00', _r1);
  INSERT INTO results VALUES (DEFAULT, 'groups whose terms do not overlap may use the same room and time', true, '');

  UPDATE public.rooms SET name = 'e2e-fixture Salle A' WHERE id = _r1;
  INSERT INTO results (name, ok, detail) SELECT 'renaming a room renames it on its slots', room = 'e2e-fixture Salle A', room
    FROM public.group_schedules WHERE id = _slot;
  DELETE FROM public.rooms WHERE id = _r2;
  INSERT INTO results VALUES (DEFAULT, 'an unused room can be deleted', true, '');

  -- Older writers send only the room's name: the slot is linked, and checked, all the same.
  INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room)
  VALUES (c.g2, 3, '09:00', '10:00', '  E2E-FIXTURE salle a ') RETURNING id INTO _slot;
  INSERT INTO results (name, ok, detail) SELECT 'a slot written with a room name is linked to that room',
    room_id = _r1 AND room = 'e2e-fixture Salle A', coalesce(room, 'null') FROM public.group_schedules WHERE id = _slot;
  -- Replacing a group's slots is atomic: a refused set leaves the previous slots in place.
  PERFORM pg_temp.expect('a refused slot replacement is refused as a whole',
    format($q$SELECT public.replace_group_schedules(%L, '[{"weekday":2,"start_time":"11:00","end_time":"12:00","room_id":"%s"}]')$q$, c.g4, _r1), '23514');
  INSERT INTO results (name, ok, detail) SELECT 'after a refused replacement the group keeps its previous slots',
    count(*) = 1, count(*)::text FROM public.group_schedules WHERE group_id = c.g4;
  PERFORM pg_temp.expect('a conflict is caught even when the room is given by name',
    format($q$INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room) VALUES (%L, 3, '09:30', '10:30', 'e2e-fixture Salle A')$q$, c.g1), '23514');
END $$;
RESET ROLE;

DO $$
DECLARE
  c ctx;
  n int;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  SELECT count(*) INTO n FROM public.rooms WHERE name LIKE 'e2e-fixture%';
  INSERT INTO results VALUES (DEFAULT, 'a teacher reads rooms (timetables)', n = 1, n::text);
  PERFORM pg_temp.expect('a teacher cannot create a room', $q$INSERT INTO public.rooms (name) VALUES ('e2e-fixture T')$q$, '42501');
  UPDATE public.rooms SET capacity = 99 WHERE name LIKE 'e2e-fixture%';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO results VALUES (DEFAULT, 'a teacher cannot change a room (0 rows)', n = 0, n::text);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('role', 'anon', true);
  PERFORM pg_temp.expect('anonymous visitors cannot read rooms', 'SELECT count(*) FROM public.rooms', '42501');
  PERFORM set_config('role', 'postgres', true);
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ official documents */
DO $$
DECLARE
  c ctx;
  _d uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  INSERT INTO public.attendance (group_id, student_id, session_date, status)
  SELECT c.g1, c.s_a, d, s::public.attendance_status
    FROM (VALUES (DATE '2026-10-06', 'present'), (DATE '2026-10-13', 'late'), (DATE '2026-10-20', 'absent'),
                 (DATE '2026-10-27', 'present')) v(d, s);
  INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
  VALUES (c.reg_a, 7000, current_date, 'cash', c.admin_id);

  PERFORM pg_temp.as_user(c.admin_id);
  _d := public.issue_official_document('enrollment', c.reg_a);
  INSERT INTO ids VALUES ('doc_enr', _d);
  INSERT INTO results (name, ok, detail) SELECT 'an enrollment certificate snapshots the student and the enrollment',
    number ~ ('^ATT-' || extract(year FROM current_date) || '-[0-9]{6}$') AND kind = 'enrollment'
      AND snapshot ->> 'group_name' = 'e2e-fixture OPS G1' AND snapshot ->> 'date_of_birth' = '2010-05-04'
      AND student_id = c.s_a AND snapshot ? 'academic_year',
    number FROM public.official_documents WHERE id = _d;
  _d := public.issue_official_document('attendance', c.reg_a);
  INSERT INTO results (name, ok, detail) SELECT 'an attendance certificate counts the sessions',
    (snapshot ->> 'present')::int = 2 AND (snapshot ->> 'late')::int = 1 AND (snapshot ->> 'absent')::int = 1
      AND (snapshot ->> 'total')::int = 4, snapshot::text FROM public.official_documents WHERE id = _d;
  _d := public.issue_official_document('payment', c.reg_a);
  INSERT INTO results (name, ok, detail) SELECT 'a payment certificate lists the payments received',
    (snapshot ->> 'total_dzd')::int = 7000 AND jsonb_array_length(snapshot -> 'payments') = 1, snapshot::text
    FROM public.official_documents WHERE id = _d;
  PERFORM pg_temp.expect('a payment certificate needs a payment',
    format($q$SELECT public.issue_official_document('payment', %L)$q$, c.reg_b), '23514');
  PERFORM pg_temp.expect('a pending request gets no certificate',
    format($q$SELECT public.issue_official_document('enrollment', %L)$q$, c.reg_pend), '23514');
  PERFORM pg_temp.expect('an unknown document type is refused',
    format($q$SELECT public.issue_official_document('diploma', %L)$q$, c.reg_a), '23514');
  PERFORM pg_temp.expect('voiding a certificate needs a reason',
    format($q$SELECT public.void_official_document(%L, ' ')$q$, (SELECT id FROM ids WHERE name = 'doc_enr')), '23514');
  PERFORM public.void_official_document((SELECT id FROM ids WHERE name = 'doc_enr'), 'Erreur de nom');
  INSERT INTO results (name, ok, detail) SELECT 'a voided certificate is kept, with who, when and why',
    status = 'voided' AND voided_by = c.admin_id, status FROM public.official_documents WHERE id = (SELECT id FROM ids WHERE name = 'doc_enr');
  PERFORM pg_temp.expect('clients cannot write documents', $q$UPDATE public.official_documents SET student_name = 'x'$q$, '42501');
  INSERT INTO results (name, ok, detail) SELECT 'issuing and voiding are audited', count(*) = 4, count(*)::text
    FROM public.audit_log WHERE action IN ('document_issued', 'document_voided') AND target_id = c.s_a
     AND created_at >= now() - interval '1 minute';
END $$;
RESET ROLE;

DO $$
DECLARE
  c ctx;
  n int;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  PERFORM pg_temp.expect('a teacher cannot issue a certificate',
    format($q$SELECT public.issue_official_document('enrollment', %L)$q$, c.reg_b), '42501');
  SELECT count(*) INTO n FROM public.official_documents WHERE student_id = c.s_a;
  INSERT INTO results VALUES (DEFAULT, 'a teacher reads no certificate', n = 0, n::text);
  SELECT coalesce(sum(total), 0) INTO n FROM public.attendance_monthly_stats WHERE group_id = c.g1;
  INSERT INTO results VALUES (DEFAULT, 'the teacher of the group sees its attendance statistics', n = 4, n::text);
  SELECT coalesce(sum(total), 0) INTO n FROM public.attendance_monthly_stats WHERE group_id = c.g2;
  INSERT INTO results VALUES (DEFAULT, 'a teacher sees no statistics of other groups', n = 0, n::text);
  PERFORM set_config('role', 'postgres', true);

  PERFORM pg_temp.as_user(c.s_a);
  SELECT count(*) INTO n FROM public.official_documents WHERE student_id = c.s_a;
  INSERT INTO results VALUES (DEFAULT, 'a student reads their own certificates', n = 3, n::text);
  PERFORM pg_temp.expect('a student cannot issue a certificate',
    format($q$SELECT public.issue_official_document('enrollment', %L)$q$, c.reg_a), '42501');
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.as_user(c.s_b);
  SELECT count(*) INTO n FROM public.official_documents WHERE student_id = c.s_a;
  INSERT INTO results VALUES (DEFAULT, 'a student reads no one else''s certificate', n = 0, n::text);
  PERFORM set_config('role', 'postgres', true);

  PERFORM pg_temp.as_user(c.admin_id);
  SELECT coalesce(sum(present), 0) INTO n FROM public.attendance_monthly_stats WHERE group_id = c.g1;
  INSERT INTO results VALUES (DEFAULT, 'the statistics view aggregates attendance per month and group', n = 2, n::text);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('role', 'anon', true);
  PERFORM pg_temp.expect('anonymous visitors cannot read certificates', 'SELECT count(*) FROM public.official_documents', '42501');
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
    RAISE EXCEPTION 'school operations: some checks failed';
  END IF;
END $$;
ROLLBACK;
