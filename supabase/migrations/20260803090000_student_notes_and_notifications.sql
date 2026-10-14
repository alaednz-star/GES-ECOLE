-- Phase 2 / Modules 1, 3, 9: the two tables the product is missing.
--
--   student_notes  -- private notes a teacher or admin keeps about a student.
--                     Never visible to the student themselves.
--   notifications  -- in-app messages (registration decided, attendance marked,
--                     group updated, announcements).
--
-- Both follow the conventions already established in this schema: uuid PK,
-- timestamptz created_at, RLS enabled, policies scoped TO authenticated, and
-- explicit grants for the roles PostgREST uses.

-- ============================ STUDENT NOTES ============================

CREATE TABLE IF NOT EXISTS public.student_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_notes TO authenticated;
GRANT ALL ON public.student_notes TO service_role;
ALTER TABLE public.student_notes ENABLE ROW LEVEL SECURITY;

-- Read: admins see every note. Teachers see notes about students enrolled in a
-- group they teach (mirrors the existing scoping on public.students).
-- Students deliberately cannot read notes written about them.
DROP POLICY IF EXISTS "student_notes read" ON public.student_notes;
CREATE POLICY "student_notes read" ON public.student_notes
FOR SELECT TO authenticated
USING (
  private.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.registrations r
    JOIN public.groups g ON g.id = r.group_id
    WHERE r.student_id = student_notes.student_id
      AND r.status = 'approved'
      AND g.teacher_id = auth.uid()
  )
);

-- Write: the author must be the current user, and that user must be an admin or
-- the student's teacher. Prevents writing a note under someone else's name.
DROP POLICY IF EXISTS "student_notes insert" ON public.student_notes;
CREATE POLICY "student_notes insert" ON public.student_notes
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND (
    private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.registrations r
      JOIN public.groups g ON g.id = r.group_id
      WHERE r.student_id = student_notes.student_id
        AND r.status = 'approved'
        AND g.teacher_id = auth.uid()
    )
  )
);

-- Authors edit and delete their own notes; admins may moderate any note.
DROP POLICY IF EXISTS "student_notes update" ON public.student_notes;
CREATE POLICY "student_notes update" ON public.student_notes
FOR UPDATE TO authenticated
USING (author_id = auth.uid() OR private.is_admin())
WITH CHECK (author_id = auth.uid() OR private.is_admin());

DROP POLICY IF EXISTS "student_notes delete" ON public.student_notes;
CREATE POLICY "student_notes delete" ON public.student_notes
FOR DELETE TO authenticated
USING (author_id = auth.uid() OR private.is_admin());

CREATE INDEX IF NOT EXISTS idx_student_notes_student_id
  ON public.student_notes (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_notes_author_id
  ON public.student_notes (author_id);

DROP TRIGGER IF EXISTS t_student_notes_updated ON public.student_notes;
CREATE TRIGGER t_student_notes_updated
BEFORE UPDATE ON public.student_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================ NOTIFICATIONS ============================

DO $$ BEGIN
  CREATE TYPE public.notification_kind AS ENUM (
    'registration_approved',
    'registration_rejected',
    'attendance_marked',
    'teacher_assigned',
    'group_updated',
    'announcement'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind public.notification_kind NOT NULL,
  -- Payload for i18n interpolation ({group}, {subject}, ...). The client renders
  -- a translated template per `kind`, so no user-facing prose is stored here and
  -- notifications display correctly in fr/ar/en regardless of who created them.
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipients read their own; admins may audit.
DROP POLICY IF EXISTS "notifications read" ON public.notifications;
CREATE POLICY "notifications read" ON public.notifications
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR private.is_admin());

-- Admins and teachers can notify; teachers only their own students.
DROP POLICY IF EXISTS "notifications insert" ON public.notifications;
CREATE POLICY "notifications insert" ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (
  private.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.registrations r
    JOIN public.groups g ON g.id = r.group_id
    WHERE r.student_id = notifications.user_id
      AND r.status = 'approved'
      AND g.teacher_id = auth.uid()
  )
);

-- Recipients mark their own as read.
DROP POLICY IF EXISTS "notifications update" ON public.notifications;
CREATE POLICY "notifications update" ON public.notifications
FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR private.is_admin())
WITH CHECK (user_id = auth.uid() OR private.is_admin());

DROP POLICY IF EXISTS "notifications delete" ON public.notifications;
CREATE POLICY "notifications delete" ON public.notifications
FOR DELETE TO authenticated
USING (user_id = auth.uid() OR private.is_admin());

-- Unread-first inbox lookup is the only access pattern.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (user_id) WHERE read_at IS NULL;

-- ==================== AUTOMATIC REGISTRATION NOTICES ====================

-- Notify the student when an admin approves or rejects their registration.
-- SECURITY DEFINER because the actor is the admin, not the recipient, so the
-- insert must bypass the recipient-scoped policy above.
CREATE OR REPLACE FUNCTION public.notify_registration_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE group_name text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;

  SELECT g.name INTO group_name FROM public.groups g WHERE g.id = NEW.group_id;

  INSERT INTO public.notifications (user_id, kind, params)
  VALUES (
    NEW.student_id,
    CASE WHEN NEW.status = 'approved'
         THEN 'registration_approved'::public.notification_kind
         ELSE 'registration_rejected'::public.notification_kind END,
    jsonb_build_object('group', COALESCE(group_name, ''))
  );
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.notify_registration_decision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t_registration_decided ON public.registrations;
CREATE TRIGGER t_registration_decided
AFTER UPDATE OF status ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.notify_registration_decision();
