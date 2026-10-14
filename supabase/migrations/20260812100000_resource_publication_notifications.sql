-- ==================================================================
-- Telling students when material becomes available
--
-- ADDITIVE. One column, one unique index, two trigger functions. No existing column
-- changed, no row rewritten, no policy weakened.
--
--
-- WHY THERE IS NO SCHEDULER HERE
--
-- A scheduled publication is not a row write. `published_at` falling due changes what
-- a student can see without anything happening in the database, so no trigger can
-- observe it. The obvious answers are both bad:
--
--   * a trigger that fires on publish and notifies immediately would tell students
--     about material they still cannot open -- the Phase 3 report called this out as
--     the thing not to fake
--   * pg_cron is available in this Postgres image but NOT installed, and making the
--     production migration chain depend on enabling an extension is a real risk on a
--     chain that is already ordering-sensitive. An external tick has the same problem
--     plus clock drift and duplicate delivery
--
-- So the notification is created at the moment the teacher DECIDES, and carries the
-- moment it becomes readable: `deliver_at`. A publication now is deliverable now; a
-- publication scheduled for Monday is a row that exists on Friday and becomes
-- readable on Monday, at the same instant the resource itself does, because both are
-- the same `published_at` comparison against `now()`.
--
-- That needs no scheduler, cannot drift, cannot double-deliver, and is timezone
-- correct because both sides are `timestamptz`.
--
-- `deliver_at` is enforced in RLS, not in the client: a pending notification would
-- otherwise let a student read "Corrigé du DS 2 arrives Monday", which is a small
-- leak but a real one, and exactly the kind that is easy to leave in the client.
--
--
-- IDEMPOTENCY
--
-- One notification per (student, object). A partial unique index over the id carried
-- in `params` is what enforces it, so republishing the same resource five times
-- produces one row -- and there is no new column for something already in the
-- payload. Re-publishing UPDATES the pending row's `deliver_at`; withdrawing DELETES
-- it only while still pending, because a student who has already read a notification
-- should not have their history rewritten.
--
-- ROLLBACK
--   drop trigger t_resources_notify_publication on public.resources;
--   drop trigger t_chapters_notify_publication on public.chapters;
--   drop function public.notify_resource_publication();
--   drop function public.notify_chapter_publication();
--   drop index public.notifications_resource_once;
--   drop index public.notifications_chapter_once;
--   alter table public.notifications drop column deliver_at;
--   -- and restore `notifications read` from 20260803090000.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. When a notification becomes readable
-- ------------------------------------------------------------------

alter table public.notifications
  add column if not exists deliver_at timestamptz not null default now();

comment on column public.notifications.deliver_at is
  'When this notification becomes readable. Equals created_at for anything immediate; for a scheduled publication it equals the resource''s published_at, so the notice and the material appear together. Enforced by the read policy, not by the client.';

-- Existing rows were all immediate. `default now()` covers new ones; this makes the
-- historical ones explicit rather than relying on the default having been applied.
update public.notifications set deliver_at = created_at where deliver_at > created_at;

-- The inbox reads "mine, and due". A composite over exactly that.
create index if not exists idx_notifications_user_due
  on public.notifications (user_id, deliver_at desc);

-- ------------------------------------------------------------------
-- 2. A pending notification is not readable
--
-- Adds ONE conjunct to the existing policy and changes nothing else: a user still
-- reads their own, an admin still reads all. `is_admin()` is deliberately NOT gated
-- on deliver_at -- an admin inspecting the table is not the audience being protected.
-- ------------------------------------------------------------------

drop policy if exists "notifications read" on public.notifications;
create policy "notifications read" on public.notifications for select to authenticated
using (
  (user_id = auth.uid() and deliver_at <= now())
  or private.is_admin()
);

-- ------------------------------------------------------------------
-- 3. One notification per student per object
-- ------------------------------------------------------------------

create unique index if not exists notifications_resource_once
  on public.notifications (user_id, (params ->> 'resourceId'))
  where kind = 'resource_published';

create unique index if not exists notifications_chapter_once
  on public.notifications (user_id, (params ->> 'chapterId'))
  where kind = 'chapter_published';

-- ------------------------------------------------------------------
-- 4. Resources
--
-- SECURITY DEFINER because it writes rows owned by other users, the same as
-- `notify_registration_decision()` in 20260803090000. It is a trigger function and
-- is revoked from every client role, so it cannot be called directly.
-- ------------------------------------------------------------------

create or replace function public.notify_resource_publication()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _live boolean;
  _was_live boolean;
  _due timestamptz;
  _chapter_title text;
begin
  -- "Live" means the teacher intends it to be seen, whether now or later.
  _live := new.is_published;
  _was_live := (tg_op = 'UPDATE') and old.is_published;

  if not _live then
    -- Withdrawn. Remove only what has not been read yet: a delivered notice is part
    -- of the student's history and deleting it would rewrite what they saw.
    if _was_live then
      delete from public.notifications
       where kind = 'resource_published'
         and params ->> 'resourceId' = new.id::text
         and deliver_at > now();
    end if;
    return new;
  end if;

  -- Publication instant. A null `published_at` means immediately.
  _due := greatest(now(), coalesce(new.published_at, now()));

  select c.title into _chapter_title from public.chapters c where c.id = new.chapter_id;

  insert into public.notifications (user_id, kind, params, deliver_at)
  select r.student_id,
         'resource_published'::public.notification_kind,
         jsonb_build_object(
           'resourceId', new.id::text,
           'title', new.title,
           'chapter', coalesce(_chapter_title, '')
         ),
         _due
    from public.registrations r
   where r.group_id = new.group_id
     and r.status = 'approved'
  on conflict (user_id, (params ->> 'resourceId')) where kind = 'resource_published'
  -- Rescheduled or retitled: move the pending notice, never a second one. A notice
  -- already delivered keeps its time, so the inbox order does not shuffle under a
  -- student who has read it.
  do update set deliver_at = case
                   when public.notifications.deliver_at > now() then excluded.deliver_at
                   else public.notifications.deliver_at
                 end,
                params = excluded.params;

  return new;
end;
$$;

revoke all on function public.notify_resource_publication() from public, anon, authenticated;

drop trigger if exists t_resources_notify_publication on public.resources;
create trigger t_resources_notify_publication
after insert or update of is_published, published_at, title, chapter_id
on public.resources
for each row execute function public.notify_resource_publication();

-- ------------------------------------------------------------------
-- 5. Chapters
--
-- Same shape. A chapter becoming live is worth its own notice because it is how a
-- whole block of material arrives at once -- and it is the AND rule's other half, so
-- publishing a chapter is what actually reveals resources that were already
-- published inside a hidden one.
-- ------------------------------------------------------------------

create or replace function public.notify_chapter_publication()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _live boolean;
  _was_live boolean;
  _due timestamptz;
begin
  _live := new.is_published;
  _was_live := (tg_op = 'UPDATE') and old.is_published;

  if not _live then
    if _was_live then
      delete from public.notifications
       where kind = 'chapter_published'
         and params ->> 'chapterId' = new.id::text
         and deliver_at > now();
    end if;
    return new;
  end if;

  _due := greatest(now(), coalesce(new.published_at, now()));

  insert into public.notifications (user_id, kind, params, deliver_at)
  select r.student_id,
         'chapter_published'::public.notification_kind,
         jsonb_build_object('chapterId', new.id::text, 'title', new.title),
         _due
    from public.registrations r
   where r.group_id = new.group_id
     and r.status = 'approved'
  on conflict (user_id, (params ->> 'chapterId')) where kind = 'chapter_published'
  do update set deliver_at = case
                   when public.notifications.deliver_at > now() then excluded.deliver_at
                   else public.notifications.deliver_at
                 end,
                params = excluded.params;

  return new;
end;
$$;

revoke all on function public.notify_chapter_publication() from public, anon, authenticated;

drop trigger if exists t_chapters_notify_publication on public.chapters;
create trigger t_chapters_notify_publication
after insert or update of is_published, published_at, title
on public.chapters
for each row execute function public.notify_chapter_publication();

-- ------------------------------------------------------------------
-- 6. Post-conditions
-- ------------------------------------------------------------------

do $$
declare _n integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications' and column_name = 'deliver_at'
  ) then
    raise exception 'notifications.deliver_at is missing';
  end if;

  select count(*) into _n from pg_indexes
   where schemaname = 'public'
     and indexname in ('notifications_resource_once', 'notifications_chapter_once');
  if _n <> 2 then raise exception 'idempotency indexes missing (%)', _n; end if;

  select count(*) into _n from pg_trigger
   where tgname in ('t_resources_notify_publication', 't_chapters_notify_publication')
     and not tgisinternal;
  if _n <> 2 then raise exception 'publication triggers missing (%)', _n; end if;

  -- Nothing already in the inbox became unreadable.
  select count(*) into _n from public.notifications where deliver_at > now();
  raise notice 'Publication notifications ready. % pending, % total.',
    _n, (select count(*) from public.notifications);
end $$;
