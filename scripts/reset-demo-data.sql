-- Removes ALL local demo data, and nothing else. LOCAL DATABASE ONLY.
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < scripts/reset-demo-data.sql
--
-- Never run it against a hosted project: a real school's database has no demo data, and this
-- script deletes accounts.
--
-- The anchor is the demo e-mail domain: `@demo.gestion-ecole.local` (current seed) and
-- `@madrasti.local` (demo accounts created by earlier versions). Neither pattern matches the
-- internal `@no-login.madrasti.local` identities of real students (the `@` must come directly
-- before the domain). Demo groups are the groups taught by a demo teacher.
-- Reference data (levels, subjects, formation types) and center_settings are left untouched.
--
-- Safe to run repeatedly. Re-seed afterwards with `npm run seed:demo`.

BEGIN;

CREATE TEMP TABLE demo_users ON COMMIT DROP AS
  SELECT id FROM auth.users
   WHERE email LIKE ANY (ARRAY['%@demo.gestion-ecole.local', '%@madrasti.local']);

-- Payments first: payments.registration_id is ON DELETE RESTRICT (20260930100100), so a demo
-- registration carrying payments would refuse to go.
DELETE FROM public.payments p
 USING public.registrations r
 WHERE p.registration_id = r.id
   AND (r.student_id IN (SELECT id FROM demo_users)
        OR r.group_id IN (SELECT id FROM public.groups WHERE teacher_id IN (SELECT id FROM demo_users)));

-- Demo groups: their schedules, registrations, sessions and course material cascade.
DELETE FROM public.groups WHERE teacher_id IN (SELECT id FROM demo_users);

-- Rows that reference a demo account rather than a demo group.
DELETE FROM public.attendance
 WHERE student_id IN (SELECT id FROM demo_users) OR marked_by IN (SELECT id FROM demo_users);
DELETE FROM public.student_notes
 WHERE student_id IN (SELECT id FROM demo_users) OR author_id IN (SELECT id FROM demo_users);
DELETE FROM public.notifications WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM public.registrations WHERE student_id IN (SELECT id FROM demo_users);

DELETE FROM public.teacher_subjects WHERE teacher_id IN (SELECT id FROM demo_users);
DELETE FROM public.teachers WHERE id IN (SELECT id FROM demo_users);
DELETE FROM public.students WHERE id IN (SELECT id FROM demo_users);
DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM public.profiles WHERE id IN (SELECT id FROM demo_users);

-- Finally the auth accounts themselves.
DELETE FROM auth.users WHERE id IN (SELECT id FROM demo_users);

COMMIT;

-- Confirm: no demo account left, reference data intact.
SELECT 'remaining demo users' AS check, count(*)::text AS value FROM auth.users
 WHERE email LIKE ANY (ARRAY['%@demo.gestion-ecole.local', '%@madrasti.local'])
UNION ALL SELECT 'levels',              count(*)::text FROM public.levels
UNION ALL SELECT 'subjects',            count(*)::text FROM public.subjects
UNION ALL SELECT 'groups remaining',    count(*)::text FROM public.groups
UNION ALL SELECT 'other users (real)',  count(*)::text FROM auth.users
 WHERE email NOT LIKE ALL (ARRAY['%@demo.gestion-ecole.local', '%@madrasti.local']);
