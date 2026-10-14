-- Course resources: chapters, resources, and open/download events.
--
-- Reference: docs/ADR-003-session-architecture.md section 8.1 (the checklist for
-- adding a module).
--
-- WHY CHAPTERS RATHER THAN SESSIONS
--
-- ADR-003 anticipated resources hanging off `(group_id, session_date)` like
-- attendance. The product requirement is different: a teacher organises material
-- by CHAPTER ("Les suites numériques"), and a chapter spans several sessions --
-- it is a unit of curriculum, not of timetable. A student looking for last
-- week's exercise sheet thinks "which chapter?", never "which date?".
--
-- So resources attach to a chapter, and a chapter attaches to a group. The
-- session key is not used here, and that is deliberate rather than an oversight.
-- Everything else in the ADR's checklist still applies: own tables, own RLS
-- mirroring the group's, cascade from `groups`.
--
-- VISIBILITY
--
-- A resource is visible to students when it is `published` AND its
-- `published_at` has passed. Two fields rather than one status column, because
-- "scheduled for Monday" and "hidden" are different intentions and a teacher
-- switching between them should not lose the date.
--
-- ROLLBACK
--   drop table public.resource_events;
--   drop table public.resources;
--   drop table public.chapters;
--   delete from storage.buckets where id = 'course-resources';
--
-- Purely additive: no existing table, column, policy or function is touched.

-- ------------------------------------------------------------------
-- 1. Chapters
--
-- The organising unit. `position` is explicit so a teacher can reorder by drag
-- and drop; ties break on `created_at` so the order is always total.
-- ------------------------------------------------------------------

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chapters_group on public.chapters (group_id, position);

comment on table public.chapters is
  'Curriculum units within a group. Resources hang off chapters, not sessions: a chapter spans several lessons, and students look for material by chapter rather than by date. See 20260810120000_course_resources.sql.';

-- ------------------------------------------------------------------
-- 2. Resources
--
-- Either an uploaded file (`storage_path`) or an external link (`url`), never
-- both and never neither -- enforced by a CHECK so a resource that points
-- nowhere cannot exist.
-- ------------------------------------------------------------------

do $$ begin
  create type public.resource_kind as enum ('file', 'link');
exception when duplicate_object then null; end $$;

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- Denormalised from the chapter so RLS and student queries do not need a join
  -- on every row. Kept in step by the trigger in section 3.
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  kind public.resource_kind not null,
  /** Path inside the `course-resources` bucket. Null for links. */
  storage_path text,
  /** External URL. Null for files. */
  url text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  position integer not null default 0,
  /** Teacher-flagged as important; surfaces at the top of the student view. */
  is_important boolean not null default false,
  /** Students may download the original, not only preview it. */
  allow_download boolean not null default true,
  /** Hidden from students entirely while false, whatever `published_at` says. */
  is_published boolean not null default false,
  /**
   * Publication moment. Null means "as soon as published"; a future value
   * schedules it. Separate from `is_published` so toggling visibility does not
   * discard a chosen date.
   */
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint resources_target_exactly_one check (
    (kind = 'file' and storage_path is not null and url is null) or
    (kind = 'link' and url is not null and storage_path is null)
  )
);

create index if not exists idx_resources_chapter on public.resources (chapter_id, position);
-- The student query is "everything visible in my groups", so group + visibility
-- leads. Partial on published rows: unpublished ones are never read this way.
create index if not exists idx_resources_group_published
  on public.resources (group_id, published_at desc)
  where is_published;

comment on table public.resources is
  'A file in the course-resources bucket, or an external link. Visible to students only when is_published AND published_at has passed.';

-- ------------------------------------------------------------------
-- 3. Keep `resources.group_id` honest
--
-- Denormalised for RLS, so it must never disagree with the chapter. Derived by
-- trigger rather than trusted from the client -- a wrong value here would be a
-- permission bug, not a display bug.
-- ------------------------------------------------------------------

create or replace function public.resources_sync_group()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select c.group_id into new.group_id
    from public.chapters c where c.id = new.chapter_id;
  if new.group_id is null then
    raise exception 'Chapter % does not exist', new.chapter_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.resources_sync_group() from public, anon;

drop trigger if exists t_resources_sync_group on public.resources;
create trigger t_resources_sync_group
before insert or update of chapter_id on public.resources
for each row execute function public.resources_sync_group();

-- ------------------------------------------------------------------
-- 4. Resource events
--
-- One row per student per resource per action. Powers "opened / not opened" in
-- the student view and the per-resource counts in the teacher drawer.
--
-- UNIQUE on (resource, student, kind) keeps it a STATE, not a log: the product
-- question is "has this student opened it?", so a second open updates the
-- timestamp instead of growing the table without bound.
-- ------------------------------------------------------------------

do $$ begin
  create type public.resource_event_kind as enum ('open', 'download');
exception when duplicate_object then null; end $$;

create table if not exists public.resource_events (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind public.resource_event_kind not null default 'open',
  occurred_at timestamptz not null default now(),
  unique (resource_id, student_id, kind)
);

create index if not exists idx_resource_events_resource on public.resource_events (resource_id);
create index if not exists idx_resource_events_student on public.resource_events (student_id);

comment on table public.resource_events is
  'Whether a student has opened/downloaded a resource. UNIQUE per (resource, student, kind) so this is current state, not an unbounded log.';

-- ------------------------------------------------------------------
-- 5. `updated_at`
-- ------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists t_chapters_touch on public.chapters;
create trigger t_chapters_touch before update on public.chapters
for each row execute function public.touch_updated_at();

drop trigger if exists t_resources_touch on public.resources;
create trigger t_resources_touch before update on public.resources
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- 6. Grants
--
-- Mirrors 20260802210200_revoke_unnecessary_grants.sql: `authenticated` gets the
-- four DML verbs and RLS decides the rows; `anon` gets nothing.
-- ------------------------------------------------------------------

grant select, insert, update, delete on public.chapters       to authenticated;
grant select, insert, update, delete on public.resources      to authenticated;
grant select, insert, update, delete on public.resource_events to authenticated;
grant all on public.chapters        to service_role;
grant all on public.resources       to service_role;
grant all on public.resource_events to service_role;
revoke all on public.chapters        from anon;
revoke all on public.resources       from anon;
revoke all on public.resource_events from anon;

alter table public.chapters        enable row level security;
alter table public.resources       enable row level security;
alter table public.resource_events enable row level security;

-- ------------------------------------------------------------------
-- 7. RLS
--
-- The asymmetry attendance already uses: staff WRITE, enrolled students READ.
-- A teacher is scoped to the groups they own; an admin sees everything.
--
-- Students read a chapter only if they have an approved registration in its
-- group, and a resource only if it is additionally published and due.
-- ------------------------------------------------------------------

/** True when the caller owns the group, or is an admin. */
create or replace function public.can_manage_group(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select private.is_admin() or exists (
    select 1 from public.groups g
     where g.id = _group_id and g.teacher_id = auth.uid()
  );
$$;

/** True when the caller has an approved registration in the group. */
create or replace function public.is_enrolled_in_group(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.registrations r
     where r.group_id = _group_id
       and r.student_id = auth.uid()
       and r.status = 'approved'
  );
$$;

revoke all on function public.can_manage_group(uuid) from public, anon;
revoke all on function public.is_enrolled_in_group(uuid) from public, anon;
grant execute on function public.can_manage_group(uuid) to authenticated, service_role;
grant execute on function public.is_enrolled_in_group(uuid) to authenticated, service_role;

-- Chapters
drop policy if exists "chapters read" on public.chapters;
create policy "chapters read" on public.chapters for select to authenticated
  using (public.can_manage_group(group_id) or public.is_enrolled_in_group(group_id));

drop policy if exists "chapters write" on public.chapters;
create policy "chapters write" on public.chapters for all to authenticated
  using (public.can_manage_group(group_id))
  with check (public.can_manage_group(group_id));

-- Resources
drop policy if exists "resources read" on public.resources;
create policy "resources read" on public.resources for select to authenticated
  using (
    public.can_manage_group(group_id)
    or (
      public.is_enrolled_in_group(group_id)
      and is_published
      and (published_at is null or published_at <= now())
    )
  );

drop policy if exists "resources write" on public.resources;
create policy "resources write" on public.resources for all to authenticated
  using (public.can_manage_group(group_id))
  with check (public.can_manage_group(group_id));

-- Events: a student writes only their OWN, and only for a resource they may see.
drop policy if exists "resource events read" on public.resource_events;
create policy "resource events read" on public.resource_events for select to authenticated
  using (
    student_id = auth.uid()
    or exists (
      select 1 from public.resources r
       where r.id = resource_id and public.can_manage_group(r.group_id)
    )
  );

drop policy if exists "resource events insert" on public.resource_events;
create policy "resource events insert" on public.resource_events for insert to authenticated
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.resources r
       where r.id = resource_id and public.is_enrolled_in_group(r.group_id)
    )
  );

drop policy if exists "resource events update" on public.resource_events;
create policy "resource events update" on public.resource_events for update to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ------------------------------------------------------------------
-- 8. Storage
--
-- PRIVATE bucket. Files are reached through short-lived signed URLs only, so a
-- leaked path is not a leaked document.
--
-- Paths are `<group_id>/<resource_id>/<filename>`, which lets the policies below
-- authorise on the leading folder without a join back to `resources` -- the row
-- may not exist yet at upload time.
-- ------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-resources', 'course-resources', false,
  52428800, -- 50 MB; a scanned exercise sheet is ~2 MB, a short video ~30 MB
  array[
    'application/pdf',
    'image/png','image/jpeg','image/webp','image/gif',
    'video/mp4','video/webm',
    'audio/mpeg','audio/mp4','audio/webm',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

drop policy if exists "course resources staff write" on storage.objects;
create policy "course resources staff write" on storage.objects for all to authenticated
  using (
    bucket_id = 'course-resources'
    and public.can_manage_group(nullif(split_part(name, '/', 1), '')::uuid)
  )
  with check (
    bucket_id = 'course-resources'
    and public.can_manage_group(nullif(split_part(name, '/', 1), '')::uuid)
  );

drop policy if exists "course resources enrolled read" on storage.objects;
create policy "course resources enrolled read" on storage.objects for select to authenticated
  using (
    bucket_id = 'course-resources'
    and (
      public.can_manage_group(nullif(split_part(name, '/', 1), '')::uuid)
      or exists (
        select 1 from public.resources r
         where r.storage_path = storage.objects.name
           and public.is_enrolled_in_group(r.group_id)
           and r.is_published
           and (r.published_at is null or r.published_at <= now())
      )
    )
  );

-- ------------------------------------------------------------------
-- 9. Post-conditions
-- ------------------------------------------------------------------

do $$
declare _t text;
begin
  foreach _t in array array['chapters','resources','resource_events'] loop
    if not exists (select 1 from pg_tables where schemaname='public' and tablename=_t) then
      raise exception 'table public.% missing', _t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.'||_t)::regclass) then
      raise exception 'SECURITY: RLS not enabled on public.%', _t;
    end if;
    if exists (
      select 1 from information_schema.role_table_grants
       where table_schema='public' and table_name=_t and grantee='anon'
    ) then
      raise exception 'SECURITY: anon holds a privilege on public.%', _t;
    end if;
  end loop;

  if not exists (select 1 from storage.buckets where id='course-resources' and public = false) then
    raise exception 'SECURITY: course-resources bucket missing or public';
  end if;

  raise notice 'Course resources ready: 3 tables, RLS on, private bucket, signed-URL access only.';
end $$;
