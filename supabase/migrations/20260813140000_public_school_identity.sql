-- ==================================================================
-- The school's identity, readable before sign-in
--
-- WHY THIS MIGRATION EXISTS
--
-- `20260813100000` put the school's identity on `center_settings`, and the dashboard now
-- renders it. The public landing page cannot: `center_settings` grants nothing to `anon`
-- and its read policy is `TO authenticated`, so a parent who has never signed in sees the
-- platform's identity instead of the school's. Phase 2A stopped there deliberately and
-- reported the requirement rather than weakening a policy to put a logo on a page.
--
-- This is that requirement, implemented narrowly.
--
--
-- WHAT IS ACTUALLY BEING EXPOSED
--
-- A school's name, tagline, description, logo, colours and contact details. Every one of
-- those is on the school's door, on its Facebook page and on the sign outside. Publishing
-- them is the POINT of a landing page -- the page renders them to whoever asks, so there is
-- no state in which they are secret and the endpoint is not.
--
-- Nothing else moves. No student, no teacher, no group, no subject, no level, no
-- registration, no count of anything. `20260802210200` states the rule this migration is
-- carefully not breaking: "anon keeps *nothing* on public tables". After this, anon holds
-- SELECT on thirteen COLUMNS of one table and nothing else in the schema.
--
--
-- WHY COLUMN GRANTS AND NOT A VIEW
--
-- A view over the table would be the obvious way to publish a subset. It would also have
-- to run as its owner to see past the table's RLS, and `20260808180000` establishes the
-- opposite rule for this codebase -- every view is `security_invoker = true`, and that
-- migration raises an exception if one is not, on the grounds that a view without it
-- "would bypass RLS". Adding the first bypassing view in the schema, to serve anonymous
-- traffic, is not the precedent to set.
--
-- Column privileges say the same thing without any bypass: anon may read exactly these
-- columns of exactly this row, and Postgres refuses the rest before RLS is even consulted.
-- `select phone` succeeds; `select academic_year` is an error, not an empty result.
--
-- ADDITIVE. Three columns, one policy, one grant. No existing policy is altered, no
-- existing grant is widened, and `authenticated` behaviour is untouched.
--
--
-- ROLLBACK
--   revoke all on public.center_settings from anon;
--   drop policy if exists "settings public identity read" on public.center_settings;
--   alter table public.center_settings
--     drop constraint if exists center_settings_about_length,
--     drop column if exists about_ar, drop column if exists about_fr,
--     drop column if exists about_en;
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. The school's own description of itself
--
-- Three columns rather than one, because the product is trilingual and one column cannot
-- be. They are nullable and independent: a school that has written only Arabic gets Arabic
-- on every locale, which is honest, rather than a French translation nobody at the school
-- approved. The client picks the reader's locale and falls back to whichever exists.
--
-- Long-form on purpose -- this is several paragraphs of a school's own prose, not a
-- tagline. 4000 characters is about two A4 pages, past which it stops being a landing page.
-- ------------------------------------------------------------------

alter table public.center_settings
  add column if not exists about_ar text,
  add column if not exists about_fr text,
  add column if not exists about_en text;

alter table public.center_settings
  add constraint center_settings_about_length check (
    coalesce(length(about_ar), 0) <= 4000
    and coalesce(length(about_fr), 0) <= 4000
    and coalesce(length(about_en), 0) <= 4000
  );

comment on column public.center_settings.about_ar is
  'The school''s own description, Arabic. Public: readable by anon. Falls back across locales.';

-- ------------------------------------------------------------------
-- 2. Anonymous read, of thirteen columns
--
-- The GRANT is the boundary; the policy only lets the row through once the privilege
-- check has already passed. Both are needed and neither is sufficient alone.
--
-- Deliberately absent from the list:
--   id                -- the singleton key, meaningless outside the schema
--   default_language  -- an operational preference, not an advertisement
--   academic_year     -- ditto
--   updated_at        -- tells a stranger when the administration last logged in
-- ------------------------------------------------------------------

revoke all on public.center_settings from anon;

grant select (
  school_name,
  tagline,
  about_ar,
  about_fr,
  about_en,
  logo_url,
  logo_dark_url,
  favicon_url,
  primary_color,
  brand_gold,
  brand_gold_soft,
  phone,
  address
) on public.center_settings to anon;

drop policy if exists "settings public identity read" on public.center_settings;
create policy "settings public identity read" on public.center_settings
  for select
  to anon
  using (true);

-- ------------------------------------------------------------------
-- 3. Post-conditions
--
-- Asserted as `anon` itself, because the only convincing evidence about what an anonymous
-- visitor can read is a query run as one. Every one of these has a silent failure mode: a
-- grant that covered the whole table, a policy that also allowed writes, or a second table
-- that quietly became readable along the way.
-- ------------------------------------------------------------------

-- STRUCTURE FIRST, AS OURSELVES. THEN BEHAVIOUR, AS ANON.
--
-- The order is not cosmetic. This block used to switch to `anon`, run the behavioural
-- checks, `reset role`, and only then count the new columns in `information_schema` --
-- which failed on the hosted project with "expected 3 about columns, found 0" and rolled
-- the whole migration back.
--
-- `information_schema` is PRIVILEGE-FILTERED: it shows a column only if the current role
-- holds a privilege on it. Locally the migration ran as a superuser, so `reset role` landed
-- somewhere that could see everything and the check passed. On Supabase the CLI's login
-- role is not the table owner, so the same query returned zero -- reporting the columns as
-- missing when they had just been created two statements earlier.
--
-- Fixed twice over: the structural assertions run BEFORE any role switch, and they read
-- `pg_catalog`, which is not privilege-filtered and answers "does this exist" rather than
-- "may I see this".

do $$
declare _n integer;
begin
  -- the columns exist
  select count(*) into _n from pg_attribute
   where attrelid = 'public.center_settings'::regclass
     and attname in ('about_ar','about_fr','about_en')
     and not attisdropped;
  if _n <> 3 then raise exception 'expected 3 about columns, found %', _n; end if;

  -- exactly one anon policy, and it is a SELECT policy
  select count(*) into _n from pg_policy
   where polrelid = 'public.center_settings'::regclass
     and polname = 'settings public identity read'
     and polcmd = 'r';
  if _n <> 1 then raise exception 'the anon policy is missing or is not SELECT-only'; end if;

  -- the grant covers exactly the thirteen public columns and nothing else
  select count(*) into _n from information_schema.column_privileges
   where grantee = 'anon' and table_schema = 'public' and table_name = 'center_settings'
     and privilege_type = 'SELECT';
  if _n <> 13 then
    raise exception 'anon holds SELECT on % columns of center_settings, expected 13', _n;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 4. What an anonymous visitor can actually do is NOT asserted here
--
-- It used to be, with `SET LOCAL ROLE anon` inside this migration, and that was the wrong
-- place for it twice over.
--
-- First, `information_schema` is privilege-filtered, so a structural check run after the
-- role dance reported freshly-created columns as missing. Fixed above by reading
-- `pg_catalog` before any switch.
--
-- Then, `RESET ROLE` does not restore what you left. It resets to the SESSION role, and the
-- Supabase CLI's migration connection is not running as its session role -- so the block
-- returned as an unprivileged role and the CLI's own
--   INSERT INTO supabase_migrations.schema_migrations
-- failed with "permission denied for schema supabase_migrations", rolling the migration
-- back after every statement in it had succeeded. A migration that cannot record itself is
-- a migration that runs forever.
--
-- The behaviour is worth proving; a transaction that has just granted the privileges is not
-- the place to prove it. It is verified after deployment as a real anonymous HTTPS client
-- against PostgREST, which exercises the grant, the policy AND the API layer rather than
-- only the database role:
--
--   GET /rest/v1/center_settings?select=school_name,tagline,about_ar,…   -> 200, the school
--   GET /rest/v1/center_settings?select=academic_year                    -> 401
--   GET /rest/v1/students | profiles | groups                            -> 401
--   PATCH /rest/v1/center_settings                                       -> refused
--
-- See DEPLOYMENT.md §8. The structural half -- the columns, the policy, and the grant
-- covering exactly thirteen columns -- is asserted above, where it is safe to assert.
-- ------------------------------------------------------------------
