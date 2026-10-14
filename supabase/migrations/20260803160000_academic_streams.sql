-- Task 2A: academic streams (filières) -- database foundation.
--
-- Algerian secondary education splits into streams. 1AS has two common trunks
-- (Sciences & Technology, Arts); 2AS and 3AS each offer the same six
-- specialisations. Primary and middle school have none.
--
-- Modelling this correctly matters because a "2AS Mathématiques" group and a
-- "2AS Lettres et Philosophie" group are different products with different
-- subjects, teachers and students.
--
-- DESIGN NOTE -- why a dedicated table rather than expanding `levels`:
--
-- Encoding the stream into the level name ("2AS Sciences") would fuse two
-- independent facts into one string. It becomes impossible to ask "how many 2AS
-- students do we have?" without pattern-matching, it orphans every row already
-- referencing the 12 existing levels, and it multiplies again on any future
-- axis. A stream therefore hangs off a level, so:
--   * primary and middle levels simply have no stream rows -- no special case;
--   * `stream_id` stays NULL wherever streams do not apply;
--   * adding or renaming a stream is a data change, never a deploy.
--
-- This migration is DATABASE + DATA LAYER only. No UI depends on it yet.

-- ------------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id uuid NOT NULL REFERENCES public.levels(id) ON DELETE CASCADE,
  -- Stable machine key. Display names may be edited by a centre; `code` is what
  -- seeds, migrations and any future integration match on, so it never changes.
  code text NOT NULL,
  -- Names are columns rather than i18n keys because streams are administrative
  -- data a centre can maintain, unlike fixed UI chrome.
  name_fr text NOT NULL,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT streams_code_not_blank CHECK (length(btrim(code)) BETWEEN 2 AND 40),
  CONSTRAINT streams_name_fr_not_blank CHECK (length(btrim(name_fr)) BETWEEN 2 AND 120),
  CONSTRAINT streams_name_ar_not_blank CHECK (length(btrim(name_ar)) BETWEEN 2 AND 120),
  CONSTRAINT streams_name_en_not_blank CHECK (length(btrim(name_en)) BETWEEN 2 AND 120),
  -- The same code appears under 2AS and 3AS as separate rows, so uniqueness is
  -- scoped to the level, not global.
  CONSTRAINT streams_code_per_level UNIQUE (level_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.streams TO authenticated;
GRANT ALL ON public.streams TO service_role;
ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;

-- Reference data, same policy shape as `levels` and `subjects`: any signed-in
-- user reads it (a student needs it during onboarding, before they have any
-- academic identity), only admins maintain it. `anon` gets nothing, consistent
-- with the Phase 0 grant hardening.
DROP POLICY IF EXISTS "streams read" ON public.streams;
CREATE POLICY "streams read" ON public.streams
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "streams write" ON public.streams;
CREATE POLICY "streams write" ON public.streams
FOR ALL TO authenticated
USING (private.is_admin()) WITH CHECK (private.is_admin());

-- Every read is "streams for this level, in curriculum order".
CREATE INDEX IF NOT EXISTS idx_streams_level_id ON public.streams (level_id, position);

DROP TRIGGER IF EXISTS t_streams_updated ON public.streams;
CREATE TRIGGER t_streams_updated
BEFORE UPDATE ON public.streams
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------
-- 2. Seed the official structure
-- ------------------------------------------------------------------

-- 1AS: two common trunks.
INSERT INTO public.streams (level_id, code, name_fr, name_ar, name_en, position)
SELECT l.id, v.code, v.name_fr, v.name_ar, v.name_en, v.position
FROM public.levels l
CROSS JOIN (VALUES
  ('common_sciences', 'Sciences et technologie', 'علوم وتكنولوجيا', 'Common Sciences & Technology', 1),
  ('common_arts',     'Lettres',                 'آداب',           'Common Arts',                  2)
) AS v(code, name_fr, name_ar, name_en, position)
WHERE l.stage = 'high' AND l.position = 10   -- 1AS
ON CONFLICT (level_id, code) DO NOTHING;

-- 2AS and 3AS: the same six specialisations.
INSERT INTO public.streams (level_id, code, name_fr, name_ar, name_en, position)
SELECT l.id, v.code, v.name_fr, v.name_ar, v.name_en, v.position
FROM public.levels l
CROSS JOIN (VALUES
  ('sciences',   'Sciences expérimentales', 'علوم تجريبية',  'Experimental Sciences',   1),
  ('maths',      'Mathématiques',           'رياضيات',       'Mathematics',             2),
  ('tech_maths', 'Technique mathématique',  'تقني رياضي',    'Technical Mathematics',   3),
  ('economics',  'Gestion et économie',     'تسيير واقتصاد', 'Management & Economics',  4),
  ('languages',  'Langues étrangères',      'لغات أجنبية',   'Foreign Languages',       5),
  ('literature', 'Lettres et philosophie',  'آداب وفلسفة',   'Literature & Philosophy', 6)
) AS v(code, name_fr, name_ar, name_en, position)
WHERE l.stage = 'high' AND l.position IN (11, 12)   -- 2AS, 3AS
ON CONFLICT (level_id, code) DO NOTHING;

-- ------------------------------------------------------------------
-- 3. Wire students and groups to streams
-- ------------------------------------------------------------------

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS stream_id uuid REFERENCES public.streams(id) ON DELETE SET NULL;

ALTER TABLE public.groups
  -- NULL is meaningful: a group with no stream is open to every stream of its
  -- level (a revision class the whole year attends). This also means existing
  -- groups keep working untouched.
  ADD COLUMN IF NOT EXISTS stream_id uuid REFERENCES public.streams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_stream_id ON public.students (stream_id);
CREATE INDEX IF NOT EXISTS idx_groups_stream_id   ON public.groups (stream_id);

-- ------------------------------------------------------------------
-- 4. Integrity: a stream must belong to the row's own level
--
-- A CHECK constraint cannot query another table, so this is a trigger -- the
-- appropriate PostgreSQL tool for a cross-table invariant. Without it a 2AS
-- student could be given a 3AS stream: silently wrong, and it would corrupt
-- every downstream statistic and group filter.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_stream_matches_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE stream_level uuid;
BEGIN
  IF NEW.stream_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.level_id IS NULL THEN
    RAISE EXCEPTION 'A stream cannot be assigned without a level'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT level_id INTO stream_level FROM public.streams WHERE id = NEW.stream_id;

  IF stream_level IS NULL THEN
    RAISE EXCEPTION 'Stream % does not exist', NEW.stream_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF stream_level <> NEW.level_id THEN
    RAISE EXCEPTION 'Stream % does not belong to level %', NEW.stream_id, NEW.level_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.validate_stream_matches_level() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t_students_stream_valid ON public.students;
CREATE TRIGGER t_students_stream_valid
BEFORE INSERT OR UPDATE OF stream_id, level_id ON public.students
FOR EACH ROW EXECUTE FUNCTION public.validate_stream_matches_level();

DROP TRIGGER IF EXISTS t_groups_stream_valid ON public.groups;
CREATE TRIGGER t_groups_stream_valid
BEFORE INSERT OR UPDATE OF stream_id, level_id ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.validate_stream_matches_level();

-- ------------------------------------------------------------------
-- 5. Safety assertion
--
-- The onboarding CHECK from 20260803120000 is deliberately left as-is: making
-- a stream mandatory for stream-bearing levels is an onboarding rule, and the
-- onboarding UI is out of scope for this task. Adding it now would lock out
-- students on 1AS/2AS/3AS who onboarded before streams existed.
--
-- This block asserts the migration did not silently strand anyone.
-- ------------------------------------------------------------------
DO $$
DECLARE seeded int; wrong int;
BEGIN
  SELECT count(*) INTO seeded FROM public.streams;
  IF seeded < 14 THEN
    RAISE EXCEPTION 'Expected at least 14 seeded streams, found %', seeded;
  END IF;

  SELECT count(*) INTO wrong
  FROM public.students s
  JOIN public.streams st ON st.id = s.stream_id
  WHERE st.level_id <> s.level_id;
  IF wrong > 0 THEN
    RAISE EXCEPTION '% student(s) reference a stream from another level', wrong;
  END IF;

  RAISE NOTICE 'Streams migration OK: % streams seeded.', seeded;
END $$;
