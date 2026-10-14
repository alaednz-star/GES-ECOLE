#!/usr/bin/env bash
# Release rehearsal for the Resources Phase 1 migration chain.
#
# Replays the three migrations the way `supabase db push` will -- one transaction
# per file, in filename order -- on a THROWAWAY CLONE of the local database that
# has first been rewound to production's schema shape, with the deploy window
# simulated in the middle.
#
# Production is never touched: nothing here connects to it. The clone is dropped at
# the end.
#
# This is what caught two real defects that inspection and the test suites both
# missed: an enum value used in the transaction that added it, and a guard on the
# drop migration that refused precisely when the safe deployment order requires it
# to run. Worth re-running if either migration changes.
#
#   bash scripts/e2e/rehearse-resources-phase1-release.sh
set -u
D="${SUPABASE_DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SP="${TMPDIR:-/tmp}"
REWIND="$HERE/rehearse-resources-phase1-rewind.sql"
ENUM="$HERE/rehearse-resources-phase1-enum.sql"

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
apply() { # apply one migration inside ONE transaction, as db push does
  printf 'begin;\n' > "$SP/w.sql"
  cat "supabase/migrations/$1.sql" >> "$SP/w.sql"
  printf '\ncommit;\n' >> "$SP/w.sql"
  local out
  out=$(docker exec -i $D psql -U postgres -d phase1_check -v ON_ERROR_STOP=1 < "$SP/w.sql" 2>&1)
  if echo "$out" | grep -qiE '^ERROR'; then
    echo "  FAIL  $1"
    echo "$out" | grep -iE 'error|hint' | head -3 | sed 's/^/        /'
    return 1
  fi
  echo "  OK    $1"
  echo "$out" | grep -i notice | sed 's/^/        /'
  return 0
}
counts() {
  docker exec $D psql -U postgres -d phase1_check -Atc "
    select 'chapters=' || (select count(*) from public.chapters)
        || ' resources=' || (select count(*) from public.resources)
        || ' registrations=' || (select count(*) from public.registrations)
        || ' groups=' || (select count(*) from public.groups)
        || ' attendance=' || (select count(*) from public.attendance)
        || ' events=' || (select count(*) from public.resource_events)
        || ' policies_on_resources=' || (select count(*) from pg_policy where polrelid='public.resources'::regclass);"
}

step "0. clone the local database and rewind it to production's shape"
docker exec $D bash -lc "pg_dump -U postgres -Fc -d postgres -f /tmp/local.dump" || exit 1
docker exec $D psql -U postgres -d postgres -c "drop database if exists phase1_check;" -c "create database phase1_check;" >/dev/null 2>&1
docker exec $D bash -lc "pg_restore -U postgres -d phase1_check --no-owner --no-privileges /tmp/local.dump >/dev/null 2>&1"
docker exec -i $D psql -U postgres -d phase1_check -v ON_ERROR_STOP=1 < "$REWIND" >/dev/null 2>&1 || exit 1
docker exec -i $D psql -U postgres -d phase1_check -v ON_ERROR_STOP=1 < "$ENUM" >/dev/null 2>&1 || exit 1
docker exec $D psql -U postgres -d phase1_check -Atc "
  select 'enum=' || (select string_agg(enumlabel,',' order by enumsortorder) from pg_enum e
                       join pg_type t on t.oid=e.enumtypid where t.typname='resource_event_kind')
      || ' open_events=' || (select count(*) from public.resource_events where kind='open')
      || ' is_important=' || (select count(*) from information_schema.columns
                               where table_schema='public' and table_name='resources' and column_name='is_important')
      || ' phase1_cols=' || (select count(*) from information_schema.columns
                              where table_schema='public' and table_name='resources'
                                and column_name in ('role','pinned','file_name','file_ext','link_provider','link_thumbnail_url'));"
echo "  baseline: $(counts)"

step "1. push 20260811095000 (enum value, own transaction)"
apply 20260811095000_resource_event_kind_view || exit 1

step "2. push 20260811100000 (foundation, alongside the new code)"
apply 20260811100000_resources_phase1_foundation || exit 1
echo "  after:    $(counts)"
docker exec $D psql -U postgres -d phase1_check -Atc "
  select 'is_important still present=' || (select count(*) from information_schema.columns
           where table_schema='public' and table_name='resources' and column_name='is_important')
      || '  (so an OLD bundle keeps working during the deploy)';"

step "3. deploy window: the new bundle goes live and writes pinned only"
docker exec $D psql -U postgres -d phase1_check -Atc "
  insert into public.resources (chapter_id, group_id, title, kind, url, pinned)
  select id, group_id, 'rehearsal-new-bundle-pin', 'link', 'https://example.test/a', true
    from public.chapters limit 1;
  update public.resources set pinned = true where title like 'rehearsal%';
  select 'rows where is_important is now stale: ' || count(*)
    from public.resources where pinned is distinct from is_important;"

step "4. push 20260811110000 (drop is_important) -- only now"
apply 20260811110000_resources_drop_is_important || exit 1
echo "  after:    $(counts)"

step "5. final state"
docker exec $D psql -U postgres -d phase1_check -c "
select (select count(*) from information_schema.columns where table_schema='public' and table_name='resources' and column_name='is_important') as is_important,
       (select count(*) from information_schema.columns where table_schema='public' and table_name='resources' and column_name='pinned') as pinned,
       (select count(*) from public.resources where pinned) as pinned_rows,
       (select count(*) from public.resource_events where kind='open') as open_events,
       (select count(*) from pg_constraint where conrelid='public.resource_events'::regclass and contype='u') as uniques,
       (select count(*) from pg_policy where polrelid='public.resource_events'::regclass and polcmd in ('w','d')) as wr_policies,
       (select file_size_limit from storage.buckets where id='course-resources') as bucket_limit;"

step "6. tear the clone down"
docker exec $D psql -U postgres -d postgres -c "drop database if exists phase1_check;" >/dev/null 2>&1
docker exec $D bash -lc "rm -f /tmp/local.dump"
echo "  clone removed"
