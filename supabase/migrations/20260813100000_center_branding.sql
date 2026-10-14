-- ==================================================================
-- School branding on the existing singleton
--
-- WHY THIS MIGRATION EXISTS
--
-- `center_settings` already carries `school_name` and `logo_url`. Neither is rendered
-- anywhere -- `logo_url` has been a write-only field since the first migration -- and
-- there is nowhere to store a tagline, a colour, or a favicon. A deployment sold to
-- a real school has to be able to look like that school, and today the
-- database cannot describe it.
--
-- SINGLE-TENANT, DELIBERATELY. `center_settings.id` is `boolean PRIMARY KEY CHECK (id)`:
-- one row, forever. That is not changed here. This deployment is one school, and the
-- branding it stores is that school's. Nothing gains a `school_id`; no RLS policy is
-- rewritten. See docs/ROADMAP.md on multi-tenancy -- it remains an open decision, and
-- this migration is deliberately compatible with either answer to it.
--
-- ADDITIVE. Six nullable columns, six check constraints, one bucket, four storage
-- policies. No column is dropped, renamed or retyped. No existing policy is touched.
--
--
-- WHY THE COLOUR COLUMNS ARE NULLABLE AND HAVE NO DEFAULT
--
-- A default here would be a second copy of the palette. The application already ships
-- Madrasti's colours in `styles.css`, and the brand provider falls back to them when a
-- value is absent -- which is also what has to happen when the branding QUERY fails, not
-- merely when a column is null. One fallback path, exercised by both cases, is worth
-- more than a default that only covers one of them.
--
-- So: NULL means "this school has not chosen; use the platform's own". An unbranded
-- deployment therefore looks exactly as it does today.
--
--
-- WHY THE CONSTRAINTS ARE INLINE REGEXES AND NOT A HELPER FUNCTION
--
-- A `private.is_hex_colour()` would read better and be six lines shorter. It would also
-- be a single object whose replacement silently weakens six constraints at once, with no
-- re-validation of the rows already stored. These values are interpolated into a CSS
-- custom property and an <img src>; the check that stops that being an injection vector
-- should not be indirectable.
--
-- `#RRGGBB` and nothing else. Not `rgb()`, not `oklch()`, not a named colour: the point
-- is a format with no syntax in it, so that a stored value like
--   `red; } body { display: none`
-- cannot survive contact with the constraint, let alone reach a stylesheet.
--
--
-- ROLLBACK
--   alter table public.center_settings
--     drop constraint if exists center_settings_primary_color_hex,
--     drop constraint if exists center_settings_brand_gold_hex,
--     drop constraint if exists center_settings_brand_gold_soft_hex,
--     drop constraint if exists center_settings_logo_url_https,
--     drop constraint if exists center_settings_logo_dark_url_https,
--     drop constraint if exists center_settings_favicon_url_https,
--     drop column if exists tagline,
--     drop column if exists logo_dark_url,
--     drop column if exists favicon_url,
--     drop column if exists primary_color,
--     drop column if exists brand_gold,
--     drop column if exists brand_gold_soft;
--   delete from storage.objects where bucket_id = 'branding';
--   delete from storage.buckets where id = 'branding';
--   drop policy if exists "branding public read" on storage.objects;
--   drop policy if exists "branding admin insert" on storage.objects;
--   drop policy if exists "branding admin update" on storage.objects;
--   drop policy if exists "branding admin delete" on storage.objects;
--
-- Irreversible in one respect: the objects are gone, and the URL columns would keep
-- pointing at them. A rollback should null the three asset columns as well.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. The columns
-- ------------------------------------------------------------------

alter table public.center_settings
  add column if not exists tagline         text,
  add column if not exists logo_dark_url   text,
  add column if not exists favicon_url     text,
  add column if not exists primary_color   text,
  add column if not exists brand_gold      text,
  add column if not exists brand_gold_soft text;

comment on column public.center_settings.tagline is
  'The school''s own line, shown under the wordmark. NULL falls back to the platform tagline.';
comment on column public.center_settings.logo_dark_url is
  'Optional light-on-dark mark. NULL falls back to logo_url, then to the built-in mark.';
comment on column public.center_settings.primary_color is
  '#RRGGBB. Overrides --primary. NULL keeps the platform teal.';
comment on column public.center_settings.brand_gold is
  '#RRGGBB decorative material. NEVER mapped onto --accent, which means "pending".';
comment on column public.center_settings.brand_gold_soft is
  'Optional. NULL derives a wash from brand_gold in the client rather than storing two golds.';

-- A URL this product will put in an <img src>. Shared by the three asset columns so the
-- rule cannot drift between them, and IMMUTABLE so it can be used in a check constraint.
create or replace function public.is_safe_asset_url(url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select url is null
      or (
        (
          url ~ '^https://[^[:space:]]+$'
          or url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/[^[:space:]]*$'
        )
        and url !~ '["''<>]'
        and strpos(url, chr(92)) = 0
      );
$$;

comment on function public.is_safe_asset_url(text) is
  'True for a URL safe to render in an <img src>: https anywhere, or http on loopback only (the local Supabase stack). Refuses data:, javascript:, protocol-relative, quotes, angle brackets and backslashes.';

revoke all on function public.is_safe_asset_url(text) from public, anon;
grant execute on function public.is_safe_asset_url(text) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. The one pre-existing row
--
-- `logo_url` has been writable since the first migration behind nothing but a browser
-- regex, and browser validation is not a security boundary. Anything already stored that
-- the new constraint would reject is cleared before the constraint is added, so the
-- migration cannot fail on data written under the old rules -- and so that a value that
-- would not be safe to render stops being rendered.
-- ------------------------------------------------------------------

do $$
declare _cleared text;
begin
  select logo_url into _cleared from public.center_settings
   where logo_url is not null and not public.is_safe_asset_url(logo_url);

  if _cleared is not null then
    update public.center_settings set logo_url = null;
    raise notice 'center_settings.logo_url cleared: % did not pass the new URL rule', _cleared;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 3. The constraints
--
-- https, or loopback.
--
-- No `data:` (an inline document), no `javascript:`, no protocol-relative `//host` that
-- would follow the page down to http, no whitespace, no quote, no angle bracket and no
-- backslash -- these land in an <img src> and a <link href>, an attribute a quote would
-- close.
--
-- THE LOOPBACK EXCEPTION IS NOT A CONCESSION. `supabase start` serves storage from
-- `http://127.0.0.1:54321`, so an https-only rule does not merely inconvenience local
-- development -- it makes uploading a logo impossible on every developer machine, which is
-- exactly what happened: the object reached the bucket and the UPDATE was refused, leaving
-- the school's logo orphaned in storage with no row pointing at it.
--
-- `127.0.0.1` and `localhost` are the two hosts whose traffic never crosses a network, so
-- there is nothing between the page and the object to downgrade or intercept. Every other
-- host still has to be https.
-- ------------------------------------------------------------------

alter table public.center_settings
  add constraint center_settings_primary_color_hex
    check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint center_settings_brand_gold_hex
    check (brand_gold is null or brand_gold ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint center_settings_brand_gold_soft_hex
    check (brand_gold_soft is null or brand_gold_soft ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint center_settings_logo_url_https
    check (public.is_safe_asset_url(logo_url)),
  add constraint center_settings_logo_dark_url_https
    check (public.is_safe_asset_url(logo_dark_url)),
  add constraint center_settings_favicon_url_https
    check (public.is_safe_asset_url(favicon_url));

-- A tagline is a line, not a page: a bound keeps a paste-accident out of every screen
-- that renders it under the wordmark.
alter table public.center_settings
  add constraint center_settings_tagline_length check (tagline is null or length(tagline) <= 120);

-- ------------------------------------------------------------------
-- 4. The bucket
--
-- Modelled on `avatars` (20260812120000), with one deliberate difference: an avatar
-- belongs to a user and its policy scopes writes to `<uid>/`, whereas a logo belongs to
-- the institution and has no owning user. So writes are scoped to the ADMIN ROLE
-- instead, and the path is scoped to a deployment folder.
--
-- `center/` is that folder. It is a constant today because the deployment is one school.
-- It exists anyway so the object layout does not have to change if `<school_id>/` ever
-- replaces it -- only the policy predicate would.
--
-- NO SVG. The reasoning is the same as for avatars and is not weakened here: an SVG is a
-- script container, this bucket is public, and a logo does not need one to be served.
-- The vector file is what the school sends the designer, not what the browser fetches.
--
-- 512 KB. A wordmark and a favicon fit several times over, and a public bucket with a
-- generous limit is free hosting.
-- ------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  524288, -- 512 KB
  array['image/png', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone, including anon. The logo is on the login page eventually, and it is the
-- one thing about a school that is already public -- it is on their door.
drop policy if exists "branding public read" on storage.objects;
create policy "branding public read" on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'branding');

-- Write: admins only, and only inside the deployment folder. Both halves matter. Without
-- `is_admin()` any signed-in student could replace the school's logo; without the folder
-- rule an admin could write objects that no future tenant scoping would contain.
drop policy if exists "branding admin insert" on storage.objects;
create policy "branding admin insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'branding'
    and private.is_admin()
    and split_part(name, '/', 1) = 'center'
  );

drop policy if exists "branding admin update" on storage.objects;
create policy "branding admin update" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'branding'
    and private.is_admin()
    and split_part(name, '/', 1) = 'center'
  )
  with check (
    bucket_id = 'branding'
    and private.is_admin()
    and split_part(name, '/', 1) = 'center'
  );

drop policy if exists "branding admin delete" on storage.objects;
create policy "branding admin delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'branding'
    and private.is_admin()
    and split_part(name, '/', 1) = 'center'
  );

-- ------------------------------------------------------------------
-- 5. Post-conditions
--
-- Asserted rather than assumed. Every one of these has a failure mode that is silent:
-- a constraint that accepts anything, a bucket that allows SVG, a write policy missing
-- its `is_admin()`. The migration refuses to report success without them.
-- ------------------------------------------------------------------

do $$
declare
  _n integer;
  _ok boolean;
  -- The row as it stands, so proving the constraints cannot cost the school its branding.
  -- These checks WRITE to the singleton -- there is no other way to prove a check
  -- constraint refuses a value -- so every one of them is undone before this block ends.
  _saved public.center_settings%rowtype;
begin
  select * into _saved from public.center_settings where id = true;

  -- the columns
  select count(*) into _n from information_schema.columns
   where table_schema = 'public' and table_name = 'center_settings'
     and column_name in ('tagline','logo_dark_url','favicon_url',
                         'primary_color','brand_gold','brand_gold_soft');
  if _n <> 6 then raise exception 'expected 6 branding columns, found %', _n; end if;

  -- the colour constraint actually rejects CSS, not merely a wrong-looking string
  begin
    update public.center_settings set primary_color = 'red; } body { display: none';
    raise exception 'the colour constraint accepted CSS';
  exception when check_violation then null;
  end;

  begin
    update public.center_settings set primary_color = 'rgb(19,42,62)';
    raise exception 'the colour constraint accepted a non-hex format';
  exception when check_violation then null;
  end;

  -- and accepts the format the product uses
  update public.center_settings set primary_color = '#132A3E';
  update public.center_settings set primary_color = null;

  -- the URL constraint refuses a scheme that can execute or inline a document
  begin
    update public.center_settings set logo_url = 'javascript:alert(1)';
    raise exception 'the URL constraint accepted javascript:';
  exception when check_violation then null;
  end;

  begin
    update public.center_settings set logo_url = 'data:image/svg+xml,<svg onload=alert(1)>';
    raise exception 'the URL constraint accepted a data: URL';
  exception when check_violation then null;
  end;

  begin
    update public.center_settings set logo_url = 'https://x.test/a.png" onerror="alert(1)';
    raise exception 'the URL constraint accepted a quote';
  exception when check_violation then null;
  end;

  begin
    update public.center_settings set logo_url = 'http://evil.test/a.png';
    raise exception 'the URL constraint accepted http on a remote host';
  exception when check_violation then null;
  end;

  -- and DOES accept what `supabase start` hands the browser, or no logo can be uploaded
  -- on a developer machine.
  update public.center_settings
     set logo_url = 'http://127.0.0.1:54321/storage/v1/object/public/branding/center/l.png';
  update public.center_settings set logo_url = null;

  -- the bucket
  select public into _ok from storage.buckets where id = 'branding';
  if _ok is null then raise exception 'the branding bucket was not created'; end if;
  if _ok is not true then raise exception 'the branding bucket is not public'; end if;

  select count(*) into _n from storage.buckets
   where id = 'branding' and 'image/svg+xml' = any(allowed_mime_types);
  if _n <> 0 then
    raise exception 'SVG is allowed in the branding bucket; it is a stored-XSS vector there';
  end if;

  select count(*) into _n from pg_policy
   where polrelid = 'storage.objects'::regclass and polname like 'branding %';
  if _n <> 4 then raise exception 'expected 4 branding policies, found %', _n; end if;

  -- every write policy must carry BOTH the admin check and the folder rule
  select count(*) into _n from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname in ('branding admin insert','branding admin update','branding admin delete')
     and coalesce(pg_get_expr(polwithcheck, polrelid), '') ||
         coalesce(pg_get_expr(polqual, polrelid), '') like '%is_admin%'
     and coalesce(pg_get_expr(polwithcheck, polrelid), '') ||
         coalesce(pg_get_expr(polqual, polrelid), '') like '%split_part%';
  if _n <> 3 then
    raise exception 'a branding write policy is missing is_admin() or the folder rule (%)', _n;
  end if;

  -- Put the row back exactly as it was found. Without this, running the migration twice
  -- silently unbrands a live deployment.
  update public.center_settings
     set primary_color   = _saved.primary_color,
         brand_gold      = _saved.brand_gold,
         brand_gold_soft = _saved.brand_gold_soft,
         logo_url        = _saved.logo_url,
         logo_dark_url   = _saved.logo_dark_url,
         favicon_url     = _saved.favicon_url,
         tagline         = _saved.tagline,
         school_name     = _saved.school_name
   where id = true;

  raise notice 'branding ready: 6 columns, 7 constraints, public bucket, admin-only writes, no SVG.';
end $$;
