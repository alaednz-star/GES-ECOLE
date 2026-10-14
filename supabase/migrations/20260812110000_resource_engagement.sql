-- ==================================================================
-- Resource engagement: one row per resource, from the event log
--
-- ADDITIVE. Two views, no table, no column, no policy replaced.
--
--
-- WHY A VIEW AND NOT A TABLE
--
-- The audit's rule was "do not read raw event rows to render a count", and the reason
-- was correctness rather than speed: a client-side count needs every row, and the
-- attendance module already shipped a `.limit(2000)` that silently under-counted. An
-- aggregate answers the question in one row.
--
-- It is a VIEW rather than a materialised one or a counter column because there is
-- nothing to be gained yet and something to lose: a stored count is a second source
-- of truth that drifts, and the log is append-only so `count(*)` is exact. The two
-- partial indexes from 20260811100000 (`resource_id, kind, occurred_at desc`) are
-- what make it cheap. When a centre has enough traffic for that to stop being true,
-- the fix is a materialised view refreshed on a schedule -- not a trigger-maintained
-- integer.
--
--
-- WHY security_invoker
--
-- Without it a view runs as its OWNER, and every caller would read every centre's
-- figures -- the same trap `20260808180000` documents for the session aggregates.
-- With it, `resource_events read` and `resources read` apply to the CALLER, so a
-- teacher sees their own groups and an admin sees all.
--
-- `security_invoker` alone was NOT enough, which a test caught. A student passes
-- `resources read` for a published resource and `resource events read` for their OWN
-- events, so they got a row back -- counting only themselves, but labelled `views`
-- and `distinct_students`. Nothing leaked, and that is worse than it sounds: a view
-- whose numbers mean "the class" to one reader and "just me" to another is a bug
-- waiting to be rendered. So both views carry an explicit `can_manage_group` filter
-- and mean exactly one thing: the staff-facing figure.
--
-- ROLLBACK
--   drop view public.resource_student_engagement;
--   drop view public.resource_engagement;
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. Per resource: how much attention has it had
-- ------------------------------------------------------------------

create or replace view public.resource_engagement
with (security_invoker = true) as
select r.id                                                        as resource_id,
       r.chapter_id,
       r.group_id,
       count(*) filter (where e.kind = 'view')                     as views,
       count(*) filter (where e.kind = 'download')                 as downloads,
       -- DISTINCT students, not events: "12 vues" from one student who refreshed
       -- twelve times is not the same fact as twelve students reading it once, and
       -- the second is the one a teacher acts on.
       count(distinct e.student_id) filter (where e.kind = 'view') as distinct_students,
       max(e.occurred_at) filter (where e.kind = 'view')           as last_viewed_at,
       max(e.occurred_at) filter (where e.kind = 'download')       as last_downloaded_at
  from public.resources r
  left join public.resource_events e on e.resource_id = r.id
 where public.can_manage_group(r.group_id)
 group by r.id, r.chapter_id, r.group_id;

comment on view public.resource_engagement is
  'One row per resource with view/download counts from the append-only event log. STAFF ONLY: security_invoker plus an explicit can_manage_group filter, so the figures always mean the whole class rather than whoever is asking. LEFT JOIN so a resource nobody has opened still appears, with zeros.';

grant select on public.resource_engagement to authenticated;

-- ------------------------------------------------------------------
-- 2. Per resource per student: who has opened it, and who has not
--
-- The "who has not" half is the question that leads to an action, so it has to be
-- answerable. Built from the ENROLMENT outwards rather than from the event log, so a
-- student who has never opened anything still produces a row -- a query over events
-- alone can only ever list the students who did.
-- ------------------------------------------------------------------

create or replace view public.resource_student_engagement
with (security_invoker = true) as
select r.id                                             as resource_id,
       r.group_id,
       reg.student_id,
       count(e.id) filter (where e.kind = 'view')        as views,
       count(e.id) filter (where e.kind = 'download')    as downloads,
       max(e.occurred_at) filter (where e.kind = 'view') as last_viewed_at,
       -- A plain boolean is what the UI actually branches on.
       (count(e.id) filter (where e.kind = 'view')) > 0  as opened
  from public.resources r
  join public.registrations reg
    on reg.group_id = r.group_id and reg.status = 'approved'
  left join public.resource_events e
    on e.resource_id = r.id and e.student_id = reg.student_id
 where public.can_manage_group(r.group_id)
 group by r.id, r.group_id, reg.student_id;

comment on view public.resource_student_engagement is
  'One row per (resource, enrolled student): opened or not, with counts. STAFF ONLY. Driven from registrations, not from the event log, so students who never opened anything still appear -- which is the list a teacher needs in order to follow up.';

grant select on public.resource_student_engagement to authenticated;

-- ------------------------------------------------------------------
-- 3. Post-conditions
-- ------------------------------------------------------------------

do $$
declare _n integer;
begin
  select count(*) into _n from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('resource_engagement', 'resource_student_engagement')
     and c.relkind = 'v';
  if _n <> 2 then raise exception 'engagement views missing (%)', _n; end if;

  -- security_invoker is the whole safety argument; assert it rather than trust it.
  select count(*) into _n from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('resource_engagement', 'resource_student_engagement')
     and c.reloptions @> array['security_invoker=true'];
  if _n <> 2 then
    raise exception 'a view is missing security_invoker and would leak across centres (%)', _n;
  end if;

  select count(*) into _n from pg_views
   where schemaname = 'public'
     and viewname in ('resource_engagement', 'resource_student_engagement')
     and definition like '%can_manage_group%';
  if _n <> 2 then
    raise exception 'a view is missing its can_manage_group gate and would answer students (%)', _n;
  end if;

  raise notice 'Engagement views ready over % events.',
    (select count(*) from public.resource_events);
end $$;
