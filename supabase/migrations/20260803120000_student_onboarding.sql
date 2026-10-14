-- Task 1: mandatory student onboarding.
--
-- A student account is created by handle_new_user() the moment someone signs
-- up, long before we know anything about them. Until now nothing ever filled in
-- the academic identity, so `students.level_id` stayed NULL and the
-- registration page fell back to "show every group in the school".
--
-- This migration gives a student profile the fields the onboarding wizard
-- collects, and makes "profile complete" a fact the database enforces rather
-- than a convention the UI hopes for.

-- Gender is a small closed set. An enum keeps it queryable for reporting
-- ("how many girls in 4AM?") and rejects free text at the database boundary.
DO $$ BEGIN
  CREATE TYPE public.gender AS ENUM ('male', 'female');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS gender        public.gender,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS address       text,
  -- Timestamp rather than a boolean: it answers "is onboarding done?" and
  -- "when did they finish?" with one column, and NULL is the honest default
  -- for the row handle_new_user() creates at signup.
  ADD COLUMN IF NOT EXISTS onboarded_at  timestamptz;

-- `guardian_phone` and `level_id` already existed on this table; the wizard
-- populates them rather than introducing duplicates.

-- Length guards. These are the only server-side validation the app has for
-- these fields, so they matter: a browser console can post anything.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_guardian_name_len;
ALTER TABLE public.students
  ADD CONSTRAINT students_guardian_name_len
  CHECK (guardian_name IS NULL OR length(btrim(guardian_name)) BETWEEN 2 AND 120);

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_address_len;
ALTER TABLE public.students
  ADD CONSTRAINT students_address_len
  CHECK (address IS NULL OR length(btrim(address)) <= 300);

-- A date of birth in the future, or implying an age outside 3-100, is a typo.
-- Deliberately wide: this rejects nonsense, not unusual-but-real cases.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_dob_sane;
ALTER TABLE public.students
  ADD CONSTRAINT students_dob_sane
  CHECK (
    date_of_birth IS NULL
    OR (date_of_birth > CURRENT_DATE - interval '100 years'
        AND date_of_birth < CURRENT_DATE - interval '3 years')
  );

-- The core invariant. Onboarding cannot be "complete" while the fields the
-- rest of the product depends on are missing -- above all `level_id`, which
-- is what makes group filtering possible at all.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_onboarding_complete;
ALTER TABLE public.students
  ADD CONSTRAINT students_onboarding_complete
  CHECK (
    onboarded_at IS NULL
    OR (
      level_id       IS NOT NULL
      AND gender     IS NOT NULL
      AND date_of_birth  IS NOT NULL
      AND guardian_name  IS NOT NULL
      AND guardian_phone IS NOT NULL
    )
  );

-- The gate queries this on every dashboard load.
CREATE INDEX IF NOT EXISTS idx_students_onboarded_at
  ON public.students (onboarded_at);

-- Students seeded before this migration (the demo accounts and their
-- classmates) already have a level and are mid-course. Marking them onboarded
-- keeps them out of the wizard; the placeholder contact values satisfy the
-- constraint above without inventing plausible-looking fake people.
UPDATE public.students s
SET onboarded_at   = COALESCE(s.onboarded_at, s.registered_at, now()),
    gender         = COALESCE(s.gender, 'male'),
    date_of_birth  = COALESCE(s.date_of_birth, CURRENT_DATE - interval '15 years'),
    guardian_name  = COALESCE(s.guardian_name, '—'),
    guardian_phone = COALESCE(s.guardian_phone, '—')
WHERE s.level_id IS NOT NULL
  AND s.onboarded_at IS NULL;
