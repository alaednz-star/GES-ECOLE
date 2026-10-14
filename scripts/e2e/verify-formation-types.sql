-- ==================================================================
-- Formation types (20261005100000_formation_types.sql) -- data, lifecycle and permissions,
-- against the LOCAL database, inside ONE transaction that is always ROLLED BACK.
--
-- Roles are simulated exactly as PostgREST does it: SET ROLE authenticated + request.jwt.claims
-- (auth.uid() reads `sub`), so RLS, grants and triggers apply as for a real signed-in user. Runs
-- inside the local DB container, so it needs no host port:
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-formation-types.sql
--
-- Prints one PASS/FAIL line per check and a summary; exits non-zero on any failure.
-- ==================================================================

\set QUIET on
BEGIN;

CREATE TEMP TABLE results (n serial, name text, ok boolean, detail text);
GRANT ALL ON results TO PUBLIC;
GRANT ALL ON SEQUENCE results_n_seq TO PUBLIC;

-- One admin, one teacher and one student of the local data, impersonated below.
CREATE TEMP TABLE actors AS
  SELECT (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1) AS admin_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' LIMIT 1) AS teacher_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'student' LIMIT 1) AS student_id;
GRANT SELECT ON actors TO PUBLIC;

-- Fixture subjects for the real cases (rolled back with everything else).
INSERT INTO public.subjects (key, name, domain) VALUES
  ('e2e_ft_python', 'e2e-fixture Python', 'computing'),
  ('e2e_ft_robotics', 'e2e-fixture Robotique', 'computing'),
  ('e2e_ft_science', 'e2e-fixture Sciences', 'school_subjects'),
  ('e2e_ft_mental', 'e2e-fixture Calcul mental', 'other'),
  ('e2e_ft_soroban', 'e2e-fixture Soroban', 'other');

/* ------------------------------------------------------------------ built-in types */
DO $$
BEGIN
  INSERT INTO results (name, ok, detail)
  SELECT 'the 9 built-in types exist, active, in order', count(*) = 9 AND bool_and(status = 'active'),
         string_agg(code, ',' ORDER BY position)
    FROM public.formation_types WHERE built_in;
  INSERT INTO results (name, ok, detail)
  SELECT 'every existing formation keeps a valid type (no row rewritten)',
         NOT EXISTS (SELECT 1 FROM public.programs p
                      WHERE NOT EXISTS (SELECT 1 FROM public.formation_types t WHERE t.code = p.category)),
         (SELECT string_agg(DISTINCT category, ',') FROM public.programs);
  INSERT INTO results (name, ok, detail)
  SELECT 'the historical codes are all still built-in (language kept)',
         (SELECT count(*) FROM public.formation_types WHERE built_in AND code IN
           ('academic_support','language','exam_preparation','professional_training','workshop','other')) = 6, '';
END $$;

/* ------------------------------------------------------------------ admin: custom type lifecycle */
DO $$
DECLARE
  a uuid := (SELECT admin_id FROM actors);
  _code text; _built boolean; _err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  INSERT INTO public.formation_types (code, name, description, built_in)
  VALUES ('hacked_code', 'Stage intensif', 'Sessions intensives pendant les vacances', true)
  RETURNING code, built_in INTO _code, _built;
  INSERT INTO results VALUES (DEFAULT, 'admin creates a custom type; the database generates its code and forces built_in = false',
                              _code = 'custom_stage_intensif' AND NOT _built, _code);

  INSERT INTO public.formation_types (code, name) VALUES ('x_y', 'التحضير الصيفي') RETURNING code INTO _code;
  INSERT INTO results VALUES (DEFAULT, 'an Arabic-only name still gets a valid generated code',
                              _code ~ '^custom_[a-f0-9]{8}$', _code);

  BEGIN
    INSERT INTO public.formation_types (code, name) VALUES ('z_z', '  stage INTENSIF ');
    INSERT INTO results VALUES (DEFAULT, 'a duplicate name (case/space-insensitive) is refused', false, 'accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'a duplicate name (case/space-insensitive) is refused', true, '23505');
  END;

  UPDATE public.formation_types SET name = 'Stage intensif d''été', description = NULL
   WHERE code = 'custom_stage_intensif';
  INSERT INTO results (name, ok, detail) SELECT 'admin edits a custom type''s name and description',
    name = 'Stage intensif d''été' AND description IS NULL, name
    FROM public.formation_types WHERE code = 'custom_stage_intensif';

  BEGIN
    UPDATE public.formation_types SET code = 'renamed' WHERE code = 'custom_stage_intensif';
    INSERT INTO results VALUES (DEFAULT, 'a type''s code can never change', false, 'changed');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'a type''s code can never change', true, '23514');
  END;

  BEGIN
    UPDATE public.formation_types SET name = 'Soutien' WHERE code = 'academic_support';
    INSERT INTO results VALUES (DEFAULT, 'a built-in type cannot be renamed (translated label)', false, 'renamed');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'a built-in type cannot be renamed (translated label)', true, '23514');
  END;

  BEGIN
    DELETE FROM public.formation_types WHERE code = 'workshop';
    INSERT INTO results VALUES (DEFAULT, 'a built-in type cannot be deleted', false, 'deleted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'a built-in type cannot be deleted', true, '23514');
  END;

  UPDATE public.formation_types SET status = 'inactive' WHERE code = 'other';
  UPDATE public.formation_types SET status = 'active' WHERE code = 'other';
  INSERT INTO results (name, ok, detail) SELECT 'a built-in type can be deactivated and reactivated', status = 'active', ''
    FROM public.formation_types WHERE code = 'other';
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ real cases: type + subject + level */
DO $$
DECLARE
  a uuid := (SELECT admin_id FROM actors);
  sch uuid := (SELECT id FROM public.level_systems WHERE code = 'algerian_school');
  cefr uuid := (SELECT id FROM public.level_systems WHERE code = 'cefr');
  trn uuid := (SELECT id FROM public.level_systems WHERE code = 'training');
  subj jsonb;
  c record;
  r jsonb;
  ok_all boolean := true;
  failed text := '';
BEGIN
  SELECT jsonb_object_agg(key, id) INTO subj FROM public.subjects;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  FOR c IN SELECT * FROM (VALUES
      ('Mathématiques + soutien scolaire (école)', 'academic_support', 'mathematics', sch),
      ('Anglais + soutien scolaire (école)', 'academic_support', 'english', sch),
      ('Physique + préparation aux examens (école)', 'exam_preparation', 'physics', sch),
      ('Anglais + cours de langues (CECRL)', 'language', 'english', cefr),
      ('Français + cours de langues (CECRL)', 'language', 'french', cefr),
      ('Marketing + formation professionnelle (formation)', 'professional_training', 'marketing', trn),
      ('Python + formation professionnelle (formation)', 'professional_training', 'e2e_ft_python', trn),
      ('Calcul mental + activités parascolaires (formation)', 'extracurricular', 'e2e_ft_mental', trn),
      ('Soroban + formation générale (aucun niveau)', 'general_course', 'e2e_ft_soroban', NULL::uuid),
      ('Robotique + atelier (aucun niveau)', 'workshop', 'e2e_ft_robotics', NULL::uuid),
      ('Sciences + atelier (aucun niveau)', 'workshop', 'e2e_ft_science', NULL::uuid),
      ('Sans matière + enseignement scolaire (école)', 'formal_education', NULL, sch),
      ('Anglais + formation professionnelle (CECRL: the type does not force Training)', 'professional_training', 'english', cefr)
    ) AS v(label, category, subject_key, system_id)
  LOOP
    BEGIN
      r := public.create_formation(jsonb_build_object(
        'name', 'e2e-fixture FT ' || c.label,
        'category', c.category,
        'subject_id', CASE WHEN c.subject_key IS NULL THEN NULL ELSE subj ->> c.subject_key END,
        'level_system_id', c.system_id));
      IF r ->> 'program_id' IS NULL THEN ok_all := false; failed := failed || c.label || '; '; END IF;
    EXCEPTION WHEN OTHERS THEN
      ok_all := false; failed := failed || c.label || ' (' || SQLERRM || '); ';
    END;
  END LOOP;
  INSERT INTO results VALUES (DEFAULT,
    'the 13 real cases are created by an administrator (create_formation), each type with its own subject and level system',
    ok_all, failed);
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ inactive type lifecycle */
DO $$
DECLARE
  a uuid := (SELECT admin_id FROM actors);
  pid uuid;
  r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  r := public.create_formation(jsonb_build_object('name', 'e2e-fixture FT custom', 'category', 'custom_stage_intensif'));
  pid := (r ->> 'program_id')::uuid;
  INSERT INTO results VALUES (DEFAULT, 'a formation is created with a custom type', pid IS NOT NULL, '');

  UPDATE public.formation_types SET status = 'inactive' WHERE code = 'custom_stage_intensif';
  INSERT INTO results (name, ok, detail) SELECT 'after deactivating its type, the existing formation is unchanged and readable',
    category = 'custom_stage_intensif', category FROM public.programs WHERE id = pid;

  UPDATE public.programs SET duration_hours = 40 WHERE id = pid;
  INSERT INTO results (name, ok, detail) SELECT 'a formation on an inactive type can still be edited (type unchanged)',
    duration_hours = 40, '' FROM public.programs WHERE id = pid;

  BEGIN
    PERFORM public.create_formation(jsonb_build_object('name', 'e2e-fixture FT inactive', 'category', 'custom_stage_intensif'));
    INSERT INTO results VALUES (DEFAULT, 'an inactive type cannot be given to a NEW formation', false, 'created');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'an inactive type cannot be given to a NEW formation', true, '23514');
  END;

  BEGIN
    UPDATE public.programs SET category = 'custom_stage_intensif'
     WHERE name = 'e2e-fixture FT Sans matière + enseignement scolaire (école)';
    INSERT INTO results VALUES (DEFAULT, 'an existing formation cannot SWITCH to an inactive type', false, 'switched');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'an existing formation cannot SWITCH to an inactive type', true, '23514');
  END;

  BEGIN
    DELETE FROM public.formation_types WHERE code = 'custom_stage_intensif';
    INSERT INTO results VALUES (DEFAULT, 'a type used by a formation cannot be deleted', false, 'deleted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'a type used by a formation cannot be deleted', true, '23503');
  END;

  DELETE FROM public.formation_types WHERE name = 'التحضير الصيفي';
  INSERT INTO results (name, ok, detail) SELECT 'an unused custom type can be deleted',
    NOT EXISTS (SELECT 1 FROM public.formation_types WHERE name = 'التحضير الصيفي'), '';

  BEGIN
    PERFORM public.create_formation(jsonb_build_object('name', 'e2e-fixture FT unknown', 'category', 'karaoke'));
    INSERT INTO results VALUES (DEFAULT, 'an unknown type code is refused (foreign key)', false, 'created');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO results VALUES (DEFAULT, 'an unknown type code is refused (foreign key)', true, '23503');
  END;
END $$;
RESET ROLE;

/* ------------------------------------------------------------------ teacher and student */
DO $$
DECLARE
  who record;
  n int;
  _ok boolean;
BEGIN
  FOR who IN SELECT 'teacher' AS label, teacher_id AS id FROM actors
             UNION ALL SELECT 'student', student_id FROM actors LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO n FROM public.formation_types;
    INSERT INTO results VALUES (DEFAULT, who.label || ' can read the types (formation labels)', n >= 9, n::text);

    BEGIN
      INSERT INTO public.formation_types (code, name) VALUES ('t_x', 'e2e-fixture forged ' || who.label);
      _ok := false;
    EXCEPTION WHEN insufficient_privilege THEN
      _ok := true;
    END;
    INSERT INTO results VALUES (DEFAULT, who.label || ' cannot create a type (RLS)', _ok, '');

    UPDATE public.formation_types SET status = 'inactive' WHERE code = 'academic_support';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO results VALUES (DEFAULT, who.label || ' cannot deactivate a type (0 rows)', n = 0, n::text);

    DELETE FROM public.formation_types WHERE code = 'custom_stage_intensif';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO results VALUES (DEFAULT, who.label || ' cannot delete a type (0 rows)', n = 0, n::text);

    BEGIN
      PERFORM public.create_formation(jsonb_build_object('name', 'e2e-fixture FT forged ' || who.label, 'category', 'other'));
      _ok := false;
    EXCEPTION WHEN insufficient_privilege THEN
      _ok := true;
    END;
    INSERT INTO results VALUES (DEFAULT, who.label || ' still cannot create a formation', _ok, '');

    PERFORM set_config('role', 'postgres', true);
  END LOOP;
END $$;
RESET ROLE;

DO $$
BEGIN
  INSERT INTO results (name, ok, detail) SELECT 'academic_support is still active (no forged change persisted)',
    status = 'active', status::text FROM public.formation_types WHERE code = 'academic_support';
  INSERT INTO results (name, ok, detail) SELECT 'anonymous visitors have no access to formation types',
    NOT has_table_privilege('anon', 'public.formation_types', 'SELECT'), '';
END $$;

\set QUIET off
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '  ' || name
       || CASE WHEN NOT ok AND detail <> '' THEN '  -> ' || detail ELSE '' END AS result
  FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE NOT ok) || ' FAILURES / ' || count(*) || ' checks' AS summary FROM results;

-- Fail the psql run (non-zero exit) if any check failed; everything is rolled back either way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM results WHERE NOT ok) THEN
    RAISE EXCEPTION 'formation types: some checks failed';
  END IF;
END $$;
ROLLBACK;
