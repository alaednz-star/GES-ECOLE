/**
 * Disposable test accounts for the E2E suites.
 *
 * The suites do not sign in as seeded demo accounts: a real school's database
 * must not carry test logins.
 *
 * Instead each run provisions its own throwaway staff accounts through the same
 * audited path the application uses (`auth.admin.createUser` +
 * `public.provision_staff`), then removes them. Nothing test-related survives a
 * run, and the real accounts are never signed into -- their passwords are
 * change-on-first-login and are not known to the harness.
 *
 * Usage:
 *   import { withFixtures } from "./fixtures.mjs";
 *   const fx = await withFixtures({ admin: true, teacher: true });
 *   ...
 *   await fx.cleanup();
 */
import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);

// Default: this project's local stack (supabase/config.toml). Never a default that could be
// another project's stack.
export const API = env["VITE_SUPABASE_URL"] ?? "http://127.0.0.1:55321";
const KEY = env["SUPABASE_SERVICE_ROLE_KEY"];

if (!/127\.0\.0\.1|localhost/.test(API)) {
  throw new Error(`fixtures are LOCAL ONLY; refusing to run against ${API}`);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

/**
 * Local API keys, read from `.env.local` at run time.
 *
 * These used to be hard-coded in the suites. They are only ever the LOCAL
 * stack's keys, but committing key material is still wrong -- GitHub's secret
 * scanning correctly rejects it -- so the suites read them from the ignored
 * env file like every other consumer does.
 */
export const PUBLISHABLE_KEY =
  env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? env["VITE_SUPABASE_ANON_KEY"] ?? "";
export const SERVICE_ROLE_KEY = KEY;

export const sql = async (query) => {
  const r = await fetch(`${API}/pg/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j && j.error) throw new Error(j.error);
  return j;
};

/** Fixed password: these accounts exist only for the duration of one run. */
export const TEST_PASSWORD = "E2eFixture!2026";

/** Marks every fixture account so cleanup can find them unambiguously. */
const TAG = "e2e-fixture";

function uniqueEmail(role) {
  const n = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `${TAG}-${role}-${n}@example.test`;
}

async function createUser({ email, fullName, role }) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName, [TAG]: true },
      app_metadata: { role, [TAG]: true },
    }),
  });
  if (!res.ok) throw new Error(`createUser ${email}: ${res.status} ${await res.text()}`);
  const user = await res.json();

  if (role === "admin" || role === "teacher") {
    await sql(
      `select public.provision_staff('${user.id}'::uuid, '${role}'::app_role, 0, null, null);`,
    );
  }
  // `handle_new_user` already gives a student identity, so students need nothing.

  // Fixtures sign in directly; the forced password change would block the flow.
  await sql(`update public.profiles set password_change_required = false where id = '${user.id}';`);

  return { id: user.id, email, fullName, role, password: TEST_PASSWORD };
}

/**
 * Provisions the requested accounts and returns them plus a `cleanup()`.
 * `cleanup()` is safe to call more than once.
 *
 * CALL `cleanup()` ONLY IN A `finally`, NEVER MID-RUN. It delegates to
 * `cleanupFixtures()`, which deletes EVERY `e2e-fixture%` account -- not just the
 * ones this handle made. A suite that cleans up a secondary handle halfway
 * through also deletes its own student, whose `students` row and registrations
 * cascade away with it. Every later authorisation check then fails for the right
 * reason on the wrong grounds; this cost a day chasing a phantom RLS bug in
 * `resource_events`.
 */
export async function withFixtures({ admin = false, teacher = false, student = false } = {}) {
  const made = [];

  if (admin)
    made.push(
      await createUser({ email: uniqueEmail("admin"), fullName: "E2E Admin", role: "admin" }),
    );
  if (teacher)
    made.push(
      await createUser({ email: uniqueEmail("teacher"), fullName: "E2E Teacher", role: "teacher" }),
    );
  if (student)
    made.push(
      await createUser({ email: uniqueEmail("student"), fullName: "E2E Student", role: "student" }),
    );

  const byRole = Object.fromEntries(made.map((m) => [m.role, m]));

  return {
    ...byRole,
    all: made,
    async cleanup() {
      await cleanupFixtures();
    },
  };
}

/**
 * A teaching group owned by the fixture teacher, with enrolled students.
 *
 * Suites previously relied on the seeded "WS Test" groups and `eleve*` students.
 * Those were demo data; a production database has neither. This builds the same
 * shape on demand: one group meeting on a known weekday, with `studentCount`
 * approved enrolments, so roster/attendance assertions have something to act on.
 *
 * Groups are named with the fixture tag so cleanup can find them, and are
 * removed by `cleanup()` along with the accounts.
 */
export async function createGroupFixture({
  teacherId,
  name = `${TAG} group`,
  weekday = new Date().getDay(),
  studentCount = 3,
  subjectKey = "mathematics",
}) {
  const subject = (await sql(`select id from public.subjects where key = '${subjectKey}';`))[0];
  const level = (
    await sql(`select id from public.levels where name = '3ème année secondaire';`)
  )[0];
  const stream = (
    await sql(`select id from public.streams where code='sciences' and level_id='${level.id}';`)
  )[0];

  // A teacher must be qualified in the subject they are assigned
  // (`validate_teacher_qualification`), so record the qualification first.
  await sql(`
    insert into public.teacher_subjects (teacher_id, subject_id)
    values ('${teacherId}', '${subject.id}') on conflict do nothing;`);

  const group = (
    await sql(`
      insert into public.groups
        (name, subject_id, teacher_id, level_id, stream_id, max_students, price_dzd, status, start_date, end_date)
      values ('${name.replace(/'/g, "''")}', '${subject.id}', '${teacherId}', '${level.id}',
              '${stream.id}', 20, 0, 'active', current_date - 30, current_date + 180)
      returning id;`)
  )[0];

  await sql(`
    insert into public.group_schedules (group_id, weekday, start_time, end_time)
    values ('${group.id}', ${weekday}, '14:00', '16:00');`);

  const students = [];
  for (let i = 0; i < studentCount; i++) {
    const s = await createUser({
      email: uniqueEmail("student"),
      fullName: `E2E Student ${i + 1}`,
      role: "student",
    });
    await sql(`
      insert into public.registrations (student_id, group_id, status, decided_at)
      values ('${s.id}', '${group.id}', 'approved', now());`);
    students.push(s);
  }

  return { id: group.id, name, weekday, students };
}

/**
 * Removes every fixture artefact, including leftovers from an aborted run.
 * Groups go first: `groups.teacher_id` is ON DELETE SET NULL, so deleting the
 * accounts alone would strand the groups in the production database.
 */
export async function cleanupFixtures() {
  // Payments first: `payments.registration_id` is ON DELETE RESTRICT (20260930100100), so a
  // fixture group or account carrying payments would otherwise refuse to go. Only payments
  // hanging off a fixture group or a fixture account are touched.
  await sql(`delete from public.payments p
               using public.registrations r
               join public.groups g on g.id = r.group_id
               join public.profiles pr on pr.id = r.student_id
              where p.registration_id = r.id
                and (g.name like '${TAG}%' or pr.email like '${TAG}-%@example.test');`);
  // Finance documents of fixture students (ADR-006): clients can never delete receipts or
  // invoices; this service-role cleanup removes those it created. Then fixture catalogue discounts.
  await sql(`delete from public.receipts rc using public.profiles pr
              where rc.student_id = pr.id and pr.email like '${TAG}-%@example.test';`);
  await sql(`delete from public.invoices iv using public.profiles pr
              where iv.student_id = pr.id and pr.email like '${TAG}-%@example.test';`);
  // Fees likewise: `charges.registration_id` is ON DELETE RESTRICT (20261006100100). Clients can
  // never delete a charge; this service-role cleanup can, and the installments cascade with it.
  await sql(`delete from public.charges c
               using public.registrations r
               join public.groups g on g.id = r.group_id
               join public.profiles pr on pr.id = r.student_id
              where c.registration_id = r.id
                and (g.name like '${TAG}%' or pr.email like '${TAG}-%@example.test');`);
  // HR files before accounts: employees.profile_id and every HR child are ON DELETE RESTRICT
  // (20261001110100). Only files of fixture accounts are touched. Storage objects go through
  // the Storage API, never by deleting rows of storage.objects.
  const hrFiles = await sql(`select e.id::text id from public.employees e
                               join public.profiles p on p.id = e.profile_id
                              where p.email like '${TAG}-%@example.test';`);
  if (hrFiles.length > 0) {
    const ids = hrFiles.map((r) => `'${r.id}'`).join(",");
    const objects = await sql(
      `select storage_path from public.employee_documents where employee_id in (${ids});`,
    );
    const prefixes = [
      ...objects.map((o) => o.storage_path),
      ...(
        await sql(`select name from storage.objects where bucket_id = 'hr-documents'
                       and split_part(name, '/', 1) in (${ids});`)
      ).map((o) => o.name),
    ];
    if (prefixes.length > 0) {
      await fetch(`${API}/storage/v1/object/hr-documents`, {
        method: "DELETE",
        headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [...new Set(prefixes)] }),
      }).catch(() => {});
    }
    for (const table of [
      "employee_documents",
      "staff_attendance",
      "employee_leaves",
      "employee_availability",
      "employee_contracts",
    ]) {
      await sql(`delete from public.${table} where employee_id in (${ids});`);
    }
    await sql(`delete from public.employees where id in (${ids});`);
  }
  // Payments deleted above voided their receipts; remove those of fixture groups' enrollments.
  await sql(`delete from public.receipts rc using public.registrations r join public.groups g on g.id = r.group_id
              where rc.registration_id = r.id and g.name like '${TAG}%';`);
  await sql(`delete from public.discounts where name like '${TAG}%';`);
  await sql(`delete from public.official_documents od using public.profiles pr
              where od.student_id = pr.id and pr.email like '${TAG}-%@example.test';`);
  await sql(`delete from public.rooms where name like '${TAG}%';`);
  // Communication (ADR-009): conversations, news, campaigns and outbox rows of fixture accounts.
  // Several reference their author with ON DELETE SET NULL, so they would outlive the accounts.
  await sql(`delete from public.conversations c where c.created_by in
               (select id from public.profiles where email like '${TAG}-%@example.test')
             or exists (select 1 from public.conversation_participants cp join public.profiles p on p.id = cp.user_id
                         where cp.conversation_id = c.id and p.email like '${TAG}-%@example.test');`);
  await sql(`delete from public.notifications where kind = 'announcement' and params ->> 'postId' in
               (select id::text from public.news_posts where title like '${TAG}%' or created_by in
                 (select id from public.profiles where email like '${TAG}-%@example.test'));`);
  await sql(`delete from public.news_posts where title like '${TAG}%' or created_by in
               (select id from public.profiles where email like '${TAG}-%@example.test');`);
  await sql(`delete from public.message_campaigns where created_by in
               (select id from public.profiles where email like '${TAG}-%@example.test');`);
  await sql(`delete from public.outbound_messages where recipient_id in
               (select id from public.profiles where email like '${TAG}-%@example.test');`);
  // Pedagogy (ADR-008): lesson entries, assessments, scores and group remarks cascade with the
  // groups below; periods stand alone (their remarks cascade with them).
  await sql(`delete from public.academic_periods where name like '${TAG}%';`);
  await sql(`delete from public.groups where name like '${TAG}%';`);
  // Groups taught by a fixture teacher are test data even when a suite named them like real ones
  // (verify-session-calendar-layout does, to test long names); they would otherwise keep the
  // fixture teacher alive through teacher_subjects.
  await sql(`delete from public.groups where teacher_id in
               (select id from public.profiles where email like '${TAG}-%@example.test');`);
  // After the groups: groups.program_id is ON DELETE RESTRICT (20261001100000).
  await sql(`delete from public.programs where name like '${TAG}%';`);
  const rows = await sql(`select id from auth.users where email like '${TAG}-%@example.test';`);
  for (const r of rows) {
    await fetch(`${API}/auth/v1/admin/users/${r.id}`, { method: "DELETE", headers: H }).catch(
      () => {},
    );
  }
  return rows.length;
}
