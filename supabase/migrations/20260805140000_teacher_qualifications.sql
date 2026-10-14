-- Teacher qualification system.
--
-- `public.teacher_subjects` already models the many-to-many relationship
-- (composite PK on teacher_id + subject_id, both FKs). What was missing is
-- enforcement: nothing stopped a group from assigning a maths teacher to a
-- physics class, so the join table was documentation rather than a rule.
--
-- This migration adds:
--   1. a backfill inferring qualifications from existing group assignments;
--   2. a trigger rejecting any group whose teacher is not qualified for its
--      subject, on both INSERT and UPDATE.
--
-- The join table itself is left untouched -- it is already correct.

-- ------------------------------------------------------------------
-- 1. Backfill
--
-- Infer ONLY what the data already asserts: if a teacher is currently running
-- a group in a subject, they are evidently qualified for that subject. No
-- additional subjects are guessed -- an admin decides those.
-- ------------------------------------------------------------------

INSERT INTO public.teacher_subjects (teacher_id, subject_id)
SELECT DISTINCT g.teacher_id, g.subject_id
FROM public.groups g
WHERE g.teacher_id IS NOT NULL
  AND g.subject_id IS NOT NULL
ON CONFLICT (teacher_id, subject_id) DO NOTHING;

-- ------------------------------------------------------------------
-- 2. Integrity: a group's teacher must be qualified for its subject
--
-- A CHECK constraint cannot query another table, so this is a trigger -- the
-- appropriate PostgreSQL tool for a cross-table invariant.
--
-- Deliberately permissive in two cases, because both are legitimate mid-setup
-- states rather than errors:
--   * teacher_id IS NULL  -> group not yet staffed;
--   * subject_id IS NULL  -> subject not yet chosen.
-- The rule only bites once both are set.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_teacher_qualification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.teacher_id IS NULL OR NEW.subject_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teacher_subjects ts
    WHERE ts.teacher_id = NEW.teacher_id
      AND ts.subject_id = NEW.subject_id
  ) THEN
    RAISE EXCEPTION
      'Teacher % is not qualified to teach subject %', NEW.teacher_id, NEW.subject_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.validate_teacher_qualification() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t_groups_teacher_qualified ON public.groups;
CREATE TRIGGER t_groups_teacher_qualified
BEFORE INSERT OR UPDATE OF teacher_id, subject_id ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.validate_teacher_qualification();

-- ------------------------------------------------------------------
-- 3. Removing a qualification must not orphan an existing assignment
--
-- Without this, an admin unticking a subject on the teacher form would leave
-- groups pointing at a teacher who is no longer qualified -- exactly the state
-- this feature exists to prevent. Blocking the delete forces the admin to
-- reassign the group first, which is the honest order of operations.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_teacher_qualification_in_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE in_use int;
BEGIN
  SELECT count(*) INTO in_use
  FROM public.groups g
  WHERE g.teacher_id = OLD.teacher_id
    AND g.subject_id = OLD.subject_id;

  IF in_use > 0 THEN
    RAISE EXCEPTION
      'Cannot remove this qualification: the teacher is assigned to % group(s) in this subject', in_use
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END; $function$;

REVOKE ALL ON FUNCTION public.protect_teacher_qualification_in_use() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t_teacher_subjects_in_use ON public.teacher_subjects;
CREATE TRIGGER t_teacher_subjects_in_use
BEFORE DELETE ON public.teacher_subjects
FOR EACH ROW EXECUTE FUNCTION public.protect_teacher_qualification_in_use();

-- ------------------------------------------------------------------
-- 4. Supporting index
--
-- The qualification check runs per affected row on every group write. The
-- composite PK already indexes (teacher_id, subject_id) in that order, which
-- serves this lookup; this adds the reverse for "who can teach subject X",
-- used by the group form's teacher dropdown.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject_teacher
  ON public.teacher_subjects (subject_id, teacher_id);

-- ------------------------------------------------------------------
-- 5. Post-conditions
-- ------------------------------------------------------------------
DO $$
DECLARE violations int; unqualified int;
BEGIN
  SELECT count(*) INTO violations
  FROM public.groups g
  WHERE g.teacher_id IS NOT NULL AND g.subject_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.teacher_subjects ts
                    WHERE ts.teacher_id = g.teacher_id AND ts.subject_id = g.subject_id);

  IF violations > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % group(s) still violate the rule', violations;
  END IF;

  SELECT count(*) INTO unqualified
  FROM public.teachers t
  WHERE NOT EXISTS (SELECT 1 FROM public.teacher_subjects ts WHERE ts.teacher_id = t.id);

  IF unqualified > 0 THEN
    RAISE WARNING
      '% teacher(s) have no subject qualification and cannot be assigned to any group until an admin sets one.',
      unqualified;
  END IF;

  RAISE NOTICE 'Teacher qualification system active. No violations.';
END $$;
