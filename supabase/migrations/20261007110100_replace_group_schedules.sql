-- ==================================================================
-- Replace a group's weekly slots atomically (ADR-007).
--
-- The group form used to delete every slot and then insert the new ones in two requests. When the
-- insert was refused -- a room already taken (t_group_schedules_room_conflict), two slots the same
-- day -- the group was left with NO slot. This function does both in one transaction: a refusal
-- leaves the previous slots untouched.
--
-- SECURITY INVOKER: the caller's rights apply unchanged (only administrators may write slots,
-- "schedules admin write"), and every slot trigger runs as before.
--
-- ROLLBACK: DROP FUNCTION public.replace_group_schedules(uuid, jsonb);
-- ==================================================================

CREATE OR REPLACE FUNCTION public.replace_group_schedules(p_group uuid, p_slots jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
    RAISE EXCEPTION 'The slots must be a list.' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM public.group_schedules WHERE group_id = p_group;
  INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time, room, room_id)
  SELECT p_group,
         (e ->> 'weekday')::integer,
         (e ->> 'start_time')::time,
         (e ->> 'end_time')::time,
         nullif(btrim(coalesce(e ->> 'room', '')), ''),
         nullif(e ->> 'room_id', '')::uuid
    FROM jsonb_array_elements(p_slots) AS e;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_group_schedules(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_group_schedules(uuid, jsonb) TO authenticated;
