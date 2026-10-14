-- ==================================================================
-- A bucket for profile photos
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- `profiles.avatar_url` has existed since the first migration, so no schema change is
-- needed and none is made here. But there was NO BUCKET: the only one is
-- `course-resources`. The profile page therefore could not upload anything -- it
-- accepted a pasted `https://` URL and validated it with a regex, which means every
-- profile photo in the product had to be hosted somewhere else. That is the functional
-- defect, and a bucket is the smallest thing that fixes it.
--
-- ADDITIVE. One bucket, four policies. No table, no column, no existing policy
-- touched.
--
--
-- PUBLIC READ, RESTRICTED WRITE
--
-- Unlike course material, an avatar is rendered in lists seen by many people at once:
-- a student browsing the catalogue sees a dozen teachers' photos. Signing every one of
-- those would mean a dozen round trips per page and a cache that expires in an hour,
-- for a 40 kB image that is not confidential.
--
-- So reads are public and WRITES are not. The concern is that nobody may replace
-- someone else's photo, and that is enforced on the path: an object under `<uid>/` may
-- only be written by that user, or by an admin. The leading folder is the user id, the
-- same shape `course-resources` uses for the group id.
--
-- SVG is deliberately absent from the MIME list. An SVG is a script container; served
-- from a public bucket it would be a stored-XSS vector, and no profile photo needs it.
--
-- 2 MB, because a photo displayed at 96px does not need more, and the smaller limit is
-- what keeps a public bucket from becoming free hosting.
--
-- ROLLBACK
--   delete from storage.objects where bucket_id = 'avatars';
--   delete from storage.buckets where id = 'avatars';
--   drop policy "avatars public read" on storage.objects;
--   drop policy "avatars owner insert" on storage.objects;
--   drop policy "avatars owner update" on storage.objects;
--   drop policy "avatars owner delete" on storage.objects;
-- Irreversible in one respect: the objects themselves are gone. `profiles.avatar_url`
-- would keep pointing at them, so a rollback should also null the column for rows
-- whose URL points into this bucket.
-- ==================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------
-- Read: anyone. A profile photo is shown to students, teachers and staff alike, and
-- signing each one would cost a round trip per face on the page.
-- ------------------------------------------------------------------

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- ------------------------------------------------------------------
-- Write: only into your own folder.
--
-- `split_part(name, '/', 1)` is the leading folder, which the client sets to the
-- caller's own id. A user cannot write outside it, so nobody can replace another
-- person's photo -- the requirement that mattered.
-- ------------------------------------------------------------------

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or private.is_admin())
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or private.is_admin())
  )
  with check (
    bucket_id = 'avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or private.is_admin())
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or private.is_admin())
  );

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

do $$
declare _n integer; _public boolean;
begin
  select public into _public from storage.buckets where id = 'avatars';
  if _public is null then raise exception 'the avatars bucket was not created'; end if;

  select count(*) into _n from storage.buckets
   where id = 'avatars' and 'image/svg+xml' = any(allowed_mime_types);
  if _n <> 0 then
    raise exception 'SVG is allowed in the avatars bucket; it is a stored-XSS vector on a public bucket';
  end if;

  select count(*) into _n from pg_policy
   where polrelid = 'storage.objects'::regclass and polname like 'avatars %';
  if _n <> 4 then raise exception 'expected 4 avatar policies, found %', _n; end if;

  -- The write policies must be scoped to the caller's own folder. Assert the shape
  -- rather than trust it: a policy of `bucket_id = 'avatars'` alone would make every
  -- profile photo in the product writable by anyone signed in.
  select count(*) into _n from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname in ('avatars owner insert', 'avatars owner update', 'avatars owner delete')
     and coalesce(pg_get_expr(polwithcheck, polrelid), '') ||
         coalesce(pg_get_expr(polqual, polrelid), '') like '%split_part%';
  if _n <> 3 then
    raise exception 'an avatar write policy is not scoped to the owner folder (%)', _n;
  end if;

  raise notice 'avatars bucket ready: public read, owner-only writes, 2 MB, no SVG.';
end $$;
