-- ==================================================================
-- HR foundation: employee files, contracts, availability, staff time, leave, documents.
--
-- WHAT ALREADY EXISTED, AND IS NOT DUPLICATED
--
--   profiles      name, email, phone, photo -- the person
--   user_roles    admin | teacher | student -- what they may DO in the application
--   teachers      teaching data and the teaching/account lifecycle (status + GoTrue ban)
--   groups, group_schedules, programs, attendance -- the actual teaching assignments
--
-- What did not exist is EMPLOYMENT: when someone started, in what position, under which
-- contract, when they can work, when they actually worked, when they are on leave, and the
-- papers in their file. That is what this migration adds, around `profiles`.
--
-- TWO LIFECYCLES, KEPT APART
--
--   Account lifecycle     can this person sign in? (teachers.status + auth ban; admin ban)
--   Employment lifecycle  is this person working for the institution? (employees.employment_status)
--
-- An employee on leave keeps a working account; an ended contract does not ban anybody.
-- Nothing here touches authentication.
--
-- STAFF TYPE IS NOT A ROLE
--
--   employees.staff_type (teacher | trainer | administrative | other) is an HR classification.
--   It grants nothing. The three application roles are unchanged.
--
-- HISTORY IS KEPT
--
--   An employee is archived, never deleted (no DELETE policy). Contracts and leave are ended
--   or cancelled, never deleted (no DELETE policy). Child records reference employees with
--   RESTRICT, and employees reference profiles with RESTRICT, so deleting an account that has
--   an HR file is refused -- `private.entity_dependencies` reports the HR file as blocking.
--   Every insert, update and delete on every HR table is written to `audit_log`.
--
-- AVAILABILITY IS NOT SCHEDULE
--
--   employee_availability says when someone CAN work. When they are ASSIGNED is still
--   groups/group_schedules -- the timetable remains the source of truth; HR only reads it.
--
-- STAFF TIME IS NOT TEACHING ATTENDANCE
--
--   staff_attendance records a working day (check-in/out). `attendance` records students in
--   a session. A teacher may teach 09:00-11:00 and work 08:30-12:00; neither is derived from
--   the other.
--
-- PRIVACY
--
--   Collected: position, department, dates, an optional internal staff code (paper files use
--   one), address, date of birth, one emergency contact, HR notes. Not collected: national ID
--   numbers, bank details, salary, medical information. Leave has a TYPE (e.g. sick) and never
--   a reason or diagnosis. Everything is administrator-only.
--
-- NOT IN SCOPE: payroll, salaries, payslips, deductions, bonuses, contributions.
-- ==================================================================

-- ------------------------------------------------------------------
-- employees
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employees (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id              uuid NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE RESTRICT,
  staff_type              text NOT NULL DEFAULT 'teacher'
                            CHECK (staff_type IN ('teacher', 'trainer', 'administrative', 'other')),
  employment_status       text NOT NULL DEFAULT 'active'
                            CHECK (employment_status IN ('active', 'on_leave', 'suspended', 'ended', 'archived')),
  position                text CHECK (position IS NULL OR length(btrim(position)) BETWEEN 1 AND 120),
  department              text CHECK (department IS NULL OR length(btrim(department)) BETWEEN 1 AND 120),
  employee_code           text CHECK (employee_code IS NULL OR length(btrim(employee_code)) BETWEEN 1 AND 40),
  start_date              date NOT NULL DEFAULT current_date,
  end_date                date,
  address                 text CHECK (address IS NULL OR length(address) <= 300),
  date_of_birth           date CHECK (date_of_birth IS NULL OR date_of_birth BETWEEN DATE '1900-01-01' AND DATE '2100-01-01'),
  emergency_contact_name  text CHECK (emergency_contact_name IS NULL OR length(emergency_contact_name) <= 120),
  emergency_contact_phone text CHECK (emergency_contact_phone IS NULL OR length(emergency_contact_phone) <= 30),
  notes                   text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by              uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_dates_valid CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT employees_ended_has_end_date CHECK (employment_status <> 'ended' OR end_date IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_code_unique
  ON public.employees (lower(btrim(employee_code))) WHERE employee_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees (employment_status);

COMMENT ON TABLE public.employees IS
  'HR file for a staff account (one per profile). Employment lifecycle only -- sign-in is governed by the existing account lifecycle. staff_type is an HR classification, not an authorization role. Archived, never deleted.';

-- ------------------------------------------------------------------
-- employee_contracts -- history, never overwritten
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES public.employees (id) ON DELETE RESTRICT,
  contract_type text NOT NULL
                  CHECK (contract_type IN ('permanent', 'fixed_term', 'temporary', 'freelance', 'other')),
  -- Working time is a separate axis from duration: a fixed-term contract can be part-time.
  working_time  text CHECK (working_time IS NULL OR working_time IN ('full_time', 'part_time')),
  start_date    date NOT NULL,
  end_date      date,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  notes         text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by    uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_contracts_dates_valid CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT employee_contracts_fixed_term_has_end CHECK (contract_type <> 'fixed_term' OR end_date IS NOT NULL),
  CONSTRAINT employee_contracts_ended_has_end CHECK (status <> 'ended' OR end_date IS NOT NULL)
);

-- One active contract per employee at a time; ended and cancelled contracts are history.
CREATE UNIQUE INDEX IF NOT EXISTS employee_contracts_one_active
  ON public.employee_contracts (employee_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee ON public.employee_contracts (employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_active_end
  ON public.employee_contracts (end_date) WHERE status = 'active';

-- ------------------------------------------------------------------
-- employee_availability -- when someone CAN work
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_availability (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: availability is a current preference, not history (like teacher_subjects).
  -- Employees are never deleted through the API anyway.
  employee_id     uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  effective_from  date,
  effective_until date,
  note            text CHECK (note IS NULL OR length(note) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_availability_time_valid CHECK (end_time > start_time),
  CONSTRAINT employee_availability_window_valid CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_employee_availability_employee ON public.employee_availability (employee_id, weekday);

-- ------------------------------------------------------------------
-- staff_attendance -- a working day (not session attendance)
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES public.employees (id) ON DELETE RESTRICT,
  work_date      date NOT NULL,
  check_in       time,
  check_out      time,
  status         text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'partial', 'leave')),
  note           text CHECK (note IS NULL OR length(note) <= 500),
  -- Derived, never typed: minutes between check-in and check-out.
  worked_minutes int GENERATED ALWAYS AS (
    CASE WHEN check_in IS NOT NULL AND check_out IS NOT NULL
         THEN (EXTRACT(EPOCH FROM (check_out - check_in)) / 60)::int END
  ) STORED,
  recorded_by    uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- One record per employee per day. Split shifts are a later refinement.
  CONSTRAINT staff_attendance_one_per_day UNIQUE (employee_id, work_date),
  CONSTRAINT staff_attendance_out_after_in CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in),
  CONSTRAINT staff_attendance_out_needs_in CHECK (check_out IS NULL OR check_in IS NOT NULL),
  -- Absent or on leave: nobody checked in. Otherwise a check-in is what "present" means.
  CONSTRAINT staff_attendance_status_times CHECK (
    (status IN ('absent', 'leave') AND check_in IS NULL AND check_out IS NULL)
    OR (status IN ('present', 'late', 'partial') AND check_in IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON public.staff_attendance (work_date DESC);

-- ------------------------------------------------------------------
-- employee_leaves
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_leaves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE RESTRICT,
  leave_type  text NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'training', 'other')),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  note        text CHECK (note IS NULL OR length(note) <= 500),
  decided_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_leaves_dates_valid CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee ON public.employee_leaves (employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_window ON public.employee_leaves (start_date, end_date) WHERE status = 'approved';

-- ------------------------------------------------------------------
-- employee_documents -- metadata; the file lives in the private `hr-documents` bucket
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES public.employees (id) ON DELETE RESTRICT,
  contract_id  uuid REFERENCES public.employee_contracts (id) ON DELETE SET NULL,
  category     text NOT NULL
                 CHECK (category IN ('contract', 'identity', 'certificate', 'qualification', 'administrative', 'other')),
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 150),
  storage_path text NOT NULL UNIQUE CHECK (storage_path ~ '^[0-9a-f-]{36}/'),
  file_name    text CHECK (file_name IS NULL OR length(file_name) <= 200),
  mime_type    text,
  size_bytes   bigint CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 10485760),
  uploaded_by  uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON public.employee_documents (employee_id, created_at DESC);

-- ------------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','employee_contracts','employee_availability','staff_attendance','employee_leaves'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t_%1$s_touch ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER t_%1$s_touch BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------
-- Validation that needs today's date or sibling rows (a CHECK cannot)
-- ------------------------------------------------------------------

-- Availability: no two overlapping ranges on the same weekday within overlapping windows.
CREATE OR REPLACE FUNCTION public.validate_employee_availability()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employee_availability a
     WHERE a.employee_id = NEW.employee_id
       AND a.weekday = NEW.weekday
       AND a.id <> NEW.id
       AND a.start_time < NEW.end_time AND NEW.start_time < a.end_time
       AND coalesce(a.effective_from, DATE '0001-01-01') <= coalesce(NEW.effective_until, DATE '9999-12-31')
       AND coalesce(NEW.effective_from, DATE '0001-01-01') <= coalesce(a.effective_until, DATE '9999-12-31')
  ) THEN
    RAISE EXCEPTION 'This availability overlaps another range on the same day.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_employee_availability() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t_employee_availability_validate ON public.employee_availability;
CREATE TRIGGER t_employee_availability_validate
  BEFORE INSERT OR UPDATE ON public.employee_availability
  FOR EACH ROW EXECUTE FUNCTION public.validate_employee_availability();

-- Staff time cannot be recorded for the future (one day of slack: the server date is UTC).
CREATE OR REPLACE FUNCTION public.validate_staff_attendance()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.work_date > current_date + 1 THEN
    RAISE EXCEPTION 'Working time cannot be recorded for a future date (%).', NEW.work_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_staff_attendance() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t_staff_attendance_validate ON public.staff_attendance;
CREATE TRIGGER t_staff_attendance_validate
  BEFORE INSERT OR UPDATE OF work_date ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.validate_staff_attendance();

-- Leave: an approved or pending leave may not overlap another approved or pending one.
CREATE OR REPLACE FUNCTION public.validate_employee_leave()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IN ('pending', 'approved') AND EXISTS (
    SELECT 1 FROM public.employee_leaves l
     WHERE l.employee_id = NEW.employee_id
       AND l.id <> NEW.id
       AND l.status IN ('pending', 'approved')
       AND l.start_date <= NEW.end_date AND NEW.start_date <= l.end_date
  ) THEN
    RAISE EXCEPTION 'This leave overlaps another pending or approved leave.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_employee_leave() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t_employee_leaves_validate ON public.employee_leaves;
CREATE TRIGGER t_employee_leaves_validate
  BEFORE INSERT OR UPDATE ON public.employee_leaves
  FOR EACH ROW EXECUTE FUNCTION public.validate_employee_leave();

-- ------------------------------------------------------------------
-- Audit: every HR change, into the existing audit_log
--
-- SECURITY DEFINER because audit_log has no INSERT policy (append-only via privileged code).
-- The target is the employee's PROFILE, so an HR change appears in the same trail as that
-- person's account events. Updates log only the columns that changed; no-op updates are skipped.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_hr_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _new     jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - 'updated_at' END;
  _old     jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - 'updated_at' END;
  _row     jsonb := coalesce(_new, _old);
  _profile uuid;
  _mail    text;
  _actor   uuid := auth.uid();
  _amail   text;
  _before  jsonb := '{}'::jsonb;
  _after   jsonb := '{}'::jsonb;
  _key     text;
  _details jsonb;
BEGIN
  IF TG_TABLE_NAME = 'employees' THEN
    _profile := (_row->>'profile_id')::uuid;
  ELSE
    SELECT e.profile_id INTO _profile FROM public.employees e WHERE e.id = (_row->>'employee_id')::uuid;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR _key IN SELECT jsonb_object_keys(_new) LOOP
      IF _new->_key IS DISTINCT FROM _old->_key THEN
        _before := _before || jsonb_build_object(_key, _old->_key);
        _after  := _after  || jsonb_build_object(_key, _new->_key);
      END IF;
    END LOOP;
    IF _after = '{}'::jsonb THEN RETURN NULL; END IF;
    _details := jsonb_build_object('before', _before, 'after', _after);
  ELSE
    _details := jsonb_build_object('record', _row);
  END IF;

  SELECT p.email INTO _mail  FROM public.profiles p WHERE p.id = _profile;
  SELECT p.email INTO _amail FROM public.profiles p WHERE p.id = _actor;

  INSERT INTO public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
  VALUES (
    CASE TG_OP WHEN 'INSERT' THEN 'hr_created' WHEN 'UPDATE' THEN 'hr_updated' ELSE 'hr_deleted' END::public.audit_action,
    _actor, _amail, _profile, _mail,
    _details || jsonb_build_object('entity', TG_TABLE_NAME, 'record_id', _row->>'id')
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_hr_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','employee_contracts','employee_availability','staff_attendance','employee_leaves','employee_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER t_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_hr_change()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------
-- Security: administrators only. No teacher, student or anonymous access.
--
-- DELETE policies exist only where removing a row loses nothing that must be kept:
-- availability (a preference), staff time entered by mistake, a document uploaded by mistake
-- -- all audited. Employees, contracts and leave have none: archive, end, cancel.
-- ------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','employee_contracts','employee_availability','staff_attendance','employee_leaves','employee_documents'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s admin read" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s admin read" ON public.%1$I FOR SELECT TO authenticated USING (private.is_admin())', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s admin insert" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s admin insert" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (private.is_admin())', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s admin update" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s admin update" ON public.%1$I FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['employee_availability','staff_attendance','employee_documents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s admin delete" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s admin delete" ON public.%1$I FOR DELETE TO authenticated USING (private.is_admin())', t);
  END LOOP;
END $$;

-- Identity columns of a record are not edited: a contract, time record or leave does not
-- move to another employee, and an HR file does not move to another person.
REVOKE UPDATE (profile_id, created_by, created_at) ON public.employees FROM authenticated;
REVOKE UPDATE (employee_id, created_by, created_at) ON public.employee_contracts FROM authenticated;
REVOKE UPDATE (employee_id, recorded_by, created_at) ON public.staff_attendance FROM authenticated;
REVOKE UPDATE (employee_id, created_at) ON public.employee_leaves FROM authenticated;
REVOKE UPDATE (employee_id, created_at) ON public.employee_availability FROM authenticated;
REVOKE UPDATE ON public.employee_documents FROM authenticated;

-- Column-level REVOKE does not narrow a table-level grant, so the editable columns are
-- re-granted explicitly after withdrawing table-wide UPDATE.
REVOKE UPDATE ON public.employees, public.employee_contracts, public.staff_attendance,
                 public.employee_leaves, public.employee_availability FROM authenticated;
GRANT UPDATE (staff_type, employment_status, position, department, employee_code, start_date, end_date,
              address, date_of_birth, emergency_contact_name, emergency_contact_phone, notes)
  ON public.employees TO authenticated;
GRANT UPDATE (contract_type, working_time, start_date, end_date, status, notes)
  ON public.employee_contracts TO authenticated;
GRANT UPDATE (weekday, start_time, end_time, effective_from, effective_until, note)
  ON public.employee_availability TO authenticated;
GRANT UPDATE (work_date, check_in, check_out, status, note)
  ON public.staff_attendance TO authenticated;
GRANT UPDATE (leave_type, start_date, end_date, status, note, decided_by, decided_at)
  ON public.employee_leaves TO authenticated;

-- ------------------------------------------------------------------
-- Private storage for HR documents
--
-- NOT public (unlike avatars and branding). Objects live under `<employee_id>/` and only an
-- administrator may read, write or delete them; the application reads through short-lived
-- signed URLs requested with the admin's own session. No SVG, 10 MB.
-- ------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('hr-documents', 'hr-documents', false, 10485760,
        ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "hr documents admin read" ON storage.objects;
CREATE POLICY "hr documents admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hr-documents' AND private.is_admin());

DROP POLICY IF EXISTS "hr documents admin insert" ON storage.objects;
CREATE POLICY "hr documents admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hr-documents'
    AND private.is_admin()
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id::text = split_part(name, '/', 1))
  );

DROP POLICY IF EXISTS "hr documents admin delete" ON storage.objects;
CREATE POLICY "hr documents admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hr-documents' AND private.is_admin());

-- ------------------------------------------------------------------
-- An account with an HR file is not deletable: the file is history.
--
-- `private.entity_dependencies` (20260821090000) decides teacher deletion. The HR file is
-- added as 'blocking'; everything else is unchanged, including the audit_log FK assertion.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.entity_dependencies(_entity text, _id uuid)
RETURNS TABLE (
  source_table text,
  relationship text,
  row_count integer,
  severity text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  IF _entity = 'teacher' THEN
    RETURN QUERY
      SELECT 'groups', 'teaches',
             (SELECT count(*)::int FROM public.groups WHERE teacher_id = _id),
             'reassignable'
      UNION ALL
      SELECT 'attendance', 'marked_by',
             (SELECT count(*)::int FROM public.attendance WHERE marked_by = _id),
             'blocking'
      UNION ALL
      SELECT 'student_notes', 'authored',
             (SELECT count(*)::int FROM public.student_notes WHERE author_id = _id),
             'blocking'
      UNION ALL
      -- An HR file (contracts, time, leave, documents hang off it) is employment history:
      -- the account is archived, never deleted (20261001110100).
      SELECT 'employees', 'hr_file',
             (SELECT count(*)::int FROM public.employees WHERE profile_id = _id),
             'blocking'
      UNION ALL
      SELECT 'audit_log', 'subject_of',
             (SELECT count(*)::int FROM public.audit_log WHERE target_id = _id),
             'preserved'
      UNION ALL
      SELECT 'teacher_subjects', 'qualified_for',
             (SELECT count(*)::int FROM public.teacher_subjects WHERE teacher_id = _id),
             'incidental';

  ELSIF _entity = 'student' THEN
    RETURN QUERY
      SELECT 'registrations', 'enrolled',
             (SELECT count(*)::int FROM public.registrations WHERE student_id = _id),
             'blocking'
      UNION ALL
      SELECT 'attendance', 'attended',
             (SELECT count(*)::int FROM public.attendance WHERE student_id = _id),
             'blocking'
      UNION ALL
      SELECT 'student_notes', 'subject_of',
             (SELECT count(*)::int FROM public.student_notes WHERE student_id = _id),
             'blocking'
      UNION ALL
      SELECT 'audit_log', 'subject_of',
             (SELECT count(*)::int FROM public.audit_log WHERE target_id = _id),
             'preserved';

  ELSE
    RAISE EXCEPTION 'Unknown entity type: %', _entity USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.entity_dependencies(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.entity_dependencies(text, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','employee_contracts','employee_availability','staff_attendance','employee_leaves','employee_documents'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'SECURITY: RLS is not enabled on public.%', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'SECURITY: anon holds SELECT on public.%', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'UPDATE') THEN
      RAISE EXCEPTION 'authenticated still holds table-wide UPDATE on public.%', t;
    END IF;
  END LOOP;
  IF has_column_privilege('authenticated', 'public.employees', 'profile_id', 'UPDATE') THEN
    RAISE EXCEPTION 'employees.profile_id must not be updatable';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'hr-documents') THEN
    RAISE EXCEPTION 'SECURITY: the hr-documents bucket must be private';
  END IF;
  IF (SELECT confdeltype FROM pg_constraint WHERE conname = 'employees_profile_id_fkey') <> 'r' THEN
    RAISE EXCEPTION 'employees.profile_id must be ON DELETE RESTRICT';
  END IF;
  RAISE NOTICE 'HR foundation installed.';
END $$;
