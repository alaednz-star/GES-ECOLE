-- ==================================================================
-- Salles: the institution's rooms, linked to weekly slots, with conflict detection (ADR-007).
--
--   rooms(id, name, capacity, location, equipment, status)
--   group_schedules.room_id -> rooms (SET NULL). The existing free-text `room` column is kept and
--   synchronised with the room's name, so every screen that already shows a slot's room keeps
--   working. A slot without room_id keeps its free text (legacy).
--
-- Existing data: each distinct non-empty `room` text becomes a room and its slots are linked to
-- it. No slot loses information.
--
-- Rule: a room hosts one ACTIVE group at a time. Two slots of active groups whose date ranges
-- overlap cannot use the same room on the same weekday at overlapping times (trigger, 23514).
--
-- SECURITY: rooms are readable by every signed-in user (timetables), written by administrators
-- (RLS), like subjects and levels.
--
-- ROLLBACK
--   DROP TRIGGER t_group_schedules_room_conflict / t_group_schedules_a_room_sync ON public.group_schedules;
--   DROP TRIGGER t_rooms_rename ON public.rooms;
--   DROP FUNCTION public.check_room_conflict(), public.sync_slot_room(), public.rename_room_slots();
--   ALTER TABLE public.group_schedules DROP COLUMN room_id; DROP TABLE public.rooms;
-- ==================================================================

CREATE TABLE IF NOT EXISTS public.rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  capacity   integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 1000),
  location   text CHECK (location IS NULL OR length(location) <= 120),
  equipment  text CHECK (equipment IS NULL OR length(equipment) <= 300),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_name_unique ON public.rooms (lower(btrim(name)));

COMMENT ON TABLE public.rooms IS
  'The institution''s rooms. Linked to weekly slots (group_schedules.room_id); a room hosts one '
  'active group at a time (t_group_schedules_room_conflict).';

DROP TRIGGER IF EXISTS t_rooms_updated ON public.rooms;
CREATE TRIGGER t_rooms_updated BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rooms read" ON public.rooms;
CREATE POLICY "rooms read" ON public.rooms FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rooms admin write" ON public.rooms;
CREATE POLICY "rooms admin write" ON public.rooms FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());
REVOKE ALL ON public.rooms FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;

ALTER TABLE public.group_schedules
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.rooms (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS group_schedules_room_idx ON public.group_schedules (room_id, weekday)
  WHERE room_id IS NOT NULL;

-- Existing free-text rooms become managed rooms.
INSERT INTO public.rooms (name)
SELECT DISTINCT ON (lower(btrim(room))) btrim(room)
  FROM public.group_schedules
 WHERE room IS NOT NULL AND btrim(room) <> ''
ON CONFLICT DO NOTHING;
UPDATE public.group_schedules s
   SET room_id = r.id
  FROM public.rooms r
 WHERE s.room_id IS NULL AND s.room IS NOT NULL AND lower(btrim(s.room)) = lower(btrim(r.name));

-- The slot's text follows its room; a slot written with only a room NAME (older screens, the
-- "new formation + first group" flow) is linked to the room of that name when one exists.
CREATE OR REPLACE FUNCTION public.sync_slot_room()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _id   uuid;
  _name text;
BEGIN
  IF NEW.room_id IS NOT NULL THEN
    SELECT name INTO NEW.room FROM public.rooms WHERE id = NEW.room_id;
  ELSIF NEW.room IS NOT NULL AND btrim(NEW.room) <> '' THEN
    SELECT id, name INTO _id, _name FROM public.rooms
     WHERE lower(btrim(name)) = lower(btrim(NEW.room)) LIMIT 1;
    IF _id IS NOT NULL THEN
      NEW.room_id := _id;
      NEW.room := _name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_slot_room() FROM PUBLIC, anon, authenticated;

-- Named "a_..." so it fires BEFORE the conflict check (triggers fire in name order).
DROP TRIGGER IF EXISTS t_group_schedules_room_sync ON public.group_schedules;
DROP TRIGGER IF EXISTS t_group_schedules_a_room_sync ON public.group_schedules;
CREATE TRIGGER t_group_schedules_a_room_sync BEFORE INSERT OR UPDATE OF room_id, room ON public.group_schedules
  FOR EACH ROW EXECUTE FUNCTION public.sync_slot_room();

-- Renaming a room renames it on its slots. SECURITY DEFINER: the rename is an admin act on
-- rooms; the slot text is derived data.
CREATE OR REPLACE FUNCTION public.rename_room_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.group_schedules SET room = NEW.name WHERE room_id = NEW.id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.rename_room_slots() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_rooms_rename ON public.rooms;
CREATE TRIGGER t_rooms_rename AFTER UPDATE OF name ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.rename_room_slots();

-- One active group in a room at a time.
CREATE OR REPLACE FUNCTION public.check_room_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _clash record;
BEGIN
  IF NEW.room_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT g2.name AS group_name, s2.start_time, s2.end_time, r.name AS room_name
    INTO _clash
    FROM public.group_schedules s2
    JOIN public.groups g2 ON g2.id = s2.group_id
    JOIN public.groups g1 ON g1.id = NEW.group_id
    JOIN public.rooms r ON r.id = NEW.room_id
   WHERE s2.room_id = NEW.room_id
     AND s2.weekday = NEW.weekday
     AND s2.id IS DISTINCT FROM NEW.id
     AND s2.group_id <> NEW.group_id
     AND s2.start_time < NEW.end_time AND NEW.start_time < s2.end_time
     AND g1.status = 'active' AND g2.status = 'active'
     AND coalesce(g2.start_date, DATE '1900-01-01') <= coalesce(g1.end_date, DATE '2999-12-31')
     AND coalesce(g1.start_date, DATE '1900-01-01') <= coalesce(g2.end_date, DATE '2999-12-31')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Room % is already used at that time by group "%" (% - %).',
      _clash.room_name, _clash.group_name, to_char(_clash.start_time, 'HH24:MI'), to_char(_clash.end_time, 'HH24:MI')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_room_conflict() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_group_schedules_room_conflict ON public.group_schedules;
CREATE TRIGGER t_group_schedules_room_conflict
  BEFORE INSERT OR UPDATE OF room_id, room, weekday, start_time, end_time ON public.group_schedules
  FOR EACH ROW EXECUTE FUNCTION public.check_room_conflict();

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rooms'::regclass) THEN
    RAISE EXCEPTION 'SECURITY: RLS is not enabled on rooms';
  END IF;
  IF has_table_privilege('anon', 'public.rooms', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY: anon can read rooms';
  END IF;
  IF EXISTS (SELECT 1 FROM public.group_schedules WHERE room IS NOT NULL AND btrim(room) <> '' AND room_id IS NULL) THEN
    RAISE EXCEPTION 'a slot room was not linked';
  END IF;
  RAISE NOTICE 'Rooms installed.';
END $$;
