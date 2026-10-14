-- Enrolment guard: make the readable error actually reachable.
--
-- `enforce_one_group_per_subject` reads NEW.subject_id / NEW.level_id, but those
-- are DENORMALISED columns populated by `sync_registration_academics`. Both are
-- BEFORE INSERT OR UPDATE triggers, and PostgreSQL fires BEFORE triggers in
-- ALPHABETICAL order:
--
--     t_registrations_capacity
--     t_registrations_one_per_subject   <-- ran first, saw NULL, returned early
--     t_registrations_sync_academics    <-- populated the columns afterwards
--
-- So on INSERT the guard always short-circuited on its own NULL check and the
-- friendly message was unreachable. The rule itself still held -- the partial
-- unique index caught the duplicate -- but the user saw a raw
-- "duplicate key value violates unique constraint" instead of
-- "already enrolled in <group>".
--
-- Renaming the sync trigger so it sorts FIRST restores the intended order. No
-- function body changes; this is purely about when each one runs.

alter trigger t_registrations_sync_academics on public.registrations
  rename to t_registrations_a_sync_academics;

comment on function public.sync_registration_academics() is
  'Copies subject_id/level_id from the group onto the registration. Its trigger '
  'is named with an "a_" prefix so it sorts before t_registrations_one_per_subject: '
  'BEFORE triggers fire alphabetically and the guard reads the columns this sets.';
