-- ------------------------------------------------------------------
-- Audit actions for payments.
--
-- Added, never used, in this migration: PostgreSQL forbids using an enum value
-- in the same transaction that introduces it (55P04). The trigger that writes
-- them arrives in 20260930100100_payment_management.sql.
-- ------------------------------------------------------------------

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_recorded';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_deleted';
