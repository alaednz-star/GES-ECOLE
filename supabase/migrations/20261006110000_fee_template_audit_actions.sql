-- ------------------------------------------------------------------
-- Audit actions for formation / group fee templates.
--
-- Added, never used, in this migration: PostgreSQL forbids using an enum value
-- in the same transaction that introduces it (55P04). The functions that write
-- them arrive in 20261006110100_fee_templates.sql.
-- ------------------------------------------------------------------

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'fee_template_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'fee_template_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'fee_template_removed';
