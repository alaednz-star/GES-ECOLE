import {
  withFixtures,
  createGroupFixture,
  cleanupFixtures,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY,
  API,
} from "./fixtures.mjs";
/**
 * ADR-002 regression suite.
 * Re-runs the exact attacks that motivated the change, plus the security and
 * provisioning invariants that must not have regressed.
 *
 * THE STACK IS NOT HARD-CODED HERE. It used to be `http://127.0.0.1:54321`, written before
 * this project moved to its own isolated ports; 54321 now belongs to a DIFFERENT project on
 * this machine. The suite was therefore creating its fixtures on one database through
 * `withFixtures` and asserting against another -- which is why four of its checks reported
 * `undefined` (the fixture rows and the access tokens did not exist there), and why the
 * deletability check answered "no dependencies" for a teacher that database had never heard
 * of. Both stacks are forks of the same schema, so the mismatch hid rather than announced
 * itself: twenty checks still passed.
 *
 * `API` now comes from `fixtures.mjs`, which reads it from `.env.local` and refuses any URL
 * that is not loopback -- the same source every other suite uses, so this one cannot drift
 * away from the database it provisions into, or reach a neighbouring project's data again.
 */
const PUB = PUBLISHABLE_KEY;
const SEC = SERVICE_ROLE_KEY;
const SVC = { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "application/json" };

let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};
const sql = async (query) =>
  (
    await fetch(`${API}/pg/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })
  ).json();
const login = async (email, password) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUB, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).access_token;
};
const asUser = (t) => ({
  apikey: PUB,
  Authorization: `Bearer ${t}`,
  "Content-Type": "application/json",
});

(async () => {
  // Disposable identities: the seeded demo accounts no longer exist, and the
  // real ones must never be used as probe targets.
  const fx = await withFixtures({ admin: true, teacher: true, student: true });
  const adminTok = await login(fx.admin.email, fx.admin.password);
  const studentTok = await login(fx.student.email, fx.student.password);
  const TEACHER = fx.teacher.id;
  const STUDENT = fx.student.id;

  console.log("[1] ADR-002: the original bypass is closed");
  let r = await fetch(`${API}/rest/v1/students`, {
    method: "POST",
    headers: asUser(adminTok),
    body: JSON.stringify({ id: TEACHER }),
  });
  check("admin CANNOT insert a teacher into students", !r.ok, `HTTP ${r.status}`);

  r = await fetch(`${API}/rest/v1/teachers`, {
    method: "POST",
    headers: asUser(adminTok),
    body: JSON.stringify({ id: STUDENT }),
  });
  check("admin CANNOT insert a student into teachers", !r.ok, `HTTP ${r.status}`);

  r = await fetch(`${API}/rest/v1/teachers`, {
    method: "POST",
    headers: asUser(studentTok),
    body: JSON.stringify({ id: STUDENT, status: "active" }),
  });
  check("student CANNOT self-insert into teachers (ADR-001 P0-A)", !r.ok, `HTTP ${r.status}`);

  console.log("\n[2] Role separation");
  let q = await sql(
    `select count(*)::int n from public.students s join public.user_roles r on r.user_id=s.id where r.role<>'student';`,
  );
  check("zero contaminated students", q[0]?.n === 0, `${q[0]?.n}`);
  q = await sql(
    `select count(*)::int n from public.teachers t join public.user_roles r on r.user_id=t.id where r.role<>'teacher';`,
  );
  check("zero contaminated teachers", q[0]?.n === 0, `${q[0]?.n}`);
  q = await sql(
    `select count(*)::int n from public.students s join public.user_roles r on r.user_id=s.id where r.role='admin';`,
  );
  check("admin has no student identity", q[0]?.n === 0, `${q[0]?.n}`);

  console.log("\n[3] Students page shows only students");
  r = await fetch(`${API}/rest/v1/students?select=id`, { headers: asUser(adminTok) });
  const rows = await r.json();
  // Assert the INVARIANT, not a fixed count: seeding students for other suites
  // must not break this. Every row returned must belong to a real student.
  const roleCheck = await sql(
    `select count(*)::int n from public.students s join public.user_roles r on r.user_id=s.id where r.role<>'student';`,
  );
  check(
    "students list contains only students",
    Array.isArray(rows) && rows.length > 0 && (roleCheck[0]?.n ?? 0) === 0,
    `rows=${rows?.length} nonStudents=${roleCheck[0]?.n}`,
  );

  console.log("\n[4] Provisioning still works (both roles)");
  const email = `adr2teacher${Date.now()}@example.test`;
  r = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: SVC,
    body: JSON.stringify({
      email,
      password: "TempPass123!",
      email_confirm: true,
      user_metadata: { full_name: "ADR2 Probe" },
      app_metadata: { role: "teacher" },
    }),
  });
  const created = await r.json();
  const tid = created.id;
  check("auth.admin.createUser succeeded", !!tid, JSON.stringify(created).slice(0, 120));

  if (tid) {
    // The trigger CANNOT know the role: GoTrue writes app_metadata in an UPDATE
    // after the INSERT fires (proven with a probe trigger). So it applies least
    // privilege, and provision_staff reconciles. Assert that contract, not a
    // trigger behaviour that is physically impossible.
    q = await sql(`select role::text r from public.user_roles where user_id='${tid}';`);
    check(
      "trigger applies least privilege (student) before reconciliation",
      q[0]?.r === "student",
      `${q[0]?.r}`,
    );

    r = await fetch(`${API}/rest/v1/rpc/provision_staff`, {
      method: "POST",
      headers: SVC,
      body: JSON.stringify({ _target: tid, _role: "teacher", _experience_years: 3, _bio: "probe" }),
    });
    check("provision_staff succeeds", r.ok, `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);

    // After reconciliation the identity must be exactly one row, matching role.
    q = await sql(`select role::text r from public.user_roles where user_id='${tid}';`);
    check("role reconciled to teacher", q[0]?.r === "teacher", `${q[0]?.r}`);
    q = await sql(`select count(*)::int n from public.teachers where id='${tid}';`);
    check("teachers identity created", q[0]?.n === 1, `${q[0]?.n}`);
    q = await sql(`select count(*)::int n from public.students where id='${tid}';`);
    check("stale student identity removed (the original bug)", q[0]?.n === 0, `${q[0]?.n}`);
    q = await sql(`select count(*)::int n from public.user_roles where user_id='${tid}';`);
    check("exactly one role row", q[0]?.n === 1, `${q[0]?.n}`);

    await sql(`delete from auth.users where id='${tid}';`);
  }

  console.log("\n[5] Public signup still creates a student");
  const semail = `adr2student${Date.now()}@example.test`;
  r = await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: PUB, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: semail,
      password: "E2eFixture!2026",
      data: { full_name: "Probe", role: "admin" },
    }),
  });
  const signed = await r.json();
  const sid = signed.id || signed.user?.id;
  check("signup succeeded", !!sid, JSON.stringify(signed).slice(0, 120));
  if (sid) {
    q = await sql(`select role::text r from public.user_roles where user_id='${sid}';`);
    check("forged role:'admin' still ignored -> student", q[0]?.r === "student", `${q[0]?.r}`);
    q = await sql(`select count(*)::int n from public.students where id='${sid}';`);
    check("students row created", q[0]?.n === 1, `${q[0]?.n}`);
    q = await sql(`select count(*)::int n from public.teachers where id='${sid}';`);
    check("no teachers row", q[0]?.n === 0, `${q[0]?.n}`);
    await sql(`delete from auth.users where id='${sid}';`);
  }

  console.log("\n[6] Generic services");
  q = await sql(
    `select severity, row_count from public.entity_dependencies('teacher','${TEACHER}') order by severity;`,
  );
  check(
    "entity_dependencies('teacher') returns rows",
    Array.isArray(q) && q.length >= 4,
    `${q?.length}`,
  );
  q = await sql(`select severity from public.entity_dependencies('student','${STUDENT}');`);
  check(
    "entity_dependencies('student') works (generic)",
    Array.isArray(q) && q.length >= 4,
    `${q?.length}`,
  );
  /*
    AUDIT HISTORY IS PRESERVED, AND NEVER BLOCKS DELETION.

    This check used to read "teacher undeletable (has audit history)" and expected
    `entity_is_deletable` to answer false BECAUSE audit rows existed. That encoded the defect
    corrected by 20260821090000: every provisioned teacher carries an audit entry from its own
    creation, so the rule made permanent deletion unreachable for every teacher that has ever
    existed -- while the confirmation dialog promised, one line above the refusal, that the
    audit trail is kept.

    The rule is now stated by what actually happens to the rows. `audit_log` references
    `profiles` with ON DELETE SET NULL and carries `actor_email`/`target_email` beside the
    pointers, so a deletion nulls the pointer and keeps the record of who was removed: the
    history survives, and therefore has no business standing in the way. Dependencies that
    would genuinely destroy information still block, and are asserted below rather than
    assumed.
  */
  const auditOf = async (id) =>
    (await sql(`select count(*)::int c from public.audit_log where target_id='${id}';`))[0]?.c ?? 0;
  const depsOf = async (id) =>
    await sql(
      `select source_table, row_count, severity from private.entity_dependencies('teacher','${id}');`,
    );
  const blockersOf = (rows) =>
    rows
      .filter((d) => Number(d.row_count) > 0 && ["blocking", "reassignable"].includes(d.severity))
      .map((d) => d.source_table)
      .sort();
  const deletable = async (id) =>
    (await sql(`select private.entity_is_deletable('teacher','${id}')::text d;`))[0]?.d;

  // The premise is asserted, not assumed: a check about audit history is worthless against a
  // teacher that has none, which is exactly how this one passed while pointed at the wrong
  // database.
  check(
    "the fixture teacher does have audit history",
    (await auditOf(TEACHER)) >= 1,
    `${await auditOf(TEACHER)}`,
  );

  const teacherDeps = await depsOf(TEACHER);
  const auditDep = teacherDeps.find((d) => d.source_table === "audit_log");
  check(
    "audit history is classified 'preserved'",
    auditDep?.severity === "preserved",
    auditDep?.severity,
  );
  check(
    "attendance is still classified 'blocking'",
    teacherDeps.find((d) => d.source_table === "attendance")?.severity === "blocking",
  );
  check(
    "student_notes is still classified 'blocking'",
    teacherDeps.find((d) => d.source_table === "student_notes")?.severity === "blocking",
  );
  check(
    "audit history alone does NOT block deletion",
    (await deletable(TEACHER)) === "true",
    `${await deletable(TEACHER)}`,
  );

  /* --- but anything that would destroy information still does --- */
  const fxOwner = await withFixtures({ teacher: true, student: true });
  const owned = await createGroupFixture({ teacherId: fxOwner.teacher.id, studentCount: 1 });
  const enrolled = (
    await sql(`select student_id from public.registrations where group_id='${owned.id}' limit 1;`)
  )[0];

  await sql(`insert into public.attendance (group_id, student_id, session_date, status, marked_by)
             values ('${owned.id}','${enrolled.student_id}', current_date, 'present', '${fxOwner.teacher.id}')
             on conflict do nothing;`);
  await sql(`insert into public.student_notes (student_id, author_id, body)
             values ('${enrolled.student_id}','${fxOwner.teacher.id}','role-integrity probe');`);

  const ownerDeps = await depsOf(fxOwner.teacher.id);
  const ownerBlockers = blockersOf(ownerDeps);
  check(
    "a register the teacher took blocks deletion",
    ownerBlockers.includes("attendance"),
    ownerBlockers.join(", "),
  );
  check(
    "notes the teacher authored block deletion",
    ownerBlockers.includes("student_notes"),
    ownerBlockers.join(", "),
  );
  check(
    "an assigned group blocks deletion",
    ownerBlockers.includes("groups"),
    ownerBlockers.join(", "),
  );
  check(
    "audit history is never among the blockers",
    !ownerBlockers.includes("audit_log"),
    ownerBlockers.join(", "),
  );
  check(
    "so the teacher who has taught is NOT deletable",
    (await deletable(fxOwner.teacher.id)) === "false",
    `${await deletable(fxOwner.teacher.id)}`,
  );

  /* --- and the deletion that is now allowed keeps every audit row --- */
  const fxSpare = await withFixtures({ teacher: true });
  const spare = fxSpare.teacher;
  await sql(`insert into public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
             values ('teacher_created', '${fx.admin.id}', '${fx.admin.email}', '${spare.id}', '${spare.email}', '{}'::jsonb),
                    ('role_granted',    '${spare.id}',    '${spare.email}',    '${fx.admin.id}', '${fx.admin.email}', '{}'::jsonb);`);

  const totalBefore = (await sql(`select count(*)::int c from public.audit_log;`))[0].c;
  check(
    "the spare teacher carries audit history",
    (await auditOf(spare.id)) >= 2,
    `${await auditOf(spare.id)}`,
  );
  check(
    "and is deletable in spite of it",
    (await deletable(spare.id)) === "true",
    `${await deletable(spare.id)}`,
  );

  r = await fetch(`${API}/auth/v1/admin/users/${spare.id}`, { method: "DELETE", headers: SVC });
  check(
    "deleting a teacher whose only records are audit entries succeeds",
    r.ok,
    `HTTP ${r.status}`,
  );
  check(
    "no Auth account is left behind",
    (await sql(`select count(*)::int c from auth.users where id='${spare.id}';`))[0].c === 0,
  );

  // "No historical audit data is deleted" -- asserted on the WHOLE table, so a cascade that
  // removed rows belonging to anybody would show up here, not just rows naming this teacher.
  const totalAfter = (await sql(`select count(*)::int c from public.audit_log;`))[0].c;
  check(
    "not one audit row was removed anywhere in the table",
    totalAfter === totalBefore,
    `${totalBefore} -> ${totalAfter}`,
  );

  // The FK semantics, as they actually are: the pointer is nulled, the email is kept, on both
  // sides of the relationship.
  const asTarget = await sql(
    `select target_id, target_email from public.audit_log where target_email='${spare.email}';`,
  );
  check("rows naming them as the target survive", asTarget.length >= 2, `${asTarget.length}`);
  check(
    "with target_id nulled by the ON DELETE SET NULL",
    asTarget.every((x) => x.target_id === null),
    JSON.stringify(asTarget.map((x) => x.target_id)),
  );
  check(
    "and target_email retained as the record of who was removed",
    asTarget.every((x) => x.target_email === spare.email),
  );

  const asActor = await sql(
    `select actor_id, actor_email from public.audit_log where actor_email='${spare.email}';`,
  );
  check("rows naming them as the actor survive too", asActor.length >= 1, `${asActor.length}`);
  check(
    "with actor_id nulled and actor_email retained",
    asActor.every((x) => x.actor_id === null && x.actor_email === spare.email),
    JSON.stringify(asActor),
  );

  console.log("\n[7] Lifecycle via the generic engine");
  await sql(`select private.entity_lifecycle('teacher','${TEACHER}','suspended','regression');`);
  q = await sql(`select status::text s from public.teachers where id='${TEACHER}';`);
  check("suspend works through entity_lifecycle", q[0]?.s === "suspended", `${q[0]?.s}`);
  await sql(`select private.set_teacher_lifecycle('${TEACHER}','active','restored');`);
  q = await sql(`select status::text s from public.teachers where id='${TEACHER}';`);
  check("teacher wrapper delegates correctly", q[0]?.s === "active", `${q[0]?.s}`);

  console.log("\n[8] RLS unchanged");
  r = await fetch(`${API}/rest/v1/audit_log?select=id`, { headers: asUser(studentTok) });
  const al = await r.json();
  check("student cannot read audit_log", !Array.isArray(al) || al.length === 0, `${al?.length}`);
  r = await fetch(`${API}/rest/v1/profiles?select=email`, { headers: asUser(studentTok) });
  const pr = await r.json();
  check(
    "student sees only their own profile",
    Array.isArray(pr) && pr.length === 1,
    `${pr?.length}`,
  );

  await cleanupFixtures();

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
