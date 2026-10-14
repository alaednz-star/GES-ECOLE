-- ==================================================================
-- Programmes: the educational offering above groups.
--
-- WHY THIS MIGRATION EXISTS
--
-- Everything operational already lives on `groups`: the teacher, the subject, the level and
-- stream, the capacity, the weekly schedule, attendance, course resources and registrations
-- (and through them, payments). What the schema cannot say is WHAT IS BEING OFFERED --
-- "English B1, 3 months", "Excel Advanced, 30 hours", "BAC Mathematics preparation" -- as one
-- named thing with a category, a lifecycle, a description and a curriculum, run as one or
-- more groups. A centre that is not a tutoring centre has no way to describe itself today.
--
-- THE MODEL
--
--   programs 1 ── * groups 1 ── * registrations ── * payments
--
-- A programme is optional for a group, and a group keeps every capability it has. Nothing
-- existing is reinterpreted: every current group simply has `program_id IS NULL` and behaves
-- exactly as before.
--
-- WHAT IS DELIBERATELY NOT STORED ON A PROGRAMME
--
--   - capacity   A seat exists only in a group (`groups.max_students`); a programme's
--                capacity is the sum over its groups. A second number would be a second
--                source of truth that disagrees with the first.
--   - teachers   The people teaching are `groups.teacher_id`. Derived, never copied.
--   - price      Billing is the future Fee Types / Payment Plans architecture, which will
--                reference `program_id`. A price column now would repeat the ambiguity of
--                `groups.price_dzd`, which has no billing period.
--   - stream     A stream is an attribute of a class (`groups.stream_id`); a BAC programme
--                can run one group per stream.
--
-- OPTIONAL BY DESIGN
--
--   Level, subject, dates and duration are all nullable. Academic support uses level and
--   subject; a language course uses a level but no subject; a professional formation uses
--   neither. When a programme DOES name a level or subject, its groups must match it -- that
--   is enforced below, in both directions, so a "3AS Mathematics" programme cannot quietly
--   contain a physics group.
--
-- LIFECYCLE
--
--   status: draft -> active -> completed | cancelled -> archived (text + CHECK, like
--   payments.method: widening a CHECK is trivial, adding to an enum cannot share a
--   transaction with its first use). `registration_open` is separate from status because a
--   running course may still be enrolling; it is only allowed while the programme is active.
--
-- REGISTRATIONS ARE UNCHANGED. A student still registers into a group; the programme is
-- reached through the group. Eligibility (`private.can_join_group`) is not touched here.
--
-- ROLLBACK
--   drop trigger if exists t_groups_program_consistent on public.groups;
--   drop trigger if exists t_programs_groups_consistent on public.programs;
--   drop function if exists public.validate_group_program();
--   drop function if exists public.validate_program_groups();
--   alter table public.groups drop column if exists program_id;
--   drop table if exists public.programs;
-- ==================================================================

CREATE TABLE IF NOT EXISTS public.programs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category          text NOT NULL DEFAULT 'other'
                      CHECK (category IN ('academic_support', 'language', 'exam_preparation',
                                          'professional_training', 'workshop', 'other')),
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'archived')),
  registration_open boolean NOT NULL DEFAULT false,
  description       text CHECK (description IS NULL OR length(description) <= 2000),
  curriculum        text CHECK (curriculum IS NULL OR length(curriculum) <= 5000),
  level_id          uuid REFERENCES public.levels (id) ON DELETE SET NULL,
  subject_id        uuid REFERENCES public.subjects (id) ON DELETE SET NULL,
  start_date        date,
  end_date          date,
  duration_hours    int CHECK (duration_hours IS NULL OR duration_hours BETWEEN 1 AND 10000),
  created_by        uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT programs_date_range_valid CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  -- Registrations can only be open on a programme that is actually running.
  CONSTRAINT programs_registration_needs_active CHECK (NOT registration_open OR status = 'active')
);

-- Two live programmes with the same name would be indistinguishable in every picker. An
-- archived one frees its name, so "English B1" can run again next year.
CREATE UNIQUE INDEX IF NOT EXISTS programs_name_live_unique
  ON public.programs (lower(btrim(name)))
  WHERE status <> 'archived';
CREATE INDEX IF NOT EXISTS idx_programs_status ON public.programs (status);

DROP TRIGGER IF EXISTS t_programs_touch ON public.programs;
CREATE TRIGGER t_programs_touch
  BEFORE UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.programs IS
  'An educational offering (course, formation, preparation programme, workshop) run as one or more groups. Capacity, teachers and prices are NOT stored here: they are derived from, or will reference, the groups and the future billing tables.';

-- ------------------------------------------------------------------
-- groups.program_id
--
-- RESTRICT: a programme with groups cannot be deleted -- it is archived instead, which keeps
-- the history of what those groups were part of. Deleting a GROUP is unaffected.
-- ------------------------------------------------------------------

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.programs (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_groups_program_id ON public.groups (program_id);

COMMENT ON COLUMN public.groups.program_id IS
  'Optional programme this group runs. NULL for standalone groups, which behave exactly as before programmes existed.';

-- ------------------------------------------------------------------
-- Consistency: a group's level/subject must match its programme's, when the programme names one
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_group_program()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  p public.programs;
BEGIN
  IF NEW.program_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO p FROM public.programs WHERE id = NEW.program_id;
  IF p.level_id IS NOT NULL AND NEW.level_id IS DISTINCT FROM p.level_id THEN
    RAISE EXCEPTION 'This group''s level does not match the level of programme "%".', p.name
      USING ERRCODE = 'check_violation';
  END IF;
  IF p.subject_id IS NOT NULL AND NEW.subject_id IS DISTINCT FROM p.subject_id THEN
    RAISE EXCEPTION 'This group''s subject does not match the subject of programme "%".', p.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_group_program() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_groups_program_consistent ON public.groups;
CREATE TRIGGER t_groups_program_consistent
  BEFORE INSERT OR UPDATE OF program_id, level_id, subject_id ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.validate_group_program();

-- The other direction: narrowing a programme to a level/subject its groups do not share.
CREATE OR REPLACE FUNCTION public.validate_program_groups()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.groups g
   WHERE g.program_id = NEW.id
     AND ((NEW.level_id IS NOT NULL AND g.level_id IS DISTINCT FROM NEW.level_id)
       OR (NEW.subject_id IS NOT NULL AND g.subject_id IS DISTINCT FROM NEW.subject_id));
  IF n > 0 THEN
    RAISE EXCEPTION '% group(s) of this programme do not match the new level or subject.', n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_program_groups() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_programs_groups_consistent ON public.programs;
CREATE TRIGGER t_programs_groups_consistent
  BEFORE UPDATE OF level_id, subject_id ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.validate_program_groups();

-- ------------------------------------------------------------------
-- Security
--
-- Administrators manage programmes. A teacher reads the programmes their own groups belong
-- to -- nothing wider. Students are not granted anything: no student surface exists for
-- programmes yet, and the future student catalogue will decide what they may see. Anonymous
-- visitors hold no privilege at all (same as every table but the 13 branding columns).
-- ------------------------------------------------------------------

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;

DROP POLICY IF EXISTS "programs read" ON public.programs;
CREATE POLICY "programs read" ON public.programs
  FOR SELECT TO authenticated
  USING (
    private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.groups g
       WHERE g.program_id = programs.id
         AND g.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "programs admin write" ON public.programs;
CREATE POLICY "programs admin write" ON public.programs
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.programs'::regclass) THEN
    RAISE EXCEPTION 'SECURITY: RLS is not enabled on public.programs';
  END IF;
  IF has_table_privilege('anon', 'public.programs', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY: anon must hold no privilege on public.programs';
  END IF;
  IF (SELECT confdeltype FROM pg_constraint
       WHERE conrelid = 'public.groups'::regclass AND conname = 'groups_program_id_fkey') <> 'r' THEN
    RAISE EXCEPTION 'groups.program_id must be ON DELETE RESTRICT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.groups WHERE program_id IS NOT NULL) THEN
    RAISE EXCEPTION 'no existing group may be attached to a programme by this migration';
  END IF;
  RAISE NOTICE 'Programmes installed; every existing group is standalone.';
END $$;
