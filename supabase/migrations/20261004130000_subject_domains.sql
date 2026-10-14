-- ==================================================================
-- Subject domains: what a subject IS, so the formation form can offer only the subjects that fit
-- the formation's type (ADR-004 section 1, "Subject domains").
--
-- MODEL
--   subjects.domain   text NOT NULL, one of:
--                       languages        English, French, Arabic...
--                       school_subjects  Mathematics, Physics, Natural sciences...
--                       computing        Computing and technology
--                       professional     Professional / technical skills
--                       other            anything else, and the explicit "not classified" state
--
--   A CHECK list, like programs.category: no taxonomy table and no category administration.
--   Adding a domain later is one migration (extend the CHECK) plus its labels and its place in
--   the formation-type compatibility map (src/features/school/subject-domain.ts).
--
-- WHAT THIS DOES NOT DO, ON PURPOSE
--   The domain is a CLASSIFICATION used for filtering. It is not coupled to programs.category in
--   the database: a formation keeps whatever subject it has, and reclassifying a subject never
--   invalidates an existing formation. Teacher qualifications, groups, registrations and the
--   formation -> group subject rule are untouched. RLS is unchanged: the column is covered by
--   the existing "subjects read" (authenticated) and "subjects admin write" policies.
--
-- BACKFILL (deterministic, by the stable `key`, never by display name)
--   english, french, arabic                  -> languages
--   mathematics, physics, natural_sciences   -> school_subjects
--   every other key                          -> other (explicit "not classified"; an
--                                               administrator reclassifies it on the Subjects
--                                               page). Locally this is `mkt`, which has no
--                                               description and cannot be classified safely.
--   No subject is deleted, recreated or renamed; ids and every reference are unchanged.
--
-- ROLLBACK
--   ALTER TABLE public.subjects DROP COLUMN domain;
-- ==================================================================

ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'other';

ALTER TABLE public.subjects DROP CONSTRAINT IF EXISTS subjects_domain_check;
ALTER TABLE public.subjects
  ADD CONSTRAINT subjects_domain_check
  CHECK (domain IN ('languages', 'school_subjects', 'computing', 'professional', 'other'));

COMMENT ON COLUMN public.subjects.domain IS
  'What the subject is (languages, school_subjects, computing, professional, other). Used to '
  'offer the subjects that fit a formation type; not a database rule on formations.';

UPDATE public.subjects SET domain = 'languages'
 WHERE key IN ('english', 'french', 'arabic') AND domain = 'other';
UPDATE public.subjects SET domain = 'school_subjects'
 WHERE key IN ('mathematics', 'physics', 'natural_sciences') AND domain = 'other';

-- Post-conditions.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.subjects
   WHERE (key IN ('english', 'french', 'arabic') AND domain <> 'languages')
      OR (key IN ('mathematics', 'physics', 'natural_sciences') AND domain <> 'school_subjects');
  IF n > 0 THEN
    RAISE EXCEPTION '% built-in subject(s) were not classified', n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.subjects
              WHERE domain NOT IN ('languages', 'school_subjects', 'computing', 'professional', 'other')) THEN
    RAISE EXCEPTION 'a subject has an invalid domain';
  END IF;
END $$;
