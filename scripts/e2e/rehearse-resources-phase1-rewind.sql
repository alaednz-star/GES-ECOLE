-- Put the clone back to its pre-Phase-1 shape, so the migrations can be replayed
-- against a realistic schema WITH DATA rather than an empty one. The point is to
-- reproduce what `supabase db push` will do to production: one transaction per
-- file, in filename order.
--
-- `open` cannot be removed from the enum, so the clone keeps `view` too. To make
-- the replay meaningful anyway, some rows are set back to `open` -- that is the
-- data shape that makes the enum hazard fire.

-- policies, back to their 20260810120000 form
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

drop policy if exists "chapters read" on public.chapters;
create policy "chapters read" on public.chapters for select to authenticated
  using (public.can_manage_group(group_id) or public.is_enrolled_in_group(group_id));

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

-- resources
alter table public.resources
  drop column if exists role,
  drop column if exists pinned,
  drop column if exists file_name,
  drop column if exists file_ext,
  drop column if exists link_provider,
  drop column if exists link_thumbnail_url;
alter table public.resources
  add column if not exists is_important boolean not null default false;
drop trigger if exists t_resources_sync_file_meta on public.resources;
drop function if exists public.resources_sync_file_meta();
drop function if exists public.resource_role_weight(public.resource_role);
drop type if exists public.resource_role;

-- chapters
alter table public.chapters
  drop column if exists pinned,
  drop column if exists is_published,
  drop column if exists published_at;

-- events: back to the constrained, non-append-only shape with `open` rows
delete from public.resource_events a
  using public.resource_events b
 where a.ctid < b.ctid
   and a.resource_id = b.resource_id and a.student_id = b.student_id and a.kind = b.kind;
update public.resource_events set kind = 'open' where kind = 'view';
alter table public.resource_events
  add constraint resource_events_resource_id_student_id_kind_key
  unique (resource_id, student_id, kind);
drop index if exists idx_resource_events_resource_kind;
drop index if exists idx_resource_events_student_kind;

-- functions added by Phase 1
drop function if exists public.resource_role_weight(public.resource_role);
drop function if exists public.center_storage_bytes();
drop function if exists public.center_storage_quota_bytes();
drop function if exists public.storage_quota_allows(bigint);
drop function if exists public.can_view_resource(uuid);
drop function if exists public.can_download_resource(uuid);
drop function if exists public.can_record_resource_event(uuid);

-- bucket, back to 50 MB and the short list
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array[
         'application/pdf','image/png','image/jpeg','image/webp','image/gif',
         'video/mp4','video/webm','audio/mpeg','audio/ogg',
         'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'text/plain','application/json'
       ]
 where id = 'course-resources';

select 'rewound to pre-Phase-1' as state,
       (select count(*) from public.resources) as resources,
       (select count(*) from public.chapters) as chapters,
       (select count(*) from public.resource_events where kind = 'open') as open_events;
