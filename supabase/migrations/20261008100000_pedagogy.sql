-- ==================================================================
-- Pédagogie (ADR-008): lesson log, assessments and scores, academic periods, report-card remarks,
-- chapter completion.
--
-- Permission model (unchanged): a group's teacher or an administrator manages its pedagogy
-- (can_manage_group); an enrolled student reads what concerns them (is_enrolled_in_group, own
-- rows, published only). Other teachers and anonymous visitors see nothing.
--
-- ROLLBACK
--   DROP TABLE public.report_comments, public.assessment_scores, public.assessments,
--     public.lesson_entries, public.academic_periods;
--   ALTER TABLE public.chapters DROP COLUMN completed_on;
--   DROP FUNCTION public.validate_session_date(), public.validate_lesson_entry(),
--     public.validate_assessment_score(), public.guard_assessment_max();
-- ==================================================================

-- ------------------------------------------------------------------ session dates
-- The attendance rule, for any table keyed by (group_id, <date column>).
CREATE OR REPLACE FUNCTION public.validate_session_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  -- The date column is named by the trigger (TG_ARGV[0]): session_date or held_on.
  _date    date := (to_jsonb(NEW) ->> TG_ARGV[0])::date;
  _start   date;
  _end     date;
  _slots   boolean;
BEGIN
  SELECT start_date, end_date INTO _start, _end FROM public.groups WHERE id = NEW.group_id;
  IF _start IS NOT NULL AND _date < _start THEN
    RAISE EXCEPTION 'The date % is before the group starts (%).', _date, _start USING ERRCODE = 'check_violation';
  END IF;
  IF _end IS NOT NULL AND _date > _end THEN
    RAISE EXCEPTION 'The date % is after the group ends (%).', _date, _end USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.group_schedules WHERE group_id = NEW.group_id) INTO _slots;
  IF _slots AND NOT EXISTS (
       SELECT 1 FROM public.group_schedules
        WHERE group_id = NEW.group_id AND weekday = EXTRACT(DOW FROM _date)) THEN
    RAISE EXCEPTION 'The group does not meet on % (weekday %).', _date, EXTRACT(DOW FROM _date)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_session_date() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ cahier de textes
CREATE TABLE IF NOT EXISTS public.lesson_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  session_date date NOT NULL,
  chapter_id   uuid REFERENCES public.chapters (id) ON DELETE SET NULL,
  summary      text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 4000),
  homework     text CHECK (homework IS NULL OR length(btrim(homework)) BETWEEN 1 AND 2000),
  homework_due date,
  created_by   uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_entries_one_per_session UNIQUE (group_id, session_date),
  CONSTRAINT lesson_entries_homework_due CHECK (
    homework_due IS NULL OR (homework IS NOT NULL AND homework_due >= session_date))
);
CREATE INDEX IF NOT EXISTS lesson_entries_chapter_idx ON public.lesson_entries (chapter_id) WHERE chapter_id IS NOT NULL;

COMMENT ON TABLE public.lesson_entries IS
  'Cahier de textes: what was covered in a session (group, date -- the ADR-003 key), its chapter, '
  'and homework. Written by the group''s teacher or an administrator.';

-- The chapter must belong to the same group; stamps the editor.
CREATE OR REPLACE FUNCTION public.validate_lesson_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.chapter_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.chapters WHERE id = NEW.chapter_id AND group_id = NEW.group_id) THEN
    RAISE EXCEPTION 'This chapter belongs to another group.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.group_id <> OLD.group_id OR NEW.session_date <> OLD.session_date) THEN
    RAISE EXCEPTION 'An entry stays on its session.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_lesson_entry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_lesson_entries_date ON public.lesson_entries;
CREATE TRIGGER t_lesson_entries_date BEFORE INSERT OR UPDATE OF session_date, group_id ON public.lesson_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_date('session_date');
DROP TRIGGER IF EXISTS t_lesson_entries_valid ON public.lesson_entries;
CREATE TRIGGER t_lesson_entries_valid BEFORE INSERT OR UPDATE ON public.lesson_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_lesson_entry();
DROP TRIGGER IF EXISTS t_lesson_entries_updated ON public.lesson_entries;
CREATE TRIGGER t_lesson_entries_updated BEFORE UPDATE ON public.lesson_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lesson_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lesson entries read" ON public.lesson_entries;
CREATE POLICY "lesson entries read" ON public.lesson_entries FOR SELECT TO authenticated
  USING (can_manage_group(group_id) OR is_enrolled_in_group(group_id));
DROP POLICY IF EXISTS "lesson entries write" ON public.lesson_entries;
CREATE POLICY "lesson entries write" ON public.lesson_entries FOR ALL TO authenticated
  USING (can_manage_group(group_id)) WITH CHECK (can_manage_group(group_id));
REVOKE ALL ON public.lesson_entries FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_entries TO authenticated;

-- ------------------------------------------------------------------ periods
CREATE TABLE IF NOT EXISTS public.academic_periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  academic_year text CHECK (academic_year IS NULL OR length(academic_year) <= 20),
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_periods_dates CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS academic_periods_name_unique
  ON public.academic_periods (coalesce(academic_year, ''), lower(btrim(name)));
COMMENT ON TABLE public.academic_periods IS
  'School periods (trimesters). An assessment belongs to the period containing its date.';

DROP TRIGGER IF EXISTS t_academic_periods_updated ON public.academic_periods;
CREATE TRIGGER t_academic_periods_updated BEFORE UPDATE ON public.academic_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.academic_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "periods read" ON public.academic_periods;
CREATE POLICY "periods read" ON public.academic_periods FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "periods admin write" ON public.academic_periods;
CREATE POLICY "periods admin write" ON public.academic_periods FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());
REVOKE ALL ON public.academic_periods FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_periods TO authenticated;

-- ------------------------------------------------------------------ assessments
CREATE TABLE IF NOT EXISTS public.assessments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  kind        text NOT NULL DEFAULT 'test'
              CHECK (kind IN ('exam', 'test', 'quiz', 'homework', 'oral', 'project')),
  held_on     date NOT NULL,
  max_score   numeric(5, 2) NOT NULL DEFAULT 20 CHECK (max_score > 0 AND max_score <= 100),
  coefficient numeric(4, 2) NOT NULL DEFAULT 1 CHECK (coefficient > 0 AND coefficient <= 10),
  published   boolean NOT NULL DEFAULT false,
  created_by  uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessments_group_idx ON public.assessments (group_id, held_on);
COMMENT ON TABLE public.assessments IS
  'Tests and exams of a group. Scores in assessment_scores; students see them once published.';

CREATE TABLE IF NOT EXISTS public.assessment_scores (
  assessment_id uuid NOT NULL REFERENCES public.assessments (id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.students (id) ON DELETE CASCADE,
  score         numeric(5, 2) CHECK (score IS NULL OR score >= 0),
  absent        boolean NOT NULL DEFAULT false,
  comment       text CHECK (comment IS NULL OR length(comment) <= 300),
  updated_by    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, student_id),
  CONSTRAINT assessment_scores_absent_or_score CHECK (NOT (absent AND score IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS assessment_scores_student_idx ON public.assessment_scores (student_id);

-- A score is within the maximum, for a student enrolled in the group.
CREATE OR REPLACE FUNCTION public.validate_assessment_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _a public.assessments;
BEGIN
  SELECT * INTO _a FROM public.assessments WHERE id = NEW.assessment_id;
  IF NEW.score IS NOT NULL AND NEW.score > _a.max_score THEN
    RAISE EXCEPTION 'A score cannot exceed % (the maximum of this assessment).', _a.max_score
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.registrations r
                  WHERE r.group_id = _a.group_id AND r.student_id = NEW.student_id
                    AND r.status IN ('approved', 'withdrawn')) THEN
    RAISE EXCEPTION 'This student is not enrolled in the group.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_assessment_score() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_assessment_scores_valid ON public.assessment_scores;
CREATE TRIGGER t_assessment_scores_valid BEFORE INSERT OR UPDATE ON public.assessment_scores
  FOR EACH ROW EXECUTE FUNCTION public.validate_assessment_score();

-- The maximum cannot drop below a score already given; an assessment stays in its group.
CREATE OR REPLACE FUNCTION public.guard_assessment_max()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.group_id <> OLD.group_id THEN
    RAISE EXCEPTION 'An assessment stays in its group.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.max_score < OLD.max_score AND EXISTS (
       SELECT 1 FROM public.assessment_scores WHERE assessment_id = NEW.id AND score > NEW.max_score) THEN
    RAISE EXCEPTION 'Some scores are above % : correct them before lowering the maximum.', NEW.max_score
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_assessment_max() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_assessments_guard ON public.assessments;
CREATE TRIGGER t_assessments_guard BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_max();
DROP TRIGGER IF EXISTS t_assessments_date ON public.assessments;
CREATE TRIGGER t_assessments_date BEFORE INSERT OR UPDATE OF held_on, group_id ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_date('held_on');
DROP TRIGGER IF EXISTS t_assessments_updated ON public.assessments;
CREATE TRIGGER t_assessments_updated BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assessments read" ON public.assessments;
CREATE POLICY "assessments read" ON public.assessments FOR SELECT TO authenticated
  USING (can_manage_group(group_id) OR (published AND is_enrolled_in_group(group_id)));
DROP POLICY IF EXISTS "assessments write" ON public.assessments;
CREATE POLICY "assessments write" ON public.assessments FOR ALL TO authenticated
  USING (can_manage_group(group_id)) WITH CHECK (can_manage_group(group_id));
DROP POLICY IF EXISTS "scores read" ON public.assessment_scores;
CREATE POLICY "scores read" ON public.assessment_scores FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessments a WHERE a.id = assessment_id
                  AND (can_manage_group(a.group_id) OR (a.published AND student_id = auth.uid()))));
DROP POLICY IF EXISTS "scores write" ON public.assessment_scores;
CREATE POLICY "scores write" ON public.assessment_scores FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessments a WHERE a.id = assessment_id AND can_manage_group(a.group_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assessments a WHERE a.id = assessment_id AND can_manage_group(a.group_id)));
REVOKE ALL ON public.assessments, public.assessment_scores FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessments, public.assessment_scores TO authenticated;

-- ------------------------------------------------------------------ report-card remarks
CREATE TABLE IF NOT EXISTS public.report_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id  uuid NOT NULL REFERENCES public.academic_periods (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students (id) ON DELETE CASCADE,
  group_id   uuid REFERENCES public.groups (id) ON DELETE CASCADE,
  comment    text NOT NULL CHECK (length(btrim(comment)) BETWEEN 1 AND 500),
  updated_by uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS report_comments_one
  ON public.report_comments (period_id, student_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE public.report_comments IS
  'Report-card remarks: per group (its teacher or an administrator) or general (group NULL, '
  'administrators). Students read their own.';

DROP TRIGGER IF EXISTS t_report_comments_updated ON public.report_comments;
CREATE TRIGGER t_report_comments_updated BEFORE UPDATE ON public.report_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.report_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "report comments read" ON public.report_comments;
CREATE POLICY "report comments read" ON public.report_comments FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR private.is_admin() OR (group_id IS NOT NULL AND can_manage_group(group_id)));
DROP POLICY IF EXISTS "report comments write" ON public.report_comments;
CREATE POLICY "report comments write" ON public.report_comments FOR ALL TO authenticated
  USING (private.is_admin() OR (group_id IS NOT NULL AND can_manage_group(group_id)))
  WITH CHECK (private.is_admin() OR (group_id IS NOT NULL AND can_manage_group(group_id)));
REVOKE ALL ON public.report_comments FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_comments TO authenticated;

-- ------------------------------------------------------------------ chapter completion
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS completed_on date;
COMMENT ON COLUMN public.chapters.completed_on IS
  'Marked done by the group''s teacher or an administrator (Progression). NULL = not marked.';

-- ------------------------------------------------------------------ post-conditions
DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['lesson_entries', 'academic_periods', 'assessments', 'assessment_scores', 'report_comments'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || _t)::regclass) THEN
      RAISE EXCEPTION 'SECURITY: RLS is not enabled on %', _t;
    END IF;
    IF has_table_privilege('anon', 'public.' || _t, 'SELECT') THEN
      RAISE EXCEPTION 'SECURITY: anon can read %', _t;
    END IF;
  END LOOP;
  RAISE NOTICE 'Pedagogy installed.';
END $$;
