-- Rewinds a CLONE to its pre-Phase-4 shape, so the three Phase 4 migrations can be
-- replayed the way `supabase db push` will run them.
--
-- The enum is the awkward part, exactly as in Phase 1: a value cannot be removed, so
-- `add value if not exists` would be a no-op and the replay would prove nothing. The
-- type is rebuilt without the two new values instead, which is only safe because this
-- is a throwaway database.

-- 1. The engagement views.
drop view if exists public.resource_student_engagement;
drop view if exists public.resource_engagement;

-- 2. The publication triggers and their functions.
drop trigger if exists t_resources_notify_publication on public.resources;
drop trigger if exists t_chapters_notify_publication on public.chapters;
drop function if exists public.notify_resource_publication();
drop function if exists public.notify_chapter_publication();

-- 3. The idempotency indexes and deliver_at.
drop index if exists public.notifications_resource_once;
drop index if exists public.notifications_chapter_once;
drop index if exists public.idx_notifications_user_due;

-- The read policy references deliver_at, so it goes back to its 20260803090000 form
-- before the column can be dropped.
drop policy if exists "notifications read" on public.notifications;
create policy "notifications read" on public.notifications for select to authenticated
  using ((user_id = auth.uid()) or private.is_admin());

alter table public.notifications drop column if exists deliver_at;

-- 4. Rebuild notification_kind without the two Phase 4 values.
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind' and e.enumlabel = 'resource_published'
  ) then
    -- Any row using them would block the cast; there should be none after step 3's
    -- clean-up, but a throwaway clone can afford to be certain.
    delete from public.notifications
     where kind::text in ('resource_published', 'chapter_published');

    alter table public.notifications alter column kind drop default;
    create type public.notification_kind_pre as enum (
      'registration_approved', 'registration_rejected', 'attendance_marked',
      'teacher_assigned', 'group_updated', 'announcement'
    );
    alter table public.notifications
      alter column kind type public.notification_kind_pre
      using kind::text::public.notification_kind_pre;
    drop type public.notification_kind;
    alter type public.notification_kind_pre rename to notification_kind;
  end if;
end $$;

select 'rewound to pre-Phase-4' as state,
       (select string_agg(enumlabel, ',' order by enumsortorder)
          from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typname = 'notification_kind') as notification_kinds,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'notifications'
           and column_name = 'deliver_at') as deliver_at,
       (select count(*) from pg_views
         where schemaname = 'public'
           and viewname in ('resource_engagement', 'resource_student_engagement')) as views,
       (select count(*) from public.notifications) as notifications,
       (select count(*) from public.resources) as resources;
