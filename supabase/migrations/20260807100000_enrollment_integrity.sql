-- P0: a student may hold only ONE active enrolment per (subject, level).
--
-- THE RULE
--   OK    Mathematics / 1AP -> Group A
--   NOT   Mathematics / 1AP -> Group A AND Group B
--   OK    Mathematics -> Group A, French -> Group C
--
-- WHY IT WAS POSSIBLE
--   `registrations` carried only UNIQUE (student_id, group_id). That stops the
--   same student joining the SAME group twice, and says nothing about two
--   DIFFERENT groups teaching the same subject at the same level. Measured on
--   this database before the fix: 5 violating combinations -- every student was
--   enrolled in both "WS Test 1" and "WS Test 2", both Mathematics / 1AP.
--
-- WHY A PLAIN UNIQUE CANNOT EXPRESS IT
--   The subject and level live on `groups`, not on `registrations`, and a UNIQUE
--   constraint cannot reach across a join. So the two columns are denormalised
--   onto `registrations` and kept in sync by trigger -- the row then carries
--   everything the index needs.
--
-- WHY A PARTIAL INDEX
--   Only `pending` and `approved` occupy a place. A `rejected` row is history and
--   must stay readable, so it is excluded from the index. That also makes the
--   transfer flow work: reject the old enrolment, approve the new one.
--   Verified on a prototype before writing this migration:
--     first enrolment            -> allowed
--     second group, same subject -> 23505 rejected
--     rejected row, same subject -> allowed (history preserved)
--     different subject          -> allowed
--     transfer (reject then approve) -> allowed
--
-- NULL subject or level means the group is still being set up; those rows are
-- excluded rather than collapsed together, since NULLs are not comparable.
--
-- No DROP TABLE / DROP COLUMN. The only rows touched are the duplicates
-- resolved in section 3, and they are demoted to `rejected`, never deleted.

-- ------------------------------------------------------------------
-- 1. Carry the subject and level on the enrolment itself
-- ------------------------------------------------------------------

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS level_id   uuid REFERENCES public.levels(id)   ON DELETE SET NULL;

COMMENT ON COLUMN public.registrations.subject_id IS
  'Denormalised from groups. Exists so the one-active-enrolment rule can be a unique index; maintained by trigger, never written by clients.';
COMMENT ON COLUMN public.registrations.level_id IS
  'Denormalised from groups. See registrations.subject_id.';

-- Backfill from the group each row already points at.
UPDATE public.registrations r
   SET subject_id = g.subject_id,
       level_id   = g.level_id
  FROM public.groups g
 WHERE g.id = r.group_id
   AND (r.subject_id IS DISTINCT FROM g.subject_id OR r.level_id IS DISTINCT FROM g.level_id);

-- ------------------------------------------------------------------
-- 2. Keep them in sync
--
-- The client never sets these: the trigger derives them from the group on every
-- write, so a stale or forged value cannot enter. Groups can also be re-pointed
-- to another subject, so the second trigger cascades that change.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_registration_academics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  SELECT g.subject_id, g.level_id
    INTO NEW.subject_id, NEW.level_id
    FROM public.groups g
   WHERE g.id = NEW.group_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_registrations_sync_academics ON public.registrations;
CREATE TRIGGER t_registrations_sync_academics
BEFORE INSERT OR UPDATE OF group_id ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.sync_registration_academics();

/* If a group is moved to another subject or level, its enrolments follow. */
CREATE OR REPLACE FUNCTION public.cascade_group_academics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.level_id IS DISTINCT FROM OLD.level_id THEN
    UPDATE public.registrations
       SET subject_id = NEW.subject_id,
           level_id   = NEW.level_id
     WHERE group_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_groups_cascade_academics ON public.groups;
CREATE TRIGGER t_groups_cascade_academics
AFTER UPDATE OF subject_id, level_id ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.cascade_group_academics();

-- ------------------------------------------------------------------
-- 3. Resolve existing duplicates BEFORE the index exists
--
-- Keep the OLDEST active enrolment per (student, subject, level) -- the one the
-- student actually started with -- and demote the rest to `rejected` with a note
-- saying why. Nothing is deleted: attendance and history hang off these rows,
-- and a silent DELETE would cascade them away.
-- ------------------------------------------------------------------

WITH ranked AS (
  SELECT r.id,
         row_number() OVER (
           PARTITION BY r.student_id, r.subject_id, r.level_id
           ORDER BY r.created_at, r.id
         ) AS rn
    FROM public.registrations r
   WHERE r.status IN ('pending', 'approved')
     AND r.subject_id IS NOT NULL
     AND r.level_id IS NOT NULL
)
UPDATE public.registrations r
   SET status = 'rejected',
       note = COALESCE(NULLIF(r.note, '') || ' | ', '')
              || 'Auto-resolved: duplicate enrolment for this subject and level.',
       decided_at = COALESCE(r.decided_at, now())
  FROM ranked
 WHERE ranked.id = r.id
   AND ranked.rn > 1;

-- ------------------------------------------------------------------
-- 4. The structural guarantee
-- ------------------------------------------------------------------

DROP INDEX IF EXISTS public.registrations_one_active_per_subject_level;
CREATE UNIQUE INDEX registrations_one_active_per_subject_level
    ON public.registrations (student_id, subject_id, level_id)
 WHERE status IN ('pending', 'approved')
   AND subject_id IS NOT NULL
   AND level_id IS NOT NULL;

COMMENT ON INDEX public.registrations_one_active_per_subject_level IS
  'A student may hold only one pending/approved enrolment per (subject, level). Rejected rows are excluded so history survives and transfers are possible.';

-- Reading the pair happens on every roster query.
CREATE INDEX IF NOT EXISTS idx_registrations_student_subject_level
    ON public.registrations (student_id, subject_id, level_id);

-- ------------------------------------------------------------------
-- 5. A readable error instead of a raw index name
--
-- `23505` on a unique index yields "duplicate key value violates unique
-- constraint ...", which means nothing to an administrator. This turns it into
-- a sentence naming the group the student is already in. Runs BEFORE the index
-- so the message wins.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_one_group_per_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _existing text;
BEGIN
  IF NEW.status NOT IN ('pending', 'approved') THEN RETURN NEW; END IF;
  IF NEW.subject_id IS NULL OR NEW.level_id IS NULL THEN RETURN NEW; END IF;

  SELECT g.name INTO _existing
    FROM public.registrations r
    JOIN public.groups g ON g.id = r.group_id
   WHERE r.student_id = NEW.student_id
     AND r.subject_id = NEW.subject_id
     AND r.level_id   = NEW.level_id
     AND r.status IN ('pending', 'approved')
     AND r.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'This student is already enrolled in "%" for this subject and level', _existing
      USING ERRCODE = 'unique_violation',
            HINT = 'Reject the existing enrolment first to move the student.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_registrations_one_per_subject ON public.registrations;
CREATE TRIGGER t_registrations_one_per_subject
BEFORE INSERT OR UPDATE OF status, group_id ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_group_per_subject();

-- ------------------------------------------------------------------
-- 6. Post-conditions
-- ------------------------------------------------------------------

DO $$
DECLARE _dupes integer; _unsynced integer;
BEGIN
  SELECT count(*)::int INTO _dupes FROM (
    SELECT 1 FROM public.registrations
     WHERE status IN ('pending', 'approved')
       AND subject_id IS NOT NULL AND level_id IS NOT NULL
     GROUP BY student_id, subject_id, level_id
    HAVING count(*) > 1
  ) d;
  IF _dupes > 0 THEN
    RAISE EXCEPTION 'Still % duplicated active enrolment(s) after cleanup', _dupes;
  END IF;

  SELECT count(*)::int INTO _unsynced
    FROM public.registrations r JOIN public.groups g ON g.id = r.group_id
   WHERE r.subject_id IS DISTINCT FROM g.subject_id
      OR r.level_id IS DISTINCT FROM g.level_id;
  IF _unsynced > 0 THEN
    RAISE EXCEPTION '% registration(s) out of sync with their group', _unsynced;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'registrations_one_active_per_subject_level'
  ) THEN
    RAISE EXCEPTION 'uniqueness index missing';
  END IF;

  RAISE NOTICE 'Enrolment integrity enforced.';
END $$;
