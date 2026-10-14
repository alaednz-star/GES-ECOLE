-- ==================================================================
-- Enrollment lifecycle, step 1: the `withdrawn` state (ADR-004 section 4).
--
-- A student who HELD a place and left is neither "rejected" (they were accepted) nor a deleted
-- row (their attendance and payments are history). `withdrawn` records exactly that.
--
-- Its own migration because a new enum value cannot be used in the transaction that adds it
-- (Postgres 55P04); 20261004100100 uses it.
--
-- ROLLBACK: enum values cannot be dropped; an unused value is harmless.
-- ==================================================================

ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'withdrawn';
