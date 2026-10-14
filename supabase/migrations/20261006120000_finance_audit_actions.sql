-- ------------------------------------------------------------------
-- Audit actions for finance management (ADR-006): discounts, receipts, invoices.
--
-- Added, never used, in this migration: PostgreSQL forbids using an enum value
-- in the same transaction that introduces it (55P04). The functions that write
-- them arrive in 20261006120100 .. 20261006120300.
-- ------------------------------------------------------------------

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'discount_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'discount_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'discount_granted';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'discount_cancelled';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'receipt_issued';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'receipt_voided';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'invoice_issued';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'invoice_voided';
