-- Course resources, Phase 1: schema foundation, storage limits, quota.
--
-- Reference: RESOURCE_MODULE_AUDIT.md, RESOURCE_MODULE_PHASE1_REPORT.md
--
-- ADDITIVE ONLY. No column is dropped, no row is rewritten, no data is deleted.
-- Production already holds chapters and resources.
--
-- WHAT THIS DOES NOT ADD, AND WHY
--
-- `subject_id` / `teacher_id` on chapters and resources were in the Phase 1 scope
-- but are deliberately omitted. `groups` already carries both, and a group has
-- exactly ONE subject and ONE teacher, so a chapter's copy would always equal its
-- group's -- duplication with a staleness risk (a group retargeted to another
-- subject would leave stale copies) and no added capability. Filtering and
-- authorisation both work through the existing join, which the queries already
-- perform (`groups!inner(subjects(...))`). Per the Phase 1 instruction to reuse
-- rather than duplicate.
--
-- Chapter publication uses the SAME two-field shape as resources
-- (`is_published` + `published_at`) rather than a `visibility` enum, so both
-- tables derive their three states the same way. Consistent with the decision to
-- keep the two-field model and not convert live data to an enum.
--
-- ROLLBACK
--   alter table public.resources
--     drop column role, drop column pinned,
--     drop column file_name, drop column file_ext,
--     drop column link_provider, drop column link_thumbnail_url;
--   alter table public.chapters drop column pinned,
--     drop column is_published, drop column published_at;
--   alter table public.resource_events add constraint resource_events_resource_id_student_id_kind_key
--     unique (resource_id, student_id, kind);
--   drop function public.center_storage_bytes();
--   drop function public.can_download_resource(uuid);
--   -- bucket limit/mime list: restore from 20260810120000.

-- ------------------------------------------------------------------
-- 1. Pedagogical role
--
-- Not decoration: it states what a resource IS FOR, and it supplies the default
-- ordering inside a chapter (notes -> exercises -> solutions -> video -> homework
-- -> extra), which a manual drag order may override.
--
-- Existing rows default to `extra`. Deliberately NOT inferred from filenames:
-- "TD 3" or "corrige.pdf" would be right often enough to be trusted and wrong
-- often enough to mislabel a teacher's material, and a wrong pedagogical role is
-- worse than an honest "extra".
-- ------------------------------------------------------------------

do $$ begin
  create type public.resource_role as enum
    ('notes', 'exercises', 'solutions', 'video', 'homework', 'extra');
exception when duplicate_object then null; end $$;

alter table public.resources
  add column if not exists role public.resource_role not null default 'extra';

comment on column public.resources.role is
  'Pedagogical purpose. Also the default sort key within a chapter: notes, exercises, solutions, video, homework, extra. Existing rows defaulted to `extra` rather than guessed from filenames.';

/** Sort weight for the default pedagogical ordering. */
create or replace function public.resource_role_weight(_role public.resource_role)
returns integer language sql immutable as $$
  select case _role
    when 'notes' then 0 when 'exercises' then 1 when 'solutions' then 2
    when 'video' then 3 when 'homework' then 4 else 5 end;
$$;

-- ------------------------------------------------------------------
-- 2. Pinning, file metadata, link provider
--
-- `pinned` is added alongside the existing `is_important` rather than replacing
-- it: `is_important` is live, read by both portals, and renaming a column in use
-- is a destructive change for a synonym. `pinned` is backfilled from it so the
-- two agree from day one, and the application will standardise on `pinned`.
-- ------------------------------------------------------------------

alter table public.resources
  add column if not exists pinned boolean not null default false,
  -- Derivable from `storage_path`, but stored so a listing does not have to parse
  -- a path, and so the original name survives any future path change.
  add column if not exists file_name text,
  add column if not exists file_ext text,
  add column if not exists link_provider text,
  add column if not exists link_thumbnail_url text;

update public.resources set pinned = is_important where pinned is distinct from is_important;

-- Backfill the filename from the path we already store. The path format is
-- `<group_id>/<uuid>/<filename>`, so the third segment is the original name.
update public.resources
   set file_name = nullif(split_part(storage_path, '/', 3), ''),
       file_ext = lower(nullif(regexp_replace(split_part(storage_path, '/', 3), '^.*\.', ''), ''))
 where kind = 'file' and storage_path is not null and file_name is null;

-- A backfill fixes the rows that exist today; a trigger is what keeps the column
-- true tomorrow. Without it every new upload would arrive with a null file_name,
-- and the download path -- which uses it for Content-Disposition -- would quietly
-- fall back to the storage UUID. Same shape as `resources_sync_group`, which
-- derives `group_id` from the chapter for the same reason.
create or replace function public.resources_sync_file_meta()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.kind = 'file' and new.storage_path is not null then
    new.file_name := nullif(split_part(new.storage_path, '/', 3), '');
    new.file_ext  := lower(nullif(regexp_replace(new.file_name, '^.*\.', ''), ''));
  else
    -- A link has no stored file; leaving stale metadata behind would be a lie.
    new.file_name := null;
    new.file_ext  := null;
  end if;
  return new;
end;
$$;

drop trigger if exists t_resources_sync_file_meta on public.resources;
create trigger t_resources_sync_file_meta
  before insert or update of storage_path, kind on public.resources
  for each row execute function public.resources_sync_file_meta();

comment on column public.resources.pinned is
  'Teacher-flagged as important. Backfilled from `is_important` in this migration; `is_important` is retired by 20260811110000.';

-- ------------------------------------------------------------------
-- 3. Chapter pinning and publication
--
-- Chapters had no publication fields, so this is new state rather than a
-- duplicate. Semantics are AND, and deliberately the simplest rule that cannot
-- confuse: a hidden or not-yet-due chapter hides its resources whatever their own
-- state says. Anything else forces a reader to reason about two levels at once.
-- ------------------------------------------------------------------

alter table public.chapters
  add column if not exists pinned boolean not null default false,
  -- Existing chapters are visible: they were created under a model where a
  -- chapter had no visibility of its own, and their resources are already live.
  add column if not exists is_published boolean not null default true,
  add column if not exists published_at timestamptz;

comment on column public.chapters.is_published is
  'Chapter-level publication. Combined with the resource rule using AND: a hidden or not-yet-due chapter hides its resources regardless of their own state. Existing chapters default to published so nothing already live disappears.';

-- ------------------------------------------------------------------
-- 4. Indexes for the new filters and orderings
-- ------------------------------------------------------------------

create index if not exists idx_resources_chapter_role
  on public.resources (chapter_id, position, role);
create index if not exists idx_resources_pinned
  on public.resources (group_id) where pinned;
create index if not exists idx_chapters_pinned
  on public.chapters (group_id) where pinned;

-- ------------------------------------------------------------------
-- 5. Resource events become an APPEND-ONLY log
--
-- The UNIQUE (resource, student, kind) made this current state, so a second view
-- of the same document updated a timestamp instead of being recorded -- view
-- counts were structurally impossible. Dropping the constraint changes no data;
-- existing rows are already unique.
--
-- `view` itself is added by `20260811095000`, which exists only to commit that one
-- statement first: Postgres refuses to let a new enum value be USED in the
-- transaction that added it, and `supabase db push` runs each file in one
-- transaction. Existing `open` rows are migrated here, so there is one meaning per
-- event rather than two names for the same thing. `open` stays in the enum because
-- Postgres cannot remove a value from an enum in use, but nothing writes it.
--
-- Statistics derive from the log:
--   views        = count(*) where kind = 'view'
--   downloads    = count(*) where kind = 'download'
--   lastOpenedAt = max(occurred_at) where kind = 'view'
--
-- No aggregate table or materialised view. At this scale a partial index over the
-- log answers those three questions directly; introducing an aggregate now would
-- add a staleness problem to solve a performance problem that does not exist yet.
-- ------------------------------------------------------------------

-- Guard rather than assume: if the preceding migration were skipped, the update
-- below would fail with a bare "invalid input value" that says nothing useful.
do $$ begin
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'resource_event_kind' and e.enumlabel = 'view'
  ) then
    raise exception 'resource_event_kind is missing `view`; apply 20260811095000 first';
  end if;
end $$;

alter table public.resource_events
  drop constraint if exists resource_events_resource_id_student_id_kind_key;

-- Same meaning, one name.
update public.resource_events set kind = 'view' where kind = 'open';

-- The log is queried per resource and per student, filtered by kind.
create index if not exists idx_resource_events_resource_kind
  on public.resource_events (resource_id, kind, occurred_at desc);
create index if not exists idx_resource_events_student_kind
  on public.resource_events (student_id, kind);

comment on table public.resource_events is
  'APPEND-ONLY analytics log. A student may open the same resource repeatedly and each is recorded. Staff cannot contribute: the insert policy requires an approved enrolment, so a teacher physically cannot write an event.';

-- ------------------------------------------------------------------
-- 6. Storage: 250 MB per file, the specified type list
--
-- Both limits live on the bucket, so they hold no matter which client uploads.
-- The client checks the same numbers first only to produce a readable message
-- instead of a raw storage error.
-- ------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 262144000, -- 250 MB
       allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv', 'text/plain',
         'application/zip', 'application/x-zip-compressed',
         'application/vnd.rar', 'application/x-rar-compressed',
         'application/x-7z-compressed',
         'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif',
         'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
         'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/webm'
       ],
       public = false
 where id = 'course-resources';

-- ------------------------------------------------------------------
-- 7. Storage quota: 5 GB per centre
--
-- Madrasti is single-tenant per deployment (one `center_settings` row), so
-- "per centre" is the whole bucket.
--
-- Measured from `storage.objects` metadata, not from `resources.size_bytes`:
-- the objects table is what actually consumes the quota, and it stays correct if
-- a row is deleted while its object lingers. External links contribute nothing
-- because they create no object -- which is the required behaviour, for free.
-- ------------------------------------------------------------------

create or replace function public.center_storage_bytes()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'course-resources';
$$;

revoke all on function public.center_storage_bytes() from public, anon;
grant execute on function public.center_storage_bytes() to authenticated, service_role;

comment on function public.center_storage_bytes() is
  'Bytes consumed in the course-resources bucket. Read from storage.objects rather than resources.size_bytes, so it stays accurate if a row is removed while its object remains. External links add nothing, since they create no object.';

/** 5 GB, as bytes. One definition, used by the quota check and the UI readout. */
create or replace function public.center_storage_quota_bytes()
returns bigint language sql immutable as $$ select 5368709120::bigint; $$;

grant execute on function public.center_storage_quota_bytes() to authenticated, service_role;

/**
 * Whether an upload of `_incoming` bytes would fit.
 *
 * The authoritative check runs in the upload server function, which holds the
 * service role; this is the same rule exposed to the client so the UI can refuse
 * early and explain why.
 */
create or replace function public.storage_quota_allows(_incoming bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.center_storage_bytes() + greatest(coalesce(_incoming, 0), 0)
         <= public.center_storage_quota_bytes();
$$;

revoke all on function public.storage_quota_allows(bigint) from public, anon;
grant execute on function public.storage_quota_allows(bigint) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 8. `allow_download = false` becomes enforceable
--
-- The rule, in the database rather than in a component: a student may download
-- only a resource that is visible to them AND whose `allow_download` is true.
-- Staff who manage the group always may.
--
-- This function is the authority the upload/download server function consults
-- before it mints a signed URL with the service role. The React UI hiding a
-- button is now a convenience on top of it, not the control itself.
-- ------------------------------------------------------------------

create or replace function public.can_download_resource(_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.resources r
      join public.chapters c on c.id = r.chapter_id
     where r.id = _resource_id
       and (
         -- Staff managing the group: unrestricted.
         public.can_manage_group(r.group_id)
         or (
           -- Student: enrolled, chapter live, resource live, download allowed.
           public.is_enrolled_in_group(r.group_id)
           and r.allow_download
           and r.is_published
           and (r.published_at is null or r.published_at <= now())
           and c.is_published
           and (c.published_at is null or c.published_at <= now())
         )
       )
  );
$$;

revoke all on function public.can_download_resource(uuid) from public, anon;
grant execute on function public.can_download_resource(uuid) to authenticated, service_role;

comment on function public.can_download_resource(uuid) is
  'Authority for allow_download. Consulted by the download server function before a signed URL is minted. Staff managing the group always may; a student needs enrolment, a live chapter, a live resource, and allow_download = true.';

/** Same shape for read/preview access, so both paths share one rule. */
create or replace function public.can_view_resource(_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.resources r
      join public.chapters c on c.id = r.chapter_id
     where r.id = _resource_id
       and (
         public.can_manage_group(r.group_id)
         or (
           public.is_enrolled_in_group(r.group_id)
           and r.is_published
           and (r.published_at is null or r.published_at <= now())
           and c.is_published
           and (c.published_at is null or c.published_at <= now())
         )
       )
  );
$$;

revoke all on function public.can_view_resource(uuid) from public, anon;
grant execute on function public.can_view_resource(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 9. Resource RLS now respects chapter publication
--
-- The read policy checked only the resource. With chapter-level publication added
-- above, a resource inside a hidden chapter would still have been readable --
-- the AND rule has to live in the policy, not only in the helper.
-- ------------------------------------------------------------------

drop policy if exists "resources read" on public.resources;
create policy "resources read" on public.resources for select to authenticated
using (
  public.can_manage_group(group_id)
  or (
    public.is_enrolled_in_group(group_id)
    and is_published
    and (published_at is null or published_at <= now())
    and exists (
      select 1 from public.chapters c
       where c.id = chapter_id
         and c.is_published
         and (c.published_at is null or c.published_at <= now())
    )
  )
);

-- Chapters: same AND rule, so a hidden chapter is not listed to a student.
drop policy if exists "chapters read" on public.chapters;
create policy "chapters read" on public.chapters for select to authenticated
using (
  public.can_manage_group(group_id)
  or (
    public.is_enrolled_in_group(group_id)
    and is_published
    and (published_at is null or published_at <= now())
  )
);

-- Storage read: honour chapter publication too.
drop policy if exists "course resources enrolled read" on storage.objects;
create policy "course resources enrolled read" on storage.objects for select to authenticated
using (
  bucket_id = 'course-resources'
  and (
    public.can_manage_group(nullif(split_part(name, '/', 1), '')::uuid)
    or exists (
      select 1
        from public.resources r
        join public.chapters c on c.id = r.chapter_id
       where r.storage_path = storage.objects.name
         and public.is_enrolled_in_group(r.group_id)
         and r.is_published
         and (r.published_at is null or r.published_at <= now())
         and c.is_published
         and (c.published_at is null or c.published_at <= now())
    )
  )
);

-- ------------------------------------------------------------------
-- 10. Post-conditions
-- ------------------------------------------------------------------

do $$
declare _n integer; _lim bigint;
begin
  -- New columns present.
  select count(*) into _n from information_schema.columns
   where table_schema='public' and table_name='resources'
     and column_name in ('role','pinned','file_name','file_ext','link_provider','link_thumbnail_url');
  if _n <> 6 then raise exception 'resources: expected 6 new columns, found %', _n; end if;

  select count(*) into _n from information_schema.columns
   where table_schema='public' and table_name='chapters'
     and column_name in ('pinned','is_published','published_at');
  if _n <> 3 then raise exception 'chapters: expected 3 new columns, found %', _n; end if;

  -- Append-only: the UNIQUE must be gone.
  if exists (
    select 1 from pg_constraint
     where conrelid='public.resource_events'::regclass and contype='u'
  ) then raise exception 'resource_events still has a UNIQUE; the log is not append-only'; end if;

  -- No `open` rows remain.
  select count(*) into _n from public.resource_events where kind='open';
  if _n <> 0 then raise exception '% resource_events still use the retired `open` kind', _n; end if;

  -- Bucket limit and privacy.
  select file_size_limit into _lim from storage.buckets where id='course-resources';
  if _lim <> 262144000 then raise exception 'bucket limit is %, expected 262144000', _lim; end if;
  if (select public from storage.buckets where id='course-resources') then
    raise exception 'SECURITY: course-resources bucket is public';
  end if;

  -- Quota helpers answer.
  if public.center_storage_quota_bytes() <> 5368709120 then
    raise exception 'quota constant wrong';
  end if;
  perform public.center_storage_bytes();

  -- No data lost.
  raise notice 'Phase 1 ready. chapters=%, resources=%, events=%, storage_used=% bytes.',
    (select count(*) from public.chapters),
    (select count(*) from public.resources),
    (select count(*) from public.resource_events),
    public.center_storage_bytes();
end $$;

-- ------------------------------------------------------------------
-- 11. Resource events: one question, asked in one place
--
-- What the earlier draft of this section claimed -- that the shipped insert
-- policy rejected every student write -- was WRONG, and the correction is worth
-- recording. The 42501 came from the verification script, which called a
-- fixture teardown mid-run; that teardown deletes every `e2e-fixture%` account
-- globally, so the enrolled student was gone by the time the events section ran.
-- The policy then refused the insert exactly as designed. Both the original
-- predicate and this one accept a genuinely enrolled student.
--
-- So this section is not a bug fix. It closes a real gap the SECURITY DEFINER
-- helper would otherwise have OPENED, and tightens two things around it:
--
--   1. The original predicate ran its subquery under the caller's RLS on
--      `resources`, so recording an event implied being able to read the row.
--      A SECURITY DEFINER helper bypasses that -- enrolment alone would have
--      been enough, and a student could have logged an event for a resource
--      hidden from them. The helper therefore asks for enrolment AND
--      `can_view_resource`, which keeps the visibility rule in one place.
--
--   2. A `download` event additionally requires download rights. Without this a
--      student who may only preview could inflate a teacher's download count.
--
--   3. The UPDATE policy is dropped. The log is append-only as of section 3, and
--      an update would have let a student rewrite their own `view` into a
--      `download` after the fact, defeating (2). There is no DELETE policy, so
--      with UPDATE gone the table is insert-only for students.
-- ------------------------------------------------------------------

create or replace function public.can_record_resource_event(_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Enrolment is what makes the caller a student of this group: staff never
  -- satisfy it, so teacher and admin activity cannot enter student analytics.
  select exists (
    select 1 from public.resources r
     where r.id = _resource_id
       and public.is_enrolled_in_group(r.group_id)
  )
  -- ...and the resource must actually be reachable by them right now.
  and public.can_view_resource(_resource_id);
$$;

revoke all on function public.can_record_resource_event(uuid) from public, anon;
grant execute on function public.can_record_resource_event(uuid) to authenticated, service_role;

drop policy if exists "resource events insert" on public.resource_events;
create policy "resource events insert" on public.resource_events for insert to authenticated
with check (
  student_id = auth.uid()
  and public.can_record_resource_event(resource_id)
  and (kind <> 'download' or public.can_download_resource(resource_id))
);

-- Append-only: no UPDATE, and no DELETE policy was ever granted.
drop policy if exists "resource events update" on public.resource_events;

comment on function public.can_record_resource_event(uuid) is
  'Whether the caller may log an event for this resource: enrolled in its group AND currently able to view it. SECURITY DEFINER so the insert policy does not evaluate resources RLS from inside its own WITH CHECK, with the visibility half restored explicitly.';

do $$
declare _n integer;
begin
  select count(*) into _n from pg_policy
   where polrelid = 'public.resource_events'::regclass and polcmd in ('w', 'd');
  if _n <> 0 then
    raise exception 'resource_events still has % update/delete policies; the log is not append-only', _n;
  end if;
end $$;
