-- ==================================================================
-- Resources: retire `is_important` in favour of `pinned`
--
-- SEPARATE from the Phase 1 migration on purpose. Phase 1 added `pinned` and
-- backfilled it; this is the contract half, and dropping a column is the one
-- irreversible thing in the whole phase.
--
-- ORDERING MATTERS. Apply this only AFTER the application code that stopped
-- reading and writing `is_important` is live. Both halves are in the same commit,
-- but if the migration reaches the database before the new bundle reaches
-- browsers, a teacher still running the old JavaScript sends `is_important` on
-- create and gets a 400. The window is a deploy, not a day, and the safe order
-- costs nothing: deploy, then push this.
--
-- Why it is safe to drop at all -- checked, not assumed:
--   * no policy, index, view, function, constraint, trigger or generated column
--     references it (verified against the migrated database, 0 rows)
--   * `pinned` was backfilled from it by 20260811100000, so no state is lost
--   * nothing in `src/` reads or writes it (verified by search: zero hits)
--
-- Note it is NOT a precondition that the two columns still agree. They agree at
-- the moment 20260811100000 finishes and then drift, because the new bundle writes
-- `pinned` only. See the guard below.
--
-- Reversal, if ever needed: re-add the column and backfill from `pinned`.
--   alter table public.resources add column is_important boolean not null default false;
--   update public.resources set is_important = pinned;
-- The data survives in `pinned`, so this is recoverable -- which is the only
-- reason a drop is acceptable here.
-- ==================================================================

-- Guard: `pinned` must exist, because that is where the data lives after this runs.
--
-- An earlier version of this guard ALSO refused to drop while the two columns
-- disagreed. That was wrong, and it would have blocked this migration at exactly
-- the moment it is meant to run. Between 20260811100000 and this file the new
-- bundle goes live, and the new bundle writes `pinned` ONLY -- so every resource
-- pinned or unpinned in the interim leaves `is_important` stale. Divergence is the
-- expected state here, not a fault: `pinned` is canonical and `is_important` is a
-- legacy column nothing reads. Refusing on divergence made the safe deployment
-- order impossible to follow, which a release audit caught by simulating it.
--
-- Divergence is reported instead, so the operator can see that `is_important` had
-- gone stale and that dropping it is losing nothing `pinned` does not already hold.
do $$
declare _n integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'resources' and column_name = 'pinned'
  ) then
    raise exception '`pinned` is missing; apply 20260811100000 first';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'resources' and column_name = 'is_important'
  ) then
    select count(*) into _n from public.resources where pinned is distinct from is_important;
    raise notice 'Dropping is_important. % of % resources had already diverged from pinned, as expected once the new bundle went live.',
      _n, (select count(*) from public.resources);
  end if;
end $$;

alter table public.resources drop column if exists is_important;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'resources' and column_name = 'is_important'
  ) then
    raise exception 'is_important is still present';
  end if;
  raise notice 'is_important retired; pinned is the only importance flag.';
end $$;

comment on column public.resources.pinned is
  'Teacher-flagged as important. The only importance flag -- `is_important` was retired in 20260811110000.';
