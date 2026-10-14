-- ------------------------------------------------------------------
-- Audit actions for official documents (ADR-007).
--
-- Added, never used, in this migration: PostgreSQL forbids using an enum value
-- in the same transaction that introduces it (55P04). The functions that write
-- them arrive in 20261007120100_official_documents.sql.
-- ------------------------------------------------------------------

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'document_issued';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'document_voided';
