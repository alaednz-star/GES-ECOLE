-- Task 2C: enforce registration eligibility in the database.
--
-- Until now `groups read` was USING (true) and the registration INSERT policy
-- only checked `student_id = auth.uid()`. Both are insufficient:
--
--   * a student editing the request could read every group in the school;
--   * a student could POST any group_id and enrol into a 3AS or primary group.
--
-- UI filtering cannot fix either -- the rules have to live where the data does.
--
-- ELIGIBILITY (mirrors `groupMatchesStream` in the Task 2A data layer):
--   group.level_id  = student.level_id
--   AND (group.stream_id IS NULL OR group.stream_id = student.stream_id)
--   AND group.status = 'active'
--
-- A NULL group stream means "open to every stream of that level" -- a shared
-- revision class -- which is why the second clause allows it.

-- ------------------------------------------------------------------
-- 1. Eligibility predicate, defined once and reused by both policies
-- ------------------------------------------------------------------

-- RECURSION NOTE -- this is the subtle part of the whole migration:
--
-- `groups read` needs the student's level and stream, which live in
-- `students`. But `students read` itself contains a subquery over `groups`
-- (so a teacher can see their own students). Reading `students` directly from
-- a groups policy therefore produces "infinite recursion detected in policy"
-- at query time -- caught during verification, not in review.
--
-- Reading the identity through a SECURITY DEFINER function bypasses RLS on
-- `students` and breaks the cycle. Same reason `is_staff` reads `user_roles`
-- directly instead of going through an existing helper.

CREATE OR REPLACE FUNCTION private.my_academic_identity()
RETURNS TABLE (level_id uuid, stream_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $function$
  SELECT s.level_id, s.stream_id FROM public.students s WHERE s.id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION private.my_academic_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.my_academic_identity() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','teacher')
  );
$function$;

REVOKE ALL ON FUNCTION private.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.can_join_group(_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups g, private.my_academic_identity() me
    WHERE g.id = _group_id
      AND g.status = 'active'
      AND g.level_id IS NOT NULL
      AND g.level_id = me.level_id
      AND (g.stream_id IS NULL OR g.stream_id = me.stream_id)
  );
$function$;

REVOKE ALL ON FUNCTION private.can_join_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_join_group(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. Reads: a student sees only their own eligible groups
--
-- Admins and teachers keep full visibility -- they manage the catalogue and
-- their own rosters, and several admin screens depend on reading every group.
-- ------------------------------------------------------------------

DROP POLICY IF EXISTS "groups read" ON public.groups;
CREATE POLICY "groups read" ON public.groups
FOR SELECT TO authenticated
USING (
  -- Staff keep full visibility: admins manage the catalogue, teachers may be
  -- assigned a group at any time and several screens read broadly.
  private.is_staff()
  -- Students: only groups matching their own level and stream.
  OR EXISTS (
    SELECT 1 FROM private.my_academic_identity() me
    WHERE groups.status = 'active'
      AND groups.level_id IS NOT NULL
      AND groups.level_id = me.level_id
      AND (groups.stream_id IS NULL OR groups.stream_id = me.stream_id)
  )
);

-- ------------------------------------------------------------------
-- 3. Writes: a student can only enrol into a group they may actually join
--
-- Admins keep the ability to enrol anyone anywhere (they handle exceptions,
-- transfers and corrections by hand).
-- ------------------------------------------------------------------

DROP POLICY IF EXISTS "registrations student insert" ON public.registrations;
CREATE POLICY "registrations student insert" ON public.registrations
FOR INSERT TO authenticated
WITH CHECK (
  private.is_admin()
  OR (student_id = auth.uid() AND private.can_join_group(group_id))
);

-- ------------------------------------------------------------------
-- 4. Capacity, enforced server-side
--
-- "Full groups must never appear" is a UI rule; "a full group cannot be joined"
-- has to be a database rule, otherwise two students racing on the last seat
-- both succeed. A policy cannot express this cleanly (it would need to count
-- sibling rows mid-INSERT), so it is a trigger.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_group_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE taken int; capacity int;
BEGIN
  -- Only approved registrations consume a seat; pending ones are requests.
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;

  SELECT g.max_students INTO capacity FROM public.groups g WHERE g.id = NEW.group_id;
  IF capacity IS NULL OR capacity <= 0 THEN RETURN NEW; END IF;

  SELECT count(*) INTO taken
  FROM public.registrations r
  WHERE r.group_id = NEW.group_id
    AND r.status = 'approved'
    AND r.id <> NEW.id;

  IF taken >= capacity THEN
    RAISE EXCEPTION 'Group % is full (%/% seats)', NEW.group_id, taken, capacity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.enforce_group_capacity() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t_registrations_capacity ON public.registrations;
CREATE TRIGGER t_registrations_capacity
BEFORE INSERT OR UPDATE OF status ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.enforce_group_capacity();

-- ------------------------------------------------------------------
-- 5. Supporting index for the eligibility lookup
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_groups_level_stream_status
  ON public.groups (level_id, stream_id, status);
