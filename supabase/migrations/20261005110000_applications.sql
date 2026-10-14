-- ==================================================================
-- Pre-registrations (pré-inscriptions): public applications to a formation (ADR-004 section 7).
--
-- FLOW
--   public link / QR code of a formation -> application (no account) -> administration review
--   -> accepted: a student record is created or linked, and an APPROVED registration places the
--      student in a group of that formation -> optional portal access later
--   An application is NOT a registration: a registration needs an account-backed student, an
--   application only needs a person to contact. Applications belong to the institution; the
--   formation is the entry point (`program_id`), not the owner.
--
-- TABLE `applications`
--   learner        first/last name, date of birth, optional phone and email, current school level
--                  and school (optional)
--   guardian       name, phone, relationship: required when the learner is younger than
--                  center_settings.guardian_required_under_age (checked by the intake function;
--                  the age threshold is a setting, never hard-coded -- ADR-004 section 6)
--   request        formation (+ name snapshot, kept if the formation is deleted), optional
--                  preferred group, optional preferred schedule and message
--   consent        consent_at (Law 18-07: prior consent, stated purpose); no document uploads
--   review         status new -> reviewing -> accepted | rejected | duplicate (re-openable),
--                  decision note, who and when, resulting student and registration
--   anti-abuse     source_hash: a salted hash of the submitter's network origin (never the raw
--                  address), used only to rate-limit the public form
--
-- SECURITY
--   Administrators read and update applications (RLS). Nobody else -- not anon, not students, not
--   teachers -- can read or write the table: the public form posts to a server function that
--   validates everything and inserts with the service role. `accept_application` runs as the
--   calling administrator (SECURITY INVOKER), so every registration rule applies (capacity, one
--   place per subject and level, group/level consistency).
--
-- NOT HERE (deliberately): waiting list, fees, SMS/e-mail replies, document uploads.
--
-- ROLLBACK
--   DROP FUNCTION public.accept_application(uuid, uuid, uuid);
--   DROP TABLE public.applications;   (and the two functions below)
--   ALTER TABLE public.center_settings DROP COLUMN guardian_required_under_age;
--   (the enum value 'application_received' cannot be dropped; it is harmless when unused)
-- ==================================================================

ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'application_received';

-- The age below which a guardian is required (ADR-004 section 6). A setting, not a constant.
ALTER TABLE public.center_settings
  ADD COLUMN IF NOT EXISTS guardian_required_under_age smallint NOT NULL DEFAULT 18
  CHECK (guardian_required_under_age BETWEEN 0 AND 21);

CREATE TABLE IF NOT EXISTS public.applications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id         uuid REFERENCES public.programs (id) ON DELETE SET NULL,
  program_name       text NOT NULL CHECK (length(btrim(program_name)) BETWEEN 1 AND 120),
  preferred_group_id uuid REFERENCES public.groups (id) ON DELETE SET NULL,

  first_name         text NOT NULL CHECK (length(btrim(first_name)) BETWEEN 1 AND 60),
  last_name          text NOT NULL CHECK (length(btrim(last_name)) BETWEEN 1 AND 60),
  date_of_birth      date NOT NULL CHECK (date_of_birth > (CURRENT_DATE - interval '100 years')
                                          AND date_of_birth < (CURRENT_DATE - interval '3 years')),
  phone              text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{9,15}$'),
  email              text CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  school_level_id    uuid REFERENCES public.levels (id) ON DELETE SET NULL,
  school_name        text CHECK (school_name IS NULL OR length(btrim(school_name)) <= 120),

  guardian_name      text CHECK (guardian_name IS NULL OR length(btrim(guardian_name)) BETWEEN 2 AND 120),
  guardian_phone     text CHECK (guardian_phone IS NULL OR guardian_phone ~ '^\+?[0-9]{9,15}$'),
  guardian_relation  text CHECK (guardian_relation IS NULL OR guardian_relation IN ('father', 'mother', 'guardian', 'other')),

  preferred_schedule text CHECK (preferred_schedule IS NULL OR length(preferred_schedule) <= 300),
  message            text CHECK (message IS NULL OR length(message) <= 1000),
  locale             text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'ar', 'en')),
  consent_at         timestamptz NOT NULL,
  source_hash        text,

  status             text NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'reviewing', 'accepted', 'rejected', 'duplicate')),
  decision_note      text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  decided_at         timestamptz,
  decided_by         uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  student_id         uuid REFERENCES public.students (id) ON DELETE SET NULL,
  registration_id    uuid REFERENCES public.registrations (id) ON DELETE SET NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Someone must be reachable: the learner or the guardian.
  CONSTRAINT applications_contact CHECK (phone IS NOT NULL OR guardian_phone IS NOT NULL),
  -- A decision is dated; an open application is not.
  CONSTRAINT applications_decision_dated CHECK (
    (status IN ('accepted', 'rejected', 'duplicate')) = (decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_applications_status_created ON public.applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_program ON public.applications (program_id);
CREATE INDEX IF NOT EXISTS idx_applications_phone ON public.applications (phone);
CREATE INDEX IF NOT EXISTS idx_applications_guardian_phone ON public.applications (guardian_phone);
CREATE INDEX IF NOT EXISTS idx_applications_source ON public.applications (source_hash, created_at DESC);

COMMENT ON TABLE public.applications IS
  'Pre-registrations: public applications to a formation, reviewed by the administration. Not '
  'registrations: accepting one creates/links a student and an approved registration.';

DROP TRIGGER IF EXISTS t_applications_updated ON public.applications;
CREATE TRIGGER t_applications_updated
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.applications FROM anon;
-- No INSERT for clients: applications arrive only through the validated server function.
REVOKE INSERT ON public.applications FROM authenticated;
GRANT SELECT, UPDATE, DELETE ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;

DROP POLICY IF EXISTS "applications admin read" ON public.applications;
CREATE POLICY "applications admin read" ON public.applications
  FOR SELECT TO authenticated USING (private.is_admin());

DROP POLICY IF EXISTS "applications admin update" ON public.applications;
CREATE POLICY "applications admin update" ON public.applications
  FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS "applications admin delete" ON public.applications;
CREATE POLICY "applications admin delete" ON public.applications
  FOR DELETE TO authenticated USING (private.is_admin());

-- ------------------------------------------------------------------ admin notification
CREATE OR REPLACE FUNCTION public.notify_application_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, kind, params)
  SELECT ur.user_id, 'application_received',
         jsonb_build_object('name', NEW.first_name || ' ' || NEW.last_name,
                            'formation', NEW.program_name,
                            'application_id', NEW.id)
    FROM public.user_roles ur
   WHERE ur.role = 'admin';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_application_received() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_applications_notify ON public.applications;
CREATE TRIGGER t_applications_notify
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_application_received();

-- ------------------------------------------------------------------ accept
-- Places the (existing or just-created) student in a group of the requested formation and closes
-- the application, in one transaction. Runs as the calling administrator: RLS and every
-- registration trigger apply (capacity, one place per subject + level, consistency).
CREATE OR REPLACE FUNCTION public.accept_application(
  p_application uuid,
  p_student     uuid,
  p_group       uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  app public.applications;
  grp public.groups;
  reg_id uuid;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can accept an application.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO app FROM public.applications WHERE id = p_application FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF app.status NOT IN ('new', 'reviewing') THEN
    RAISE EXCEPTION 'This application has already been decided.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO grp FROM public.groups WHERE id = p_group;
  IF NOT FOUND OR grp.program_id IS DISTINCT FROM app.program_id THEN
    RAISE EXCEPTION 'The group must belong to the requested formation.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.registrations (student_id, group_id, status, decided_at)
  VALUES (p_student, p_group, 'approved', now())
  RETURNING id INTO reg_id;

  UPDATE public.applications
     SET status = 'accepted', student_id = p_student, registration_id = reg_id,
         decided_at = now(), decided_by = auth.uid()
   WHERE id = p_application;

  RETURN reg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_application(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_application(uuid, uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------ post-conditions
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.applications', 'SELECT')
     OR has_table_privilege('anon', 'public.applications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.applications', 'INSERT') THEN
    RAISE EXCEPTION 'applications must not be readable by anon nor insertable by clients';
  END IF;
END $$;
