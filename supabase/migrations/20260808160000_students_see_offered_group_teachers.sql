-- Students must see the teacher of a group they are being offered.
--
-- The registration catalogue lists groups a student MAY join, and each card
-- names the teacher. But `profiles read scoped` only admitted a teacher's
-- profile once the student held an APPROVED registration with them -- which is
-- backwards for a catalogue: the student is choosing whether to enrol, so the
-- approval does not exist yet.
--
-- `useGroups` resolves the teacher name through a separate `profiles` query
-- rather than a join, so the row was simply absent and every card fell back to
-- "Sans enseignant". Admins were unaffected because `is_admin()` already
-- admits every profile, which is why the Teachers page looked correct.
--
-- The fix extends both policies with exactly the visibility the catalogue
-- needs: the teacher assigned to an ACTIVE group that this student is already
-- permitted to see, matched on the same level/stream rule the groups policy
-- uses. It grants no more than the group listing itself already reveals.
--
-- `private.my_academic_identity()` is the existing helper the `groups read`
-- policy uses; reusing it keeps one definition of "a group offered to me".

drop policy if exists "profiles read scoped" on public.profiles;

create policy "profiles read scoped"
  on public.profiles for select
  using (
    id = auth.uid()
    or private.is_admin()
    -- A teacher may read the profile of their own approved students.
    or exists (
      select 1
        from public.registrations r
        join public.groups g on g.id = r.group_id
       where r.student_id = profiles.id
         and r.status = 'approved'
         and g.teacher_id = auth.uid()
    )
    -- A student may read the profile of a teacher who teaches a group that is
    -- offered to them, so the registration catalogue can name the teacher.
    or exists (
      select 1
        from public.groups g
        join private.my_academic_identity() me on true
       where g.teacher_id = profiles.id
         and g.status = 'active'
         and g.level_id is not null
         and g.level_id = me.level_id
         and (g.stream_id is null or g.stream_id = me.stream_id)
    )
  );

drop policy if exists "teachers read" on public.teachers;

create policy "teachers read"
  on public.teachers for select
  using (
    private.is_staff()
    or id = auth.uid()
    -- Already enrolled with this teacher.
    or exists (
      select 1
        from public.registrations r
        join public.groups g on g.id = r.group_id
       where r.student_id = auth.uid()
         and r.status = 'approved'
         and g.teacher_id = teachers.id
    )
    -- Or being offered one of their groups.
    or exists (
      select 1
        from public.groups g
        join private.my_academic_identity() me on true
       where g.teacher_id = teachers.id
         and g.status = 'active'
         and g.level_id is not null
         and g.level_id = me.level_id
         and (g.stream_id is null or g.stream_id = me.stream_id)
    )
  );
