-- Phase 0 / TD-4: drop table privileges the application never uses.
--
-- Audit found anon and authenticated holding
--   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
-- on all 12 public tables. The migrations only ever granted the four DML
-- verbs, so TRUNCATE/REFERENCES/TRIGGER came from a platform-level default.
--
-- Why it matters: RLS filters rows for DML, but TRUNCATE is a table-level
-- operation that RLS cannot restrict at all. A role holding TRUNCATE can empty
-- a table regardless of policy.
--
-- Not currently exploitable -- PostgREST exposes no TRUNCATE verb, and anon
-- holds EXECUTE on no function -- so this is defence in depth, closing the gap
-- before some future RPC or extension makes it reachable.
--
-- Scope note: anon keeps *nothing* on public tables. Unauthenticated visitors
-- only ever see the marketing landing page; every policy in the schema is
-- scoped TO authenticated, so anon already received zero rows. Revoking makes
-- the intent explicit at the privilege layer instead of relying solely on RLS.
--
-- authenticated keeps exactly SELECT, INSERT, UPDATE, DELETE -- the verbs
-- PostgREST needs -- with RLS continuing to decide which rows are affected.

-- 1. Strip the three unused privileges from both roles, on every table.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- 2. anon has no legitimate use for any table privilege in this application.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- 3. Re-assert the DML grants authenticated actually needs, so this migration
--    is self-contained and safe to re-run.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO authenticated;

-- 4. Stop the platform default from re-granting the extra privileges to
--    future tables created by the postgres role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
