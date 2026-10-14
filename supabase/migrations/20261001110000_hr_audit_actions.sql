-- ------------------------------------------------------------------
-- Audit actions for HR records (20261001110100_hr_foundation.sql).
--
-- Three generic actions rather than one per table: the entity and the before/after values
-- are in `details`, which is where a reader looks anyway, and the enum does not grow each
-- time an HR table is added. Added, never used, here: PostgreSQL forbids using an enum value
-- in the transaction that introduces it (55P04).
-- ------------------------------------------------------------------

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'hr_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'hr_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'hr_deleted';
