-- Production's enum is ('open','download'): no `view`. The rewind cannot remove an
-- enum value, so rebuild the type to match what the migration will really meet.
alter table public.resource_events alter column kind drop default;
create type public.resource_event_kind_pre as enum ('open', 'download');
alter table public.resource_events
  alter column kind type public.resource_event_kind_pre
  using kind::text::public.resource_event_kind_pre;
drop type public.resource_event_kind;
alter type public.resource_event_kind_pre rename to resource_event_kind;
alter table public.resource_events alter column kind set default 'open';
select 'enum rebuilt' as state,
       (select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e
          join pg_type t on t.oid = e.enumtypid where t.typname='resource_event_kind') as labels,
       (select count(*) from public.resource_events where kind = 'open') as open_events;
