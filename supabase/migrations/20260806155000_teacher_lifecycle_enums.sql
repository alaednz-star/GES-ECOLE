-- Teacher lifecycle, part 1 of 2: vocabulary only.
--
-- WHY THIS IS A SEPARATE FILE
--
-- Postgres refuses to *use* an enum value that was added in the still-open
-- transaction: `55P04 unsafe use of new value ... New enum values must be
-- committed before they can be used`. Verified directly against this database:
-- adding a value and then running `UPDATE ... SET status = <new value>` in one
-- transaction fails.
--
-- The companion migration (20260806160000_teacher_lifecycle.sql) backfills
-- `inactive -> suspended`, which is exactly that forbidden pattern. Splitting
-- the ALTER TYPE statements into their own migration guarantees they are
-- committed before the backfill runs, whether applied by the CLI or by hand.
--
-- Adding an enum value cannot be undone (Postgres has no DROP VALUE), but these
-- additions are inert on their own: nothing references them until part 2.

ALTER TYPE public.entity_status ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE public.entity_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'teacher_suspended';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'teacher_reactivated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'teacher_archived';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'teacher_restored';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'teacher_deleted';
