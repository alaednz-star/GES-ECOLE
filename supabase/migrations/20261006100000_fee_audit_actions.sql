-- ------------------------------------------------------------------
-- Audit actions for fees (charges and their installments).
--
-- Added, never used, in this migration: PostgreSQL forbids using an enum value
-- in the same transaction that introduces it (55P04). The functions that write
-- them arrive in 20261006100100_fees_installments.sql.
-- ------------------------------------------------------------------

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'charge_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'charge_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'charge_cancelled';
