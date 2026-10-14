-- ==================================================================
-- Phase 3A -- Level System foundation (ADR-004 section 3).
--
-- WHY
--
-- Until now the schema had ONE level concept: `levels` with a mandatory `stage`
-- (primary | middle | high), i.e. the 12 Algerian school years. A language course (CEFR A1-C2),
-- a professional training (Beginner / Intermediate / Advanced) or an institution's own scale
-- could not be represented, and the Formation type determined nothing.
--
-- THE MODEL
--
--   level_systems  one row per scale: Algerian School, CEFR, Training (built-in, one each) and
--                  Custom (built-in, empty; administrators may add more custom systems)
--   levels         + system_id (NOT NULL, fixed for life), + code (stable, unique per system);
--                  stage becomes nullable and means "school stage": REQUIRED for a level of the
--                  school system, FORBIDDEN for every other system (no fake stages)
--   programs       + level_system_id (nullable). NULL = "no specific level". A formation may name
--                  a system without a level (e.g. "English", groups at several CEFR levels); when
--                  it names a level, that level must belong to its system. The system is filled
--                  from the level when only the level is given, so today's screens (which send
--                  only level_id) keep working unchanged until Phase 3B adds the picker.
--
-- WHAT KEEPS ITS MEANING
--
--   The 12 school levels keep their ids, names, stages and positions; they join the school
--   system and receive codes 1AP..5AP, 1AM..4AM, 1AS..3AS. Streams keep referencing them and may
--   only ever reference school levels. A student's level remains their SCHOOL identity
--   (ADR-004 section 3): only a school level is accepted there. Groups, registrations, payments,
--   attendance and every eligibility rule are untouched -- formation -> group system
--   consistency and catalogue eligibility per system are Phases 3B / 3C.
--
-- ROLLBACK (before any non-school level is in use)
--   DROP TRIGGER t_programs_level_system ON public.programs; DROP TRIGGER t_levels_system ON
--   public.levels; DROP TRIGGER t_streams_school_level ON public.streams; DROP TRIGGER
--   t_students_school_level ON public.students; DROP TRIGGER t_level_systems_guard ON
--   public.level_systems; ALTER TABLE public.programs DROP COLUMN level_system_id;
--   DELETE FROM public.levels WHERE system_id <> <school>; ALTER TABLE public.levels DROP COLUMN
--   code, DROP COLUMN system_id, ALTER COLUMN stage SET NOT NULL; DROP TABLE public.level_systems;
--   DROP FUNCTION public.enforce_level_system(), public.enforce_school_level(),
--   public.sync_program_level_system(), public.guard_level_system(); restore create_formation.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. Level systems
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.level_systems (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- What the system IS, which decides behaviour: only `school` levels have stages, streams and
  -- the student's academic identity. Text + CHECK, like programs.category, so a kind can be
  -- added without an enum migration.
  kind        text NOT NULL CHECK (kind IN ('school', 'cefr', 'training', 'custom')),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 500),
  built_in    boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  status      public.entity_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One built-in system per kind; administrators may add further CUSTOM systems only.
CREATE UNIQUE INDEX IF NOT EXISTS level_systems_one_built_in_per_kind
  ON public.level_systems (kind) WHERE built_in;

COMMENT ON TABLE public.level_systems IS
  'A level scale: Algerian School (stages + streams), CEFR, Training, Custom. Formations reference one (ADR-004 section 3).';

DROP TRIGGER IF EXISTS t_level_systems_touch ON public.level_systems;
CREATE TRIGGER t_level_systems_touch
  BEFORE UPDATE ON public.level_systems
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.level_systems (code, kind, name, description, built_in, position) VALUES
  ('algerian_school', 'school',   'Système scolaire algérien',
   'Primaire 1AP–5AP, moyen 1AM–4AM, secondaire 1AS–3AS, avec filières au lycée.', true, 1),
  ('cefr',            'cefr',     'CECRL (CEFR)',
   'Cadre européen commun de référence pour les langues : A1 à C2.', true, 2),
  ('training',        'training', 'Formation',
   'Niveaux de formation : débutant, intermédiaire, avancé.', true, 3),
  ('custom',          'custom',   'Personnalisé',
   'Niveaux propres à l''établissement.', true, 4)
ON CONFLICT (code) DO NOTHING;

-- Built-in systems are part of the product: they cannot be deleted or redefined, and
-- administrators can only create CUSTOM systems. (Migrations and server code run as other
-- roles and are not restricted.)
CREATE OR REPLACE FUNCTION public.guard_level_system()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind <> 'custom' THEN
      RAISE EXCEPTION 'Only custom level systems can be created.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.built_in := false;
    RETURN NEW;
  END IF;
  IF OLD.built_in AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A built-in level system cannot be deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.code IS DISTINCT FROM OLD.code OR NEW.kind IS DISTINCT FROM OLD.kind
                           OR NEW.built_in IS DISTINCT FROM OLD.built_in) THEN
    RAISE EXCEPTION 'The code, kind and built-in flag of a level system cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_level_system() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_level_systems_guard ON public.level_systems;
CREATE TRIGGER t_level_systems_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.level_systems
  FOR EACH ROW EXECUTE FUNCTION public.guard_level_system();

ALTER TABLE public.level_systems ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.level_systems TO authenticated;
GRANT ALL ON public.level_systems TO service_role;

DROP POLICY IF EXISTS "level systems read" ON public.level_systems;
CREATE POLICY "level systems read" ON public.level_systems
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "level systems admin write" ON public.level_systems;
CREATE POLICY "level systems admin write" ON public.level_systems
  FOR ALL TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());

-- ------------------------------------------------------------------
-- 2. Levels belong to a system
-- ------------------------------------------------------------------

ALTER TABLE public.levels
  ADD COLUMN IF NOT EXISTS system_id uuid REFERENCES public.level_systems (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS code text CHECK (code IS NULL OR length(btrim(code)) BETWEEN 1 AND 20);

-- Every existing level is an Algerian school year: same rows, same ids.
UPDATE public.levels
   SET system_id = (SELECT id FROM public.level_systems WHERE code = 'algerian_school')
 WHERE system_id IS NULL;

-- Stable codes for the 12 school years, from their stage and order within it (1AP..5AP,
-- 1AM..4AM, 1AS..3AS). Only rows without a code are touched.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY stage ORDER BY position, name) AS n,
         CASE stage WHEN 'primary' THEN 'AP' WHEN 'middle' THEN 'AM' ELSE 'AS' END AS suffix
    FROM public.levels
   WHERE system_id = (SELECT id FROM public.level_systems WHERE code = 'algerian_school')
)
UPDATE public.levels l
   SET code = r.n || r.suffix
  FROM ranked r
 WHERE l.id = r.id AND l.code IS NULL;

ALTER TABLE public.levels ALTER COLUMN system_id SET NOT NULL;
-- `stage` now means "school stage": it stays for school levels, and is absent elsewhere.
ALTER TABLE public.levels ALTER COLUMN stage DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS levels_code_per_system
  ON public.levels (system_id, lower(btrim(code))) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_levels_system_id ON public.levels (system_id, position);

COMMENT ON COLUMN public.levels.stage IS
  'School stage (primary | middle | high). Required for levels of the Algerian school system, absent for every other system.';

-- A level's system is fixed, a school level has its stage, no other level has one. A level
-- created without a system (the existing Levels screen sends none) is a school level.
CREATE OR REPLACE FUNCTION public.enforce_level_system()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _kind text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.system_id IS NULL THEN
    SELECT id INTO NEW.system_id FROM public.level_systems WHERE code = 'algerian_school';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.system_id IS DISTINCT FROM OLD.system_id THEN
    RAISE EXCEPTION 'A level cannot move to another level system.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT kind INTO _kind FROM public.level_systems WHERE id = NEW.system_id;
  IF _kind = 'school' AND NEW.stage IS NULL THEN
    RAISE EXCEPTION 'An Algerian school level needs its stage (primary, middle or high).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF _kind IS DISTINCT FROM 'school' AND NEW.stage IS NOT NULL THEN
    RAISE EXCEPTION 'Only Algerian school levels have a school stage.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_level_system() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_levels_system ON public.levels;
CREATE TRIGGER t_levels_system
  BEFORE INSERT OR UPDATE OF system_id, stage ON public.levels
  FOR EACH ROW EXECUTE FUNCTION public.enforce_level_system();

-- CEFR and Training: real levels of their own systems, no stage.
INSERT INTO public.levels (system_id, code, name, stage, position, status)
SELECT s.id, v.code, v.name, NULL, v.position, 'active'
  FROM public.level_systems s
  JOIN (VALUES
          ('cefr', 'A1', 'A1', 1), ('cefr', 'A2', 'A2', 2), ('cefr', 'B1', 'B1', 3),
          ('cefr', 'B2', 'B2', 4), ('cefr', 'C1', 'C1', 5), ('cefr', 'C2', 'C2', 6),
          ('training', 'beginner', 'Débutant', 1),
          ('training', 'intermediate', 'Intermédiaire', 2),
          ('training', 'advanced', 'Avancé', 3)
       ) AS v (system_code, code, name, position) ON v.system_code = s.code
 WHERE NOT EXISTS (
   SELECT 1 FROM public.levels l WHERE l.system_id = s.id AND lower(l.code) = lower(v.code)
 );

-- ------------------------------------------------------------------
-- 3. School-only uses of a level
-- ------------------------------------------------------------------

-- Streams (filières) exist only inside school years, and a student's level is their SCHOOL
-- identity (eligibility compares it with school-level groups). Neither may point at a CEFR,
-- training or custom level.
CREATE OR REPLACE FUNCTION public.enforce_school_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.level_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.levels l JOIN public.level_systems s ON s.id = l.system_id
     WHERE l.id = NEW.level_id AND s.kind = 'school'
  ) THEN
    RAISE EXCEPTION '%', CASE TG_TABLE_NAME
        WHEN 'streams' THEN 'A stream belongs to an Algerian school level.'
        ELSE 'A student''s level is a school level (primary, middle or high school).' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_school_level() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_streams_school_level ON public.streams;
CREATE TRIGGER t_streams_school_level
  BEFORE INSERT OR UPDATE OF level_id ON public.streams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_school_level();

DROP TRIGGER IF EXISTS t_students_school_level ON public.students;
CREATE TRIGGER t_students_school_level
  BEFORE INSERT OR UPDATE OF level_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_school_level();

-- ------------------------------------------------------------------
-- 4. Formations reference a level system
-- ------------------------------------------------------------------

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS level_system_id uuid REFERENCES public.level_systems (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_programs_level_system_id ON public.programs (level_system_id);

COMMENT ON COLUMN public.programs.level_system_id IS
  'The formation''s level scale. NULL = no specific level. When level_id is set it must belong to this system (filled from the level when omitted).';

-- Existing formations with a level: their system is that level's (all school today).
UPDATE public.programs p
   SET level_system_id = l.system_id
  FROM public.levels l
 WHERE l.id = p.level_id AND p.level_system_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_program_level_system()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _system uuid;
BEGIN
  IF NEW.level_id IS NULL THEN RETURN NEW; END IF;
  SELECT system_id INTO _system FROM public.levels WHERE id = NEW.level_id;
  IF NEW.level_system_id IS NULL THEN
    NEW.level_system_id := _system;
  ELSIF NEW.level_system_id IS DISTINCT FROM _system THEN
    RAISE EXCEPTION 'This level does not belong to the formation''s level system.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_program_level_system() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_programs_level_system ON public.programs;
CREATE TRIGGER t_programs_level_system
  BEFORE INSERT OR UPDATE OF level_id, level_system_id ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.sync_program_level_system();

-- create_formation (20261003110000) also accepts the system now; the trigger above fills it
-- from the level when omitted, as today's form does. Body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.create_formation(formation jsonb, first_group jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  _program public.programs;
  _group_id uuid;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can create formations.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF COALESCE(formation->>'status', 'draft') NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'A new formation starts as a draft or active.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.programs (
    name, category, status, registration_open, description, curriculum,
    level_system_id, level_id, subject_id, start_date, end_date, duration_hours
  )
  VALUES (
    formation->>'name',
    COALESCE(formation->>'category', 'other'),
    COALESCE(formation->>'status', 'draft'),
    false,
    NULLIF(btrim(formation->>'description'), ''),
    NULLIF(btrim(formation->>'curriculum'), ''),
    (formation->>'level_system_id')::uuid,
    (formation->>'level_id')::uuid,
    (formation->>'subject_id')::uuid,
    (formation->>'start_date')::date,
    (formation->>'end_date')::date,
    (formation->>'duration_hours')::int
  )
  RETURNING * INTO _program;

  IF first_group IS NOT NULL AND jsonb_typeof(first_group) = 'object' THEN
    INSERT INTO public.groups (
      name, program_id, subject_id, level_id, stream_id, teacher_id,
      max_students, price_dzd, status, start_date, end_date
    )
    VALUES (
      first_group->>'name',
      _program.id,
      _program.subject_id,
      _program.level_id,
      (first_group->>'stream_id')::uuid,
      (first_group->>'teacher_id')::uuid,
      COALESCE((first_group->>'max_students')::int, 20),
      0,
      COALESCE(first_group->>'status', 'active')::public.entity_status,
      COALESCE((first_group->>'start_date')::date, current_date),
      (first_group->>'end_date')::date
    )
    RETURNING id INTO _group_id;

    INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room)
    SELECT _group_id, s.weekday, s.start_time, s.end_time, NULLIF(btrim(s.room), '')
      FROM jsonb_to_recordset(COALESCE(first_group->'schedules', '[]'::jsonb))
           AS s(weekday int, start_time time, end_time time, room text);
  END IF;

  RETURN jsonb_build_object('program_id', _program.id, 'group_id', _group_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_formation(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_formation(jsonb, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE
  _school uuid := (SELECT id FROM public.level_systems WHERE code = 'algerian_school');
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.level_systems
   WHERE built_in AND (code, kind) IN (('algerian_school', 'school'), ('cefr', 'cefr'),
                                       ('training', 'training'), ('custom', 'custom'));
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 built-in level systems, found %', n; END IF;

  SELECT count(*) INTO n FROM public.levels
   WHERE system_id = _school AND (stage IS NULL OR code !~ '^[1-5]A[PMS]$');
  IF n > 0 THEN RAISE EXCEPTION '% school level(s) without a stage or a 1AP..3AS code', n; END IF;

  SELECT count(*) INTO n FROM public.levels l JOIN public.level_systems s ON s.id = l.system_id
   WHERE s.code = 'cefr' AND l.code IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2') AND l.stage IS NULL;
  IF n <> 6 THEN RAISE EXCEPTION 'expected the 6 CEFR levels without stage, found %', n; END IF;

  SELECT count(*) INTO n FROM public.levels l JOIN public.level_systems s ON s.id = l.system_id
   WHERE s.code = 'training' AND l.code IN ('beginner', 'intermediate', 'advanced') AND l.stage IS NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'expected the 3 training levels without stage, found %', n; END IF;

  SELECT count(*) INTO n FROM public.programs p LEFT JOIN public.levels l ON l.id = p.level_id
   WHERE p.level_id IS NOT NULL AND p.level_system_id IS DISTINCT FROM l.system_id;
  IF n > 0 THEN RAISE EXCEPTION '% formation(s) whose level is outside their level system', n; END IF;

  SELECT count(*) INTO n FROM public.streams st JOIN public.levels l ON l.id = st.level_id
   WHERE l.system_id <> _school;
  IF n > 0 THEN RAISE EXCEPTION '% stream(s) on a non-school level', n; END IF;

  SELECT count(*) INTO n FROM public.students st JOIN public.levels l ON l.id = st.level_id
   WHERE l.system_id <> _school;
  IF n > 0 THEN RAISE EXCEPTION '% student(s) with a non-school level', n; END IF;
END $$;
