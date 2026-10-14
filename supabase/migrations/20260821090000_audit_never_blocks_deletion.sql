-- ------------------------------------------------------------------
-- The audit trail must never be the reason an account cannot be deleted.
--
-- THE BUG. `private.entity_dependencies` classified `audit_log` as 'blocking'.
-- Every provisioned teacher already has an audit entry from their own creation,
-- and a password reset adds a second, so the delete path reported
--   "This account still owns records: audit_log (2). Archive it instead."
-- for an account created by mistake and never used. Permanent deletion was
-- therefore unreachable in practice for every teacher who had ever existed.
--
-- The confirmation dialog made the contradiction plain: it promises "the audit
-- trail is kept" and was then refused BECAUSE the audit trail was kept.
--
-- WHY THIS IS SAFE, AND WHY NO FOREIGN KEY IS TOUCHED. `audit_log` already
-- points at `profiles` with ON DELETE SET NULL on both `actor_id` and
-- `target_id`, and already carries `actor_email` and `target_email` alongside
-- them. Deleting an account therefore does not delete, cascade or orphan a
-- single audit row: the pointer becomes null and the email remains as the
-- record of who was removed. The constraint was never what blocked deletion --
-- the classification was. So this migration deletes no history, weakens no
-- constraint and adds no cascade. It corrects a label that was wrong.
--
-- WHY 'preserved' RATHER THAN 'incidental'. 'incidental' means the rows are
-- swept away with the account and nobody minds -- `teacher_subjects`, which
-- cascades. Audit rows do the opposite: they survive, deliberately. Telling an
-- administrator that the audit trail is "incidental" would be false, and the
-- dialog needs to say what actually happens to it. The other dependencies stay
-- 'blocking' precisely because they do NOT survive intact: `student_notes`
-- cascades away with its author, and `attendance.marked_by` nulls with no email
-- kept beside it, so who marked the register would be lost for good. For
-- anybody who has actually taught, archiving remains the right answer.
-- ------------------------------------------------------------------

-- The classification below is a claim about the constraints. If a later
-- migration changes them, this must fail loudly rather than quietly start
-- deleting history it promised to keep.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(con.conname || ' = ' || con.confdeltype::text, ', ')
    INTO bad
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
   WHERE con.contype = 'f'
     AND src.relname = 'audit_log'
     AND con.conname IN ('audit_log_actor_id_fkey', 'audit_log_target_id_fkey')
     AND con.confdeltype <> 'n';  -- 'n' = ON DELETE SET NULL

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'audit_log must reference profiles ON DELETE SET NULL for deletion to preserve history; found: %', bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'audit_log'
       AND column_name IN ('actor_email', 'target_email')
     HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION
      'audit_log must keep actor_email and target_email, or a deleted account leaves an anonymous entry';
  END IF;
END;
$$;

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
      -- `marked_by` nulls on delete and no email is kept beside it, so deleting
      -- would erase who took the register. Anyone who has taught gets archived.
      SELECT 'attendance', 'marked_by',
             (SELECT count(*)::int FROM public.attendance WHERE marked_by = _id),
             'blocking'
      UNION ALL
      -- Notes CASCADE away with their author: real, irreversible loss.
      SELECT 'student_notes', 'authored',
             (SELECT count(*)::int FROM public.student_notes WHERE author_id = _id),
             'blocking'
      UNION ALL
      -- Survives deletion with the email intact. Reported, never a blocker.
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
      -- Same reasoning as the teacher above.
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

-- `private.entity_is_deletable` is deliberately left as it stands: it already
-- names the severities that block -- 'blocking' and 'reassignable' -- rather
-- than excluding the ones that do not, so 'preserved' passes it without any
-- change. Its other caller, the role-change reconciliation in
-- 20260806180000, inherits the same correction: a student who changed role
-- could not previously have their stale identity row cleaned up if they had
-- ever appeared in the audit log, which was the same misclassification wearing
-- a different hat.

COMMENT ON FUNCTION private.entity_dependencies(text, uuid) IS
  'Why an entity cannot be permanently deleted. Severity: blocking (history would be lost), '
  'reassignable (move it first), incidental (cascades away), preserved (survives the deletion '
  'with identity retained -- reported to the administrator, never a blocker).';
