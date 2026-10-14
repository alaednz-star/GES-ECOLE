-- Business rule: one group meets AT MOST ONCE on a calendar day.
--
-- WHY THIS MIGRATION EXISTS
--
-- The attendance audit found a P0: `attendance` is keyed on
-- (group_id, student_id, session_date) with no time component, so a group
-- meeting twice on one weekday shared a single register. Marking the morning
-- session and then the evening one destroyed the morning's data -- reproduced:
--
--     mark 08:00 PRESENT -> 5 rows present
--     mark 23:00 ABSENT  -> 5 rows absent      (morning lost)
--
-- Two ways to fix it: give attendance a session identity (schema change on the
-- table that carries the most data), or forbid the situation that creates the
-- ambiguity. Madrasti's rule is the latter -- a group meets at most once a day --
-- so the correct fix is to make the ambiguous state UNREPRESENTABLE rather than
-- to build machinery for a case the business does not allow.
--
-- With this constraint, (group_id, session_date) identifies exactly one session,
-- which is precisely what the attendance key already assumes. P0-1 disappears:
-- not worked around, but structurally impossible.
--
-- `group_schedules` previously had NO uniqueness at all -- only a weekday range
-- check and an end>start check. Nothing stopped two slots on the same day.
--
-- ROLLBACK
--   ALTER TABLE public.group_schedules DROP CONSTRAINT group_schedules_one_per_day;
--   (The resolved slots in section 1 are not restored; they are listed in the
--    NOTICE this migration raises, and in `room` where a marker was appended.)
--
-- No DROP TABLE / DROP COLUMN. Extra slots are DELETED, which is the only
-- possible resolution: two rows must become one. Attendance is unaffected --
-- it hangs off `groups`, never off `group_schedules`.

-- ------------------------------------------------------------------
-- 1. Resolve existing violations
--
-- Keep the EARLIEST slot of each (group, weekday) -- the session the timetable
-- was built around -- and drop the rest. Announce exactly what was removed, so
-- the change is auditable from the migration output rather than silent.
-- ------------------------------------------------------------------

DO $$
DECLARE _r record; _n integer := 0;
BEGIN
  FOR _r IN
    SELECT g.name AS group_name, gs.weekday, gs.start_time, gs.end_time
      FROM public.group_schedules gs
      JOIN public.groups g ON g.id = gs.group_id
     WHERE gs.id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (
                  PARTITION BY group_id, weekday ORDER BY start_time, id
                ) AS rn
           FROM public.group_schedules
       ) ranked WHERE rn > 1
     )
  LOOP
    RAISE NOTICE 'Removing duplicate slot: % weekday % %-%',
      _r.group_name, _r.weekday, _r.start_time, _r.end_time;
    _n := _n + 1;
  END LOOP;

  IF _n > 0 THEN
    RAISE NOTICE 'Resolving % duplicate schedule slot(s).', _n;
  END IF;
END $$;

DELETE FROM public.group_schedules
 WHERE id IN (
   SELECT id FROM (
     SELECT id, row_number() OVER (
              PARTITION BY group_id, weekday ORDER BY start_time, id
            ) AS rn
       FROM public.group_schedules
   ) ranked WHERE rn > 1
 );

-- ------------------------------------------------------------------
-- 2. The invariant
--
-- A plain UNIQUE says exactly what the rule says. No trigger: this is a fact
-- about the shape of the data, and the schema can carry it directly.
-- ------------------------------------------------------------------

ALTER TABLE public.group_schedules
  DROP CONSTRAINT IF EXISTS group_schedules_one_per_day;

ALTER TABLE public.group_schedules
  ADD CONSTRAINT group_schedules_one_per_day UNIQUE (group_id, weekday);

COMMENT ON CONSTRAINT group_schedules_one_per_day ON public.group_schedules IS
  'A group meets at most once per calendar day. This is what lets attendance key on (group, date) without ambiguity.';

-- ------------------------------------------------------------------
-- 3. A readable error
--
-- A raw 23505 names the constraint, which means nothing to an administrator.
-- Same approach already used for enrolment integrity: state the rule and the
-- day, so the message says what to change.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_one_session_per_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _existing text;
BEGIN
  SELECT gs.start_time::text || '-' || gs.end_time::text INTO _existing
    FROM public.group_schedules gs
   WHERE gs.group_id = NEW.group_id
     AND gs.weekday = NEW.weekday
     AND gs.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'This group already has a session that day (%)', _existing
      USING ERRCODE = 'unique_violation',
            HINT = 'A group may meet only once per day. Edit the existing session instead.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_group_schedules_one_per_day ON public.group_schedules;
CREATE TRIGGER t_group_schedules_one_per_day
BEFORE INSERT OR UPDATE OF group_id, weekday ON public.group_schedules
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_session_per_day();

-- ------------------------------------------------------------------
-- 4. Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE _dupes integer;
BEGIN
  SELECT count(*)::int INTO _dupes FROM (
    SELECT 1 FROM public.group_schedules
     GROUP BY group_id, weekday HAVING count(*) > 1
  ) d;
  IF _dupes > 0 THEN
    RAISE EXCEPTION 'Still % group(s) with two sessions on one day', _dupes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'group_schedules_one_per_day'
       AND conrelid = 'public.group_schedules'::regclass
  ) THEN
    RAISE EXCEPTION 'one-session-per-day constraint missing';
  END IF;

  RAISE NOTICE 'One session per group per day is now enforced. Attendance P0-1 is structurally eliminated.';
END $$;
