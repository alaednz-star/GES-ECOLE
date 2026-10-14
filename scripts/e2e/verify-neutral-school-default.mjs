/**
 * Verifies migration 20261015100000_neutral_school_default.sql against the LOCAL database,
 * inside ONE transaction that is always ROLLED BACK: nothing it does survives the run.
 *
 * It runs the migration FILE (not a copy of its statements) from each starting state:
 *   A. the row still holds the legacy default 'Madrasti'  -> cleared to ''
 *   B. the row holds a name a school chose                 -> unchanged
 * and checks that the column default becomes ''.
 *
 *   DB_CONTAINER=<your local supabase_db_* container> node scripts/e2e/verify-neutral-school-default.mjs
 *
 * LOCAL ONLY: it talks to a Docker container on this machine, never to a hosted project.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = process.env["DB_CONTAINER"];
if (!container || !/^supabase_db_/.test(container)) {
  console.error(
    "Set DB_CONTAINER to your local Supabase database container (docker ps: supabase_db_*).",
  );
  process.exit(2);
}
const migration = readFileSync(
  "supabase/migrations/20261015100000_neutral_school_default.sql",
  "utf8",
);
const SCHOOL = "École Les Lauriers";

// No psql meta-commands in here: ON_ERROR_STOP is a command-line flag, so the very first error
// (including a failed BEGIN) stops the run before any statement can execute outside the
// transaction. The DO block refuses to go on unless a transaction is really open.
const sql = `
BEGIN;
DO $$ BEGIN
  -- Outside an explicit transaction, this statement starts its own and the two times are equal.
  IF now() = statement_timestamp() THEN
    RAISE EXCEPTION 'not inside a transaction: refusing to run';
  END IF;
END $$;
-- Each check prints its own line BEFORE the savepoint is rolled back (a rollback to a savepoint
-- would also erase any row written to a results table).

-- A. the legacy default
SAVEPOINT a;
UPDATE public.center_settings SET school_name = 'Madrasti';
${migration}
SELECT CASE WHEN school_name = '' THEN 'PASS' ELSE 'FAIL' END || '  A: the legacy default is cleared (' || school_name || ')'
  FROM public.center_settings;
SELECT CASE WHEN column_default = '''''::text' THEN 'PASS' ELSE 'FAIL' END || '  A: the column default is now empty (' || column_default || ')'
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'center_settings' AND column_name = 'school_name';
ROLLBACK TO SAVEPOINT a;

-- B. a name the school chose
SAVEPOINT b;
UPDATE public.center_settings SET school_name = '${SCHOOL}';
${migration}
SELECT CASE WHEN school_name = '${SCHOOL}' THEN 'PASS' ELSE 'FAIL' END || '  B: a chosen name is left unchanged (' || school_name || ')'
  FROM public.center_settings;
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END || '  B: still exactly one settings row (' || count(*) || ')'
  FROM public.center_settings;
ROLLBACK TO SAVEPOINT b;

ROLLBACK;
`;

const r = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-U", "postgres", "-At", "-q", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8" },
);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
const passed = (r.stdout.match(/^PASS /gm) ?? []).length;
const failedChecks = (r.stdout.match(/^FAIL /gm) ?? []).length;
console.log(`passed ${passed}, failed ${failedChecks}`);
// Exactly four checks must have run and passed: zero checks is a failure, not a pass.
const failed = r.status !== 0 || passed !== 4 || failedChecks !== 0;
process.exit(failed ? 1 : 0);
