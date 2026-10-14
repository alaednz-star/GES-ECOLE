-- ==================================================================
-- Phase 3B -- groups stay within their formation's level system (ADR-004 section 3).
--
-- Phase 3A gave formations a level system (`programs.level_system_id`). The formation -> group
-- rule still only compared LEVELS: when a formation names a level, its groups carry exactly that
-- level. A formation that names a SYSTEM but no specific level ("English", CEFR, groups at A1
-- and B1) put no limit on its groups' levels: a 3AS school year could be attached to it.
--
-- THE RULE, both directions
--
--   group side      a group of a formation that names a system may only carry a level of that
--                   system (or no level); the level rule (same level when the formation names
--                   one) is unchanged
--   formation side  a formation may not move to a system its groups' levels are not part of
--                   (the existing level/subject check is unchanged)
--
-- Groups outside any formation, and groups of a formation with no system ("no specific level"),
-- are unaffected. Student eligibility is untouched (Phase 3C): a group carrying a CEFR or
-- training level is placed by the administration, as any group can be.
--
-- ROLLBACK: restore the two function bodies from 20261001100000_programs.sql and recreate
-- t_programs_groups_consistent as BEFORE UPDATE OF level_id, subject_id.
-- ==================================================================

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
  IF p.level_system_id IS NOT NULL AND NEW.level_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.levels l WHERE l.id = NEW.level_id AND l.system_id = p.level_system_id
     ) THEN
    RAISE EXCEPTION 'This group''s level is not part of the level system of programme "%".', p.name
      USING ERRCODE = 'check_violation';
  END IF;
  IF p.subject_id IS NOT NULL AND NEW.subject_id IS DISTINCT FROM p.subject_id THEN
    RAISE EXCEPTION 'This group''s subject does not match the subject of programme "%".', p.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

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

  IF NEW.level_system_id IS NOT NULL THEN
    SELECT count(*) INTO n
      FROM public.groups g JOIN public.levels l ON l.id = g.level_id
     WHERE g.program_id = NEW.id AND l.system_id <> NEW.level_system_id;
    IF n > 0 THEN
      RAISE EXCEPTION '% group(s) of this programme have a level outside the new level system.', n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_group_program() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_program_groups() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_programs_groups_consistent ON public.programs;
CREATE TRIGGER t_programs_groups_consistent
  BEFORE UPDATE OF level_id, subject_id, level_system_id ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.validate_program_groups();

-- Post-condition: no existing group already breaks the rule.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.groups g
    JOIN public.programs p ON p.id = g.program_id
    JOIN public.levels l ON l.id = g.level_id
   WHERE p.level_system_id IS NOT NULL AND l.system_id <> p.level_system_id;
  IF n > 0 THEN
    RAISE EXCEPTION '% existing group(s) carry a level outside their formation''s system', n;
  END IF;
END $$;
