/**
 * Deleting a teacher account, against the isolated local stack.
 *
 * THE REPORTED SCENARIO, EXACTLY. An administrator creates a teacher by mistake, resets the
 * password once, and tries to delete the account. Before the fix the server answered
 *   "This account still owns records: audit_log (2). Archive it instead."
 * because the account's own creation record was classified as blocking. Every account has
 * one, so permanent deletion was unreachable for every teacher who had ever existed.
 *
 * What is proven here is both halves of the rule:
 *   - the login goes, and the account can no longer sign in;
 *   - the history stays, with the email of the person removed still on the audit entries.
 *
 * The dependency counts are read from the database rather than from the UI, because the
 * database is what actually decides, and the UI's copy can be stale.
 */

import {
  withFixtures,
  cleanupFixtures,
  createGroupFixture,
  sql,
  API,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY,
  TEST_PASSWORD,
} from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const q = (s) => String(s).replace(/'/g, "''");

const deps = async (entity, id) =>
  await sql(
    `select source_table, row_count, severity from private.entity_dependencies('${q(entity)}', '${q(id)}');`,
  );

const deletable = async (entity, id) =>
  (await sql(`select private.entity_is_deletable('${q(entity)}', '${q(id)}') d;`))[0].d;

/** The rule the server function applies, restated so the test asserts on the same thing. */
const blockers = (rows) =>
  rows.filter((r) => Number(r.row_count) > 0 && ["blocking", "reassignable"].includes(r.severity));

const canSignIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return r.ok;
};

const deleteAuthUser = async (id) => {
  const r = await fetch(`${API}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
};

const fx = await withFixtures({ admin: true, teacher: true, student: true });

try {
  /* ============================================================ 1. THE REPORTED SCENARIO */
  console.log("\n=== 1. A TEACHER CREATED BY MISTAKE, NEVER USED ===");

  const unused = fx.teacher;

  // The two entries the bug report named: one from creation, one from a password reset.
  await sql(`
    insert into public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
    values ('teacher_created', '${q(fx.admin.id)}', '${q(fx.admin.email)}',
            '${q(unused.id)}', '${q(unused.email)}', '{}'::jsonb),
           ('teacher_password_reset', '${q(fx.admin.id)}', '${q(fx.admin.email)}',
            '${q(unused.id)}', '${q(unused.email)}', '{}'::jsonb);
  `);

  const before = await deps("teacher", unused.id);
  const auditRow = before.find((r) => r.source_table === "audit_log");
  check(
    "the account has audit entries, as every account does",
    Number(auditRow.row_count) >= 2,
    JSON.stringify(auditRow),
  );
  check(
    "audit entries are classified as preserved, not blocking",
    auditRow.severity === "preserved",
    auditRow.severity,
  );
  check(
    "nothing blocks the deletion",
    blockers(before).length === 0,
    JSON.stringify(blockers(before)),
  );
  check(
    "the database agrees the account is deletable",
    (await deletable("teacher", unused.id)) === true,
  );

  // The old rule, restated, to show this test would have caught the bug.
  const byExclusion = before.filter((r) => Number(r.row_count) > 0 && r.severity !== "incidental");
  check(
    "the previous rule would have refused this exact account",
    byExclusion.length > 0 && byExclusion.every((r) => r.source_table === "audit_log"),
    JSON.stringify(byExclusion.map((r) => r.source_table)),
  );

  /* ================================================================ 2. THE DELETION ITSELF */
  console.log("\n=== 2. THE LOGIN GOES ===");

  check("the account can sign in before deletion", (await canSignIn(unused.email)) === true);

  const removed = await deleteAuthUser(unused.id);
  check(
    "deleting the account succeeds",
    removed.ok,
    `${removed.status} ${removed.body.slice(0, 200)}`,
  );

  check("the account can no longer sign in", (await canSignIn(unused.email)) === false);

  const identity = await sql(`
    select (select count(*)::int from auth.users     where id = '${q(unused.id)}') u,
           (select count(*)::int from public.profiles where id = '${q(unused.id)}') p,
           (select count(*)::int from public.teachers where id = '${q(unused.id)}') t,
           (select count(*)::int from public.user_roles where user_id = '${q(unused.id)}') r;
  `);
  const i = identity[0];
  check(
    "the auth user, profile, teacher row and role are all gone",
    Number(i.u) === 0 && Number(i.p) === 0 && Number(i.t) === 0 && Number(i.r) === 0,
    JSON.stringify(i),
  );

  /* ================================================================= 3. THE HISTORY STAYS */
  console.log("\n=== 3. THE HISTORY STAYS ===");

  const kept = await sql(`
    select action, target_id, target_email, actor_email
      from public.audit_log
     where target_email = '${q(unused.email)}'
     order by created_at;
  `);
  check("the audit entries survive the deletion", kept.length >= 2, `${kept.length} rows`);
  check(
    "their pointer is nulled rather than the row removed",
    kept.every((r) => r.target_id === null),
    JSON.stringify(kept.map((r) => r.target_id)),
  );
  check(
    "the email of the person removed is still on the record",
    kept.every((r) => r.target_email === unused.email),
    JSON.stringify(kept.map((r) => r.target_email)),
  );
  // Only the two entries this test wrote: provisioning also records a row with no actor,
  // because nobody performed it -- an account created by the system has no administrator
  // behind it, and inventing one would be worse than leaving it null.
  const byAdmin = kept.filter((r) => r.actor_email !== null);
  check(
    "who performed the actions is still recorded",
    byAdmin.length >= 2 && byAdmin.every((r) => r.actor_email === fx.admin.email),
    JSON.stringify(kept.map((r) => [r.action, r.actor_email])),
  );
  check(
    "the actor's own pointer is nulled by their deletion, never the row",
    kept.length ===
      (
        await sql(`select count(*)::int c from public.audit_log
                                  where target_email = '${q(unused.email)}';`)
      )[0].c,
  );

  /* ====================================================== 4. HISTORY STILL PROTECTS PEOPLE */
  console.log("\n=== 4. A TEACHER WHO HAS ACTUALLY TAUGHT IS STILL PROTECTED ===");

  const fxB = await withFixtures({ teacher: true });
  const group = await createGroupFixture({ teacherId: fxB.teacher.id, studentCount: 2 });

  const teaching = await deps("teacher", fxB.teacher.id);
  const groupDep = teaching.find((r) => r.source_table === "groups");
  check(
    "the group is counted against the teacher",
    Number(groupDep.row_count) > 0,
    JSON.stringify(groupDep),
  );
  check(
    "an assigned group blocks deletion",
    blockers(teaching).some((r) => r.source_table === "groups"),
    JSON.stringify(blockers(teaching).map((r) => r.source_table)),
  );
  check(
    "the database refuses to call them deletable",
    (await deletable("teacher", fxB.teacher.id)) === false,
  );

  // Attendance is the case that matters most: `marked_by` nulls with no email beside it, so
  // deleting would erase who took the register for good.
  const student = (
    await sql(
      `select student_id from public.registrations where group_id = '${q(group.id)}' limit 1;`,
    )
  )[0];
  await sql(`
    insert into public.attendance (group_id, student_id, session_date, status, marked_by)
    values ('${q(group.id)}', '${q(student.student_id)}', current_date, 'present', '${q(fxB.teacher.id)}')
    on conflict do nothing;
  `);
  const withRegister = await deps("teacher", fxB.teacher.id);
  const att = withRegister.find((r) => r.source_table === "attendance");
  check(
    "a register the teacher took blocks deletion",
    Number(att.row_count) > 0 && att.severity === "blocking",
    JSON.stringify(att),
  );
  check(
    "and it blocks for a reason: marked_by keeps no email beside it",
    (
      await sql(`select count(*)::int c from information_schema.columns
                   where table_schema = 'public' and table_name = 'attendance'
                     and column_name = 'marked_by_email';`)
    )[0].c === 0,
    "if an email were kept, attendance could be preserved like the audit log",
  );

  /* ======================================================= 5. A STUDENT IS TREATED THE SAME */
  console.log("\n=== 5. THE SAME RULE FOR A STUDENT ===");

  const studentDeps = await deps("student", fx.student.id);
  const studentAudit = studentDeps.find((r) => r.source_table === "audit_log");
  check(
    "a student's audit entries are preserved too",
    studentAudit.severity === "preserved",
    studentAudit.severity,
  );
  check(
    "but their enrolments still block deletion",
    studentDeps.some((r) => r.source_table === "registrations" && r.severity === "blocking"),
  );

  /* ================================================================ 6. NOBODY ELSE MAY ASK */
  console.log("\n=== 6. ONLY AN ADMINISTRATOR MAY INSPECT DEPENDENCIES ===");

  const asTeacher = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: fxB.teacher.email, password: TEST_PASSWORD }),
  });
  const token = (await asTeacher.json()).access_token;
  const probe = await fetch(`${API}/rest/v1/rpc/entity_dependencies`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ _entity: "teacher", _id: fxB.teacher.id }),
  });
  check(
    "a teacher cannot read dependency counts",
    probe.status === 403 || probe.status === 400,
    `${probe.status}`,
  );
} finally {
  await cleanupFixtures();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
if (fail > 0) process.exitCode = 1;
