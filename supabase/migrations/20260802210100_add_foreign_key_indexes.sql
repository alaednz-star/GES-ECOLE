-- Phase 0 / TD-3: add the indexes the schema has never had.
--
-- No CREATE INDEX existed in any prior migration, so only the implicit indexes
-- behind primary keys and UNIQUE constraints were present. Every foreign key
-- used for filtering was unindexed.
--
-- This matters more here than in a typical schema because the RLS policies on
-- profiles and students contain a correlated subquery:
--
--   EXISTS (SELECT 1 FROM registrations r JOIN groups g ON g.id = r.group_id
--           WHERE r.student_id = <row>.id AND r.status = 'approved'
--             AND g.teacher_id = auth.uid())
--
-- which is evaluated per row scanned. Without indexes on registrations
-- (student_id, group_id, status) and groups.teacher_id, listing students as a
-- teacher degrades quadratically.
--
-- Purely additive: no data or behaviour change. IF NOT EXISTS keeps it
-- idempotent.

-- Authorization hot path: every is_admin()/has_role() call filters user_roles
-- by user_id. Hit on essentially every RLS evaluation.
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
  ON public.user_roles (user_id);

-- students.level_id -> levels (dashboard filters students by level)
CREATE INDEX IF NOT EXISTS idx_students_level_id
  ON public.students (level_id);

-- groups foreign keys: teacher_id is used by the teacher RLS subquery on
-- profiles/students/registrations/attendance; the others back list filters.
CREATE INDEX IF NOT EXISTS idx_groups_teacher_id
  ON public.groups (teacher_id);
CREATE INDEX IF NOT EXISTS idx_groups_subject_id
  ON public.groups (subject_id);
CREATE INDEX IF NOT EXISTS idx_groups_level_id
  ON public.groups (level_id);

-- group_schedules.group_id: fetched with every group listing.
CREATE INDEX IF NOT EXISTS idx_group_schedules_group_id
  ON public.group_schedules (group_id);

-- registrations: the UNIQUE (student_id, group_id) constraint already indexes
-- student_id as a leading column, so only group_id needs its own index.
CREATE INDEX IF NOT EXISTS idx_registrations_group_id
  ON public.registrations (group_id);

-- Partial index for the approved-registration lookups the RLS subqueries and
-- enrolment counts perform. Smaller and more selective than a full index on
-- status, whose three values are low-cardinality.
CREATE INDEX IF NOT EXISTS idx_registrations_approved
  ON public.registrations (student_id, group_id)
  WHERE status = 'approved';

-- attendance: the UNIQUE (group_id, student_id, session_date) constraint
-- already covers group_id-leading lookups. student_id-first queries
-- (useMyAttendance) and per-date reporting (useTodayAttendance) are not
-- covered by it.
CREATE INDEX IF NOT EXISTS idx_attendance_student_id
  ON public.attendance (student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session_date
  ON public.attendance (session_date);

-- teacher_subjects: PK is (teacher_id, subject_id), so reverse lookups
-- ("which teachers teach subject X") are unindexed.
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject_id
  ON public.teacher_subjects (subject_id);
