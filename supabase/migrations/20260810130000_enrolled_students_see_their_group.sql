-- A student enrolled in a group may read that group's row.
--
-- WHY THIS MIGRATION EXISTS
--
-- `groups read` currently answers a different question than the one enrolled
-- students need. Its student branch is the REGISTRATION ELIGIBILITY rule:
--
--   groups.status = 'active'
--   AND groups.level_id = my level
--   AND (groups.stream_id IS NULL OR groups.stream_id = my stream)
--
-- That is exactly right for "which groups may I sign up for?" on the
-- registration page. It is wrong for "which groups am I IN", because enrolment is
-- a fact that outlives eligibility:
--
--   * a student whose `level_id` is later changed or cleared stops being able to
--     read a group they are actively enrolled in;
--   * a group deactivated at the end of a term becomes invisible to the students
--     who attended it, along with its name;
--   * a group whose stream is retargeted drops out of view mid-term.
--
-- Found while building course resources: an approved-enrolled student could read
-- `chapters` and `resources` (their own policies check enrolment) but not the
-- `groups` row needed for the course NAME, so a PostgREST embed on `groups!inner`
-- returned zero rows and the page rendered empty. Reproduced with a student whose
-- `level_id` was null.
--
-- NOT A WEAKENING. The added branch requires an APPROVED registration, which the
-- student can already see (`registrations read` covers their own rows), and whose
-- consequences they can already observe -- their attendance for the group, its
-- schedule, its chapters. This closes an inconsistency rather than opening
-- anything new; a student with no enrolment gains nothing.
--
-- Deliberately NOT touching the eligibility branch: the registration page depends
-- on it, and widening that would start advertising groups a student may not join.
--
-- ROLLBACK: restore the two-branch policy from
--   20260808160000_students_see_offered_group_teachers.sql

drop policy if exists "groups read" on public.groups;

create policy "groups read" on public.groups for select to authenticated
using (
  private.is_staff()
  -- Branch 1, unchanged: groups this student is ELIGIBLE to join.
  or exists (
    select 1 from private.my_academic_identity() me(level_id, stream_id)
     where groups.status = 'active'
       and groups.level_id is not null
       and groups.level_id = me.level_id
       and (groups.stream_id is null or groups.stream_id = me.stream_id)
  )
  -- Branch 2, new: groups this student is ENROLLED in, whatever their current
  -- academic identity or the group's status. Enrolment outlives eligibility.
  --
  -- Via the SECURITY DEFINER helper, NOT an inline EXISTS on `registrations`.
  -- `registrations read` itself references `groups` (to let a teacher see their
  -- groups' registrations), so an inline subquery here closes a cycle:
  --   groups read -> registrations -> groups read -> ...
  -- Postgres detects the recursion and every query on either table returns 500.
  -- Reproduced: both the teacher and student resource pages went blank with
  -- "infinite recursion detected in policy". The helper runs as its owner, so it
  -- does not re-enter `registrations` RLS and the cycle never forms.
  or public.is_enrolled_in_group(groups.id)
);

comment on policy "groups read" on public.groups is
  'Staff see everything. A student sees groups they are ELIGIBLE for (registration) and groups they are ENROLLED in (their courses) -- the second branch exists because enrolment outlives eligibility: a level change or a deactivated group must not hide a course the student is actually taking.';

do $$
begin
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'groups' and p.polname = 'groups read'
  ) then
    raise exception 'groups read policy missing after replacement';
  end if;
  raise notice 'Enrolled students can now read their own groups.';
end $$;
