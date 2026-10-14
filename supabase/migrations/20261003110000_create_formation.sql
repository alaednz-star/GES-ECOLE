-- ==================================================================
-- Create a formation, optionally with its first group, in ONE transaction.
--
-- WHY
--
-- ADR-004 makes the formation (table `programs`) the administrator's starting point: "English
-- C1" is created, and usually its first group with it (teacher, places, weekly slots, room).
-- From the browser that is three writes -- programme, group, schedules -- and a failure in the
-- second or third would leave an empty formation or a group without its timetable. A function
-- body runs in a single transaction, so either everything exists afterwards or nothing does.
--
-- SECURITY INVOKER, ON PURPOSE
--
-- The function adds no privilege. It runs as the caller, so the existing policies still decide:
-- `programs admin write`, `groups admin write`, `schedules admin write`. Every existing trigger
-- still fires: programme/group consistency, teacher qualification, stream rules, one slot per
-- weekday. The explicit administrator check up front only turns a refusal deep in the
-- transaction into a clear first sentence.
--
-- WHAT THE GROUP TAKES FROM THE FORMATION
--
-- The group's subject and level are the formation's (ADR-004 section 3: the formation is the
-- source of truth when it names them; the group keeps the effective copy that registrations,
-- eligibility and statistics read). They are not accepted from the caller, so the two can never
-- disagree at creation. Teacher, places, stream, term dates and weekly slots are the group's own.
-- `price_dzd` is legacy (ADR-004 section 9) and starts at 0, as the group form already does.
--
-- INPUT (jsonb, keys as the table columns)
--
--   formation    name, category, status ('draft' | 'active'), description, curriculum, level_id,
--                subject_id, start_date, end_date, duration_hours
--   first_group  NULL, or: name, teacher_id, stream_id, max_students, status, start_date,
--                end_date, schedules: [{ weekday, start_time, end_time, room }]
--
-- RETURNS { "program_id": uuid, "group_id": uuid | null }
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.create_formation(jsonb, jsonb);
-- ==================================================================

CREATE OR REPLACE FUNCTION public.create_formation(formation jsonb, first_group jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  _program public.programs;
  _group_id uuid;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can create formations.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A new formation is a draft or already running; it never starts completed, cancelled or
  -- archived. Registration starts closed (it can only be opened on an active formation).
  IF COALESCE(formation->>'status', 'draft') NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'A new formation starts as a draft or active.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.programs (
    name, category, status, registration_open, description, curriculum,
    level_id, subject_id, start_date, end_date, duration_hours
  )
  VALUES (
    formation->>'name',
    COALESCE(formation->>'category', 'other'),
    COALESCE(formation->>'status', 'draft'),
    false,
    NULLIF(btrim(formation->>'description'), ''),
    NULLIF(btrim(formation->>'curriculum'), ''),
    (formation->>'level_id')::uuid,
    (formation->>'subject_id')::uuid,
    (formation->>'start_date')::date,
    (formation->>'end_date')::date,
    (formation->>'duration_hours')::int
  )
  RETURNING * INTO _program;

  IF first_group IS NOT NULL AND jsonb_typeof(first_group) = 'object' THEN
    INSERT INTO public.groups (
      name, program_id, subject_id, level_id, stream_id, teacher_id,
      max_students, price_dzd, status, start_date, end_date
    )
    VALUES (
      first_group->>'name',
      _program.id,
      _program.subject_id,
      _program.level_id,
      (first_group->>'stream_id')::uuid,
      (first_group->>'teacher_id')::uuid,
      COALESCE((first_group->>'max_students')::int, 20),
      0,
      COALESCE(first_group->>'status', 'active')::public.entity_status,
      COALESCE((first_group->>'start_date')::date, current_date),
      (first_group->>'end_date')::date
    )
    RETURNING id INTO _group_id;

    INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room)
    SELECT _group_id, s.weekday, s.start_time, s.end_time, NULLIF(btrim(s.room), '')
      FROM jsonb_to_recordset(COALESCE(first_group->'schedules', '[]'::jsonb))
           AS s(weekday int, start_time time, end_time time, room text);
  END IF;

  RETURN jsonb_build_object('program_id', _program.id, 'group_id', _group_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_formation(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_formation(jsonb, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_formation(jsonb, jsonb) IS
  'Creates a formation (programs row) and, optionally, its first group and weekly slots in one transaction. SECURITY INVOKER: existing RLS and triggers decide.';

-- Post-condition: it exists, runs as the caller, and anonymous visitors cannot call it.
DO $$
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.create_formation(jsonb, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'create_formation must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.create_formation(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute create_formation';
  END IF;
END $$;
