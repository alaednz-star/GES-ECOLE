-- Issue 1: a group on a stream-bearing level must declare its stream.
--
-- Streams were introduced in Task 2A, but only the *student* side was
-- constrained: onboarding forces a secondary student to pick a stream, while
-- the admin group form still created groups with `stream_id = NULL`.
--
-- Because the eligibility rule treats a NULL group stream as "open to every
-- stream of this level" (a shared revision class), every such group was visible
-- to all six 2AS/3AS streams. A "3AS Physique" group intended for Sciences
-- students appeared to Lettres et Philosophie students too, which defeats the
-- point of having streams at all.
--
-- The UI now requires a stream, but the UI is not the security boundary. This
-- trigger makes the rule true for anyone writing to the table.
--
-- IMPORTANT -- NULL keeps its meaning where it is legitimate:
--   * primary and middle levels have no stream rows, so NULL stays valid;
--   * a genuinely cross-stream class remains expressible by using an explicit
--     "all streams" group per stream, or by relaxing this rule later.
-- The existing eligibility helper (private.can_join_group) is unchanged: this
-- migration constrains what may be stored, not how matching works.

CREATE OR REPLACE FUNCTION public.require_stream_when_level_has_streams()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Unassigned level: nothing to check. The group is not yet offerable anyway.
  IF NEW.level_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.stream_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.streams s
       WHERE s.level_id = NEW.level_id AND s.status = 'active'
     ) THEN
    RAISE EXCEPTION
      'This level offers academic streams; a group must specify one'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.require_stream_when_level_has_streams() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t_groups_require_stream ON public.groups;
CREATE TRIGGER t_groups_require_stream
BEFORE INSERT OR UPDATE OF level_id, stream_id ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.require_stream_when_level_has_streams();

-- Report any pre-existing rows that violate the new rule. They are NOT altered
-- automatically: choosing the right stream for an existing class is an
-- administrative decision, not something a migration should guess.
DO $$
DECLARE offending int;
BEGIN
  SELECT count(*) INTO offending
  FROM public.groups g
  WHERE g.level_id IS NOT NULL
    AND g.stream_id IS NULL
    AND EXISTS (SELECT 1 FROM public.streams s
                 WHERE s.level_id = g.level_id AND s.status = 'active');

  IF offending > 0 THEN
    RAISE WARNING
      '% existing group(s) sit on a stream-bearing level without a stream. They remain visible to every stream of that level until an admin edits them.',
      offending;
  ELSE
    RAISE NOTICE 'No existing groups violate the stream requirement.';
  END IF;
END $$;
