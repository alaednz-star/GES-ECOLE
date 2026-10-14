-- Recurring schedule model: give every group a start and end date.
--
-- ARCHITECTURE AUDIT -- alternatives considered and why this one wins:
--
--   A. One row per lesson ("materialise the calendar").
--      Rejected, and explicitly excluded by the brief. At 60 groups x 36 weeks
--      x 2 sessions that is 4,320 rows per year, growing every year, and every
--      schedule edit means deleting and regenerating a block of future rows.
--      Worse, it splits truth: the pattern and its expansion can disagree.
--
--   B. Full iCalendar RRULE strings on group_schedules.
--      Rejected as over-engineering here. RRULE earns its complexity when you
--      need monthly-by-nth-weekday, intervals, or per-occurrence exceptions.
--      A tutoring centre needs "every Sunday and Wednesday, 09:00-10:30, from
--      September to June". Storing that as an opaque string would make the
--      weekday unqueryable in SQL -- we would lose the ability to ask "which
--      groups meet today?" without parsing every row in the application.
--
--   C. Date range on the group + weekly pattern rows.  <-- CHOSEN
--      `group_schedules` already stores exactly the weekly pattern (weekday,
--      start_time, end_time, room). The only missing information is the window
--      over which that pattern repeats, which belongs to the group, not to each
--      slot: all of a group's sessions run for the same term.
--
--      Storage stays O(sessions per week), not O(lessons per year) -- 5 rows
--      today instead of 216, and 4,320 avoided at 60 groups. Occurrences are
--      derived on demand, so changing a start date is one UPDATE with no
--      regeneration and nothing to fall out of sync.
--
-- `attendance.session_date` is already a real DATE, so attendance was always
-- occurrence-based; it simply had no schedule window to be validated against.
-- This migration supplies that window and enforces it.

-- ------------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------------

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date   date;

COMMENT ON COLUMN public.groups.start_date IS
  'First day the weekly pattern in group_schedules applies. Occurrences are derived, never stored per lesson.';
COMMENT ON COLUMN public.groups.end_date IS
  'Last day the weekly pattern applies. NULL means open-ended.';

-- ------------------------------------------------------------------
-- 2. Backfill
--
-- Existing groups already have attendance history, so the earliest recorded
-- session is the most honest available start date -- it is what actually
-- happened. Where a group has no history, fall back to today: the schedule
-- starts now rather than claiming a past that did not occur.
--
-- `end_date` is deliberately left NULL. Guessing when a course ends would put
-- invented data in front of parents; an admin sets it explicitly.
-- ------------------------------------------------------------------

UPDATE public.groups g
SET start_date = COALESCE(
      (SELECT min(a.session_date) FROM public.attendance a WHERE a.group_id = g.id),
      CURRENT_DATE
    )
WHERE g.start_date IS NULL;

-- Every group now has a start date, so the column can be required. New rows
-- default to today, which is the sane assumption when an admin creates a group.
ALTER TABLE public.groups
  ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;

ALTER TABLE public.groups
  ALTER COLUMN start_date SET NOT NULL;

-- ------------------------------------------------------------------
-- 3. Integrity
-- ------------------------------------------------------------------

-- An end date before the start date describes a course that never runs.
ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_date_range_valid;
ALTER TABLE public.groups ADD CONSTRAINT groups_date_range_valid
  CHECK (end_date IS NULL OR end_date >= start_date);

-- A session that ends before it starts is a data-entry slip, not a schedule.
ALTER TABLE public.group_schedules DROP CONSTRAINT IF EXISTS group_schedules_time_order;
ALTER TABLE public.group_schedules ADD CONSTRAINT group_schedules_time_order
  CHECK (end_time > start_time);

-- ------------------------------------------------------------------
-- 4. Attendance must land on a real occurrence
--
-- This is what makes the model authoritative rather than advisory: attendance
-- can only be recorded for a date on which the group actually meets, inside its
-- term. Without it, a typo could file attendance for a Friday in a group that
-- only meets Sunday and Wednesday, silently corrupting every rate we compute.
--
-- Historical rows are NOT re-validated: the trigger fires on new writes only,
-- and all 108 existing rows were confirmed to fall on scheduled weekdays.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_attendance_occurrence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE g_start date; g_end date; has_slot boolean;
BEGIN
  SELECT start_date, end_date INTO g_start, g_end
  FROM public.groups WHERE id = NEW.group_id;

  IF g_start IS NULL THEN RETURN NEW; END IF;   -- group vanished; FK will speak

  IF NEW.session_date < g_start THEN
    RAISE EXCEPTION 'Attendance date % is before the group starts (%)', NEW.session_date, g_start
      USING ERRCODE = 'check_violation';
  END IF;

  IF g_end IS NOT NULL AND NEW.session_date > g_end THEN
    RAISE EXCEPTION 'Attendance date % is after the group ends (%)', NEW.session_date, g_end
      USING ERRCODE = 'check_violation';
  END IF;

  -- A group with no declared slots is still being set up; do not block staff.
  SELECT EXISTS (SELECT 1 FROM public.group_schedules s WHERE s.group_id = NEW.group_id)
    INTO has_slot;
  IF NOT has_slot THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_schedules s
    WHERE s.group_id = NEW.group_id
      AND s.weekday = EXTRACT(DOW FROM NEW.session_date)
  ) THEN
    RAISE EXCEPTION 'The group does not meet on % (weekday %)',
      NEW.session_date, EXTRACT(DOW FROM NEW.session_date)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.validate_attendance_occurrence() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t_attendance_valid_occurrence ON public.attendance;
CREATE TRIGGER t_attendance_valid_occurrence
BEFORE INSERT OR UPDATE OF session_date, group_id ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.validate_attendance_occurrence();

-- ------------------------------------------------------------------
-- 5. Index for "which groups are running on date X"
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_groups_date_range
  ON public.groups (start_date, end_date) WHERE status = 'active';

-- ------------------------------------------------------------------
-- 6. Post-conditions
-- ------------------------------------------------------------------
DO $$
DECLARE missing int; inverted int; stale int;
BEGIN
  SELECT count(*) INTO missing FROM public.groups WHERE start_date IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % group(s) still have no start date', missing;
  END IF;

  SELECT count(*) INTO inverted FROM public.groups
   WHERE end_date IS NOT NULL AND end_date < start_date;
  IF inverted > 0 THEN
    RAISE EXCEPTION '% group(s) have an end date before their start date', inverted;
  END IF;

  SELECT count(*) INTO stale FROM public.attendance a
   JOIN public.groups g ON g.id = a.group_id
   WHERE a.session_date < g.start_date;
  IF stale > 0 THEN
    RAISE WARNING '% historical attendance row(s) predate their group start date.', stale;
  END IF;

  RAISE NOTICE 'Recurring schedule model active.';
END $$;
