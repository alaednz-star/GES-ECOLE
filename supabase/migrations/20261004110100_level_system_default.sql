-- ==================================================================
-- Phase 3A follow-up: a real column default for levels.system_id.
--
-- 20261004110000 made system_id NOT NULL and let a trigger fill it when a level is created
-- without one (the existing Levels screen, which only knows school levels). That works, but a
-- trigger-filled column looks REQUIRED to every client and to the generated types. A column
-- default states the same rule where readers and tools look for it: a level created without a
-- system is an Algerian school level. The trigger keeps covering an explicit NULL.
--
-- ROLLBACK
--   ALTER TABLE public.levels ALTER COLUMN system_id DROP DEFAULT;
--   DROP FUNCTION IF EXISTS public.school_level_system_id();
-- ==================================================================

CREATE OR REPLACE FUNCTION public.school_level_system_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT id FROM public.level_systems WHERE code = 'algerian_school';
$$;

REVOKE ALL ON FUNCTION public.school_level_system_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_level_system_id() TO authenticated, service_role;

ALTER TABLE public.levels ALTER COLUMN system_id SET DEFAULT public.school_level_system_id();

DO $$
BEGIN
  IF public.school_level_system_id() IS NULL THEN
    RAISE EXCEPTION 'the Algerian school level system is missing';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'levels' AND column_name = 'system_id') IS NULL THEN
    RAISE EXCEPTION 'levels.system_id has no default';
  END IF;
END $$;
