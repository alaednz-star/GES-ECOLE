/**
 * Enrollment lifecycle and administration placement (ADR-004 section 4, 20261004100000/100100),
 * asked over the API with real user tokens against the LOCAL stack.
 *
 * What must hold:
 *   - an administrator places a student directly (approved), and the student is notified
 *   - at most ONE active registration per (student, group) -- duplicates and races refused
 *   - capacity holds under concurrent approvals (the group row is locked)
 *   - a rejected student can request again; a withdrawn student can come back
 *   - withdrawal keeps the row, its payments and the attendance; it frees the seat, ends access,
 *     is stamped (when, by whom) and is terminal
 *   - students, teachers and visitors cannot place, approve or withdraw
 *   - bounded reads: the group-scoped list and the student search return exact, capped results
 *
 * RUN ALONE -- fixture cleanup is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-enrollment-lifecycle.mjs
 */
import {
  sql,
  API,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY,
  TEST_PASSWORD,
  withFixtures,
  createGroupFixture,
  cleanupFixtures,
} from "./fixtures.mjs";

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};
const TAG = "e2e-fixture";
const one = async (q) => (await sql(q))[0];

const signIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`signIn ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
};

const rest = async (tok, path, init = {}) => {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body, text, headers: res.headers };
};
const post = (tok, table, row) => rest(tok, table, { method: "POST", body: JSON.stringify(row) });
const patch = (tok, path, fields) =>
  rest(tok, path, { method: "PATCH", body: JSON.stringify(fields) });

/** An extra student account (the fixture handle makes only one), tagged for cleanup. */
async function makeStudent(label) {
  const email = `${TAG}-student-${label}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}@example.test`;
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `E2E Lifecycle ${label}`, [TAG]: true },
      app_metadata: { role: "student", [TAG]: true },
    }),
  });
  const u = await res.json();
  if (!u.id) throw new Error(`makeStudent ${label}: ${JSON.stringify(u)}`);
  return { id: u.id, email };
}

/** Gives a student the academic identity the group requires, and completes onboarding. */
async function place(studentId, groupId) {
  const g = await one(`select level_id, stream_id from public.groups where id = '${groupId}';`);
  await sql(`update public.students set level_id = '${g.level_id}',
               stream_id = ${g.stream_id ? `'${g.stream_id}'` : "null"}, gender = 'female',
               date_of_birth = '2008-03-14', guardian_name = 'Parent E2E',
               guardian_phone = '0550000000', onboarded_at = now()
             where id = '${studentId}';`);
}

const fx = await withFixtures({ admin: true, teacher: true, student: true });

try {
  const admin = await signIn(fx.admin.email);
  const teacher = await signIn(fx.teacher.email);
  const studentA = { id: fx.student.id, email: fx.student.email };
  const studentB = await makeStudent("b");
  const studentC = await makeStudent("c");
  const studentD = await makeStudent("d");

  // Main group (capacity 3) meets TODAY in the database's own calendar, so attendance can be
  // recorded for current_date whatever the local timezone.
  const group = await createGroupFixture({ teacherId: fx.teacher.id, studentCount: 0 });
  await sql(`update public.groups set max_students = 3 where id = '${group.id}';
             update public.group_schedules set weekday = extract(dow from current_date)::int
              where group_id = '${group.id}';`);
  for (const s of [studentA, studentB, studentC, studentD]) await place(s.id, group.id);
  const tokA = await signIn(studentA.email);
  const tokB = await signIn(studentB.email);

  const active = async (studentId, groupId = group.id) =>
    (
      await one(`select count(*)::int c from public.registrations
                  where student_id = '${studentId}' and group_id = '${groupId}'
                    and status in ('pending', 'approved');`)
    ).c;
  const enrolledCount = async (groupId = group.id) =>
    (
      await one(`select enrolled_count from public.group_enrollment_counts
                  where group_id = '${groupId}';`)
    ).enrolled_count;

  /* ------------------------------------------------------------------ 1. admin placement */
  console.log("\n--- an administrator places a student directly ---");
  const placed = await post(admin, "registrations", {
    student_id: studentB.id,
    group_id: group.id,
    status: "approved",
    decided_at: new Date().toISOString(),
  });
  rec(
    "an administrator can enroll an existing student (approved at once)",
    placed.status === 201 && placed.body?.[0]?.status === "approved",
    `HTTP ${placed.status} ${placed.text.slice(0, 120)}`,
  );
  const regB = placed.body?.[0]?.id;
  const notified = await one(`select count(*)::int c from public.notifications
                               where user_id = '${studentB.id}' and kind = 'registration_approved';`);
  rec("the student is notified of the placement", notified.c === 1, `${notified.c}`);

  /* ------------------------------------------------------------------ 2. one active per group */
  console.log("\n--- at most one active registration per student and group ---");
  const dupAdmin = await post(admin, "registrations", {
    student_id: studentB.id,
    group_id: group.id,
    status: "approved",
  });
  rec(
    "a second active registration in the same group is refused (23505), one row stays active",
    // Refused by the subject rule (fires first) or by registrations_one_active_per_group.
    !dupAdmin.ok && dupAdmin.body?.code === "23505" && (await active(studentB.id)) === 1,
    `HTTP ${dupAdmin.status} ${dupAdmin.text.slice(0, 140)}`,
  );
  const dupSelf = await post(tokB, "registrations", {
    student_id: studentB.id,
    group_id: group.id,
  });
  rec(
    "an enrolled student cannot also send a request for the same group",
    !dupSelf.ok && (await active(studentB.id)) === 1,
    `HTTP ${dupSelf.status}`,
  );

  // Two simultaneous placements of the same student: exactly one can win.
  const racers = await Promise.all(
    [1, 2].map(() =>
      post(admin, "registrations", {
        student_id: studentC.id,
        group_id: group.id,
        status: "approved",
      }),
    ),
  );
  rec(
    "two simultaneous placements of one student: exactly one succeeds",
    racers.filter((r) => r.ok).length === 1 && (await active(studentC.id)) === 1,
    racers.map((r) => r.status).join(","),
  );

  /* ------------------------------------------------------------------ 3. capacity */
  console.log("\n--- capacity holds, also under concurrent approvals ---");
  // 2 of 3 seats taken (B, C). A and D race for the last one.
  const lastSeat = await Promise.all(
    [studentA, studentD].map((s) =>
      post(admin, "registrations", { student_id: s.id, group_id: group.id, status: "approved" }),
    ),
  );
  const winners = lastSeat.filter((r) => r.ok).length;
  const loser = lastSeat.find((r) => !r.ok);
  rec(
    "two approvals racing for the last seat: one wins, the other is refused as full",
    winners === 1 && loser?.body?.code === "23514" && /is full/.test(loser?.text ?? ""),
    lastSeat.map((r) => `${r.status} ${r.body?.code ?? ""}`).join(" | "),
  );
  rec("the group is exactly full", (await enrolledCount()) === 3, `${await enrolledCount()}`);
  const winner = lastSeat[0]?.ok ? studentA : studentD;
  const waiting = winner === studentA ? studentD : studentA;
  const pendingWhileFull = await post(
    waiting === studentA ? tokA : await signIn(studentD.email),
    "registrations",
    { student_id: waiting.id, group_id: group.id },
  );
  rec(
    "a pending request does not consume a seat (accepted while the group is full)",
    pendingWhileFull.status === 201 && (await enrolledCount()) === 3,
    `HTTP ${pendingWhileFull.status}`,
  );

  /* ------------------------------------------------------------------ 4. withdrawal */
  console.log("\n--- withdrawal keeps history, frees the seat, ends access ---");
  await sql(`insert into public.attendance (group_id, student_id, session_date, status, marked_by)
             values ('${group.id}', '${studentB.id}', current_date, 'present', '${fx.admin.id}');`);
  const pay = await post(admin, "payments", {
    registration_id: regB,
    amount_dzd: 2500,
    method: "cash",
    recorded_by: fx.admin.id,
  });
  rec(
    "a payment is recorded on the place",
    pay.status === 201,
    `HTTP ${pay.status} ${pay.text.slice(0, 100)}`,
  );
  const teacherSeesBefore = await rest(teacher, `students?id=eq.${studentB.id}&select=id`);

  const withdrawn = await patch(admin, `registrations?id=eq.${regB}`, {
    status: "withdrawn",
    withdrawal_reason: "Départ en cours d'année",
  });
  const wRow = await one(`select status, withdrawn_at is not null stamped, withdrawn_by,
                                 withdrawal_reason from public.registrations where id = '${regB}';`);
  rec(
    "an administrator withdraws the student: status, date and author are recorded",
    withdrawn.ok &&
      wRow.status === "withdrawn" &&
      wRow.stamped === true &&
      wRow.withdrawn_by === fx.admin.id &&
      wRow.withdrawal_reason === "Départ en cours d'année",
    `HTTP ${withdrawn.status} ${JSON.stringify(wRow)}`,
  );
  const kept = await one(
    `select (select count(*)::int from public.payments where registration_id = '${regB}') p,
            (select count(*)::int from public.attendance where group_id = '${group.id}'
                                                         and student_id = '${studentB.id}') a;`,
  );
  rec("its payment and attendance are kept", kept.p === 1 && kept.a === 1, JSON.stringify(kept));
  rec("its seat is freed", (await enrolledCount()) === 2, `${await enrolledCount()}`);
  const teacherSeesAfter = await rest(teacher, `students?id=eq.${studentB.id}&select=id`);
  rec(
    "access through the place ends (the teacher no longer reads the student)",
    teacherSeesBefore.body?.length === 1 && teacherSeesAfter.body?.length === 0,
    `${teacherSeesBefore.body?.length} -> ${teacherSeesAfter.body?.length}`,
  );
  const payOnWithdrawn = await post(admin, "payments", {
    registration_id: regB,
    amount_dzd: 1000,
    recorded_by: fx.admin.id,
  });
  rec(
    "no new payment can be recorded against a withdrawn place",
    !payOnWithdrawn.ok,
    `HTTP ${payOnWithdrawn.status}`,
  );
  const delGroup = await rest(admin, `groups?id=eq.${group.id}`, { method: "DELETE" });
  rec(
    "a group whose withdrawn place carries payments still cannot be deleted (23503)",
    !delGroup.ok && delGroup.body?.code === "23503",
    `HTTP ${delGroup.status} ${delGroup.body?.code}`,
  );

  /* ------------------------------------------------------------------ 5. terminal */
  console.log("\n--- a withdrawal is closed; coming back is a new registration ---");
  const reopen = await patch(admin, `registrations?id=eq.${regB}`, { status: "approved" });
  rec(
    "a withdrawn registration cannot be reopened (23514)",
    !reopen.ok && reopen.body?.code === "23514",
    `HTTP ${reopen.status} ${reopen.text.slice(0, 100)}`,
  );
  const before = await one(
    `select withdrawn_at::text w from public.registrations where id = '${regB}';`,
  );
  await patch(admin, `registrations?id=eq.${regB}`, { withdrawn_at: "2020-01-01T00:00:00Z" });
  const after = await one(
    `select withdrawn_at::text w from public.registrations where id = '${regB}';`,
  );
  rec(
    "the withdrawal date cannot be rewritten afterwards",
    before.w === after.w,
    `${before.w} / ${after.w}`,
  );
  const back = await post(admin, "registrations", {
    student_id: studentB.id,
    group_id: group.id,
    status: "approved",
  });
  const rowsB = await one(`select count(*)::int c from public.registrations
                            where student_id = '${studentB.id}' and group_id = '${group.id}';`);
  rec(
    "the withdrawn student can be enrolled again (new row; the old one stays)",
    back.status === 201 && rowsB.c === 2,
    `HTTP ${back.status} rows=${rowsB.c} ${back.text.slice(0, 100)}`,
  );
  const fromPending = await patch(admin, `registrations?id=eq.${pendingWhileFull.body?.[0]?.id}`, {
    status: "withdrawn",
  });
  rec(
    "only an active place can be withdrawn (a pending request cannot)",
    !fromPending.ok && fromPending.body?.code === "23514",
    `HTTP ${fromPending.status}`,
  );
  const insertWithdrawn = await post(admin, "registrations", {
    student_id: studentA.id === winner.id ? studentD.id : studentA.id,
    group_id: group.id,
    status: "withdrawn",
  });
  rec(
    "a registration cannot start withdrawn",
    !insertWithdrawn.ok,
    `HTTP ${insertWithdrawn.status}`,
  );

  /* ------------------------------------------------------------------ 6. rejected -> again */
  console.log("\n--- a refused request can be sent again ---");
  const group2 = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: `${TAG} lifecycle physique`,
    studentCount: 0,
    subjectKey: "physics",
  });
  const req1 = await post(tokA, "registrations", { student_id: studentA.id, group_id: group2.id });
  await patch(admin, `registrations?id=eq.${req1.body?.[0]?.id}`, {
    status: "rejected",
    decided_at: new Date().toISOString(),
    note: "Groupe réservé",
  });
  const req2 = await post(tokA, "registrations", { student_id: studentA.id, group_id: group2.id });
  const hist = await sql(`select status from public.registrations
                           where student_id = '${studentA.id}' and group_id = '${group2.id}'
                           order by created_at;`);
  rec(
    "after a refusal the student can request the same group again (history kept)",
    req2.status === 201 &&
      req2.body?.[0]?.status === "pending" &&
      hist.map((h) => h.status).join(",") === "rejected,pending",
    `HTTP ${req2.status} ${hist.map((h) => h.status).join(",")}`,
  );
  // The withdrawn student can also ask again by themselves (after being withdrawn from group).
  const regBack = back.body?.[0]?.id;
  await patch(admin, `registrations?id=eq.${regBack}`, { status: "withdrawn" });
  const selfBack = await post(tokB, "registrations", {
    student_id: studentB.id,
    group_id: group.id,
  });
  rec(
    "a withdrawn student can request a place again by themselves (pending)",
    selfBack.status === 201 && selfBack.body?.[0]?.status === "pending",
    `HTTP ${selfBack.status} ${selfBack.text.slice(0, 100)}`,
  );

  /* ------------------------------------------------------------------ 7. authorisation */
  console.log("\n--- only the administration places, approves and withdraws ---");
  const selfApprove = await patch(tokB, `registrations?id=eq.${selfBack.body?.[0]?.id}`, {
    status: "approved",
  });
  const stillPending = await one(
    `select status from public.registrations where id = '${selfBack.body?.[0]?.id}';`,
  );
  rec(
    "a student cannot approve their own request",
    stillPending.status === "pending",
    `HTTP ${selfApprove.status} ${stillPending.status}`,
  );
  const winnerTok = await signIn(winner.email);
  const winnerReg = await one(`select id from public.registrations
                                where student_id = '${winner.id}' and group_id = '${group.id}'
                                  and status = 'approved';`);
  const selfWithdraw = await patch(winnerTok, `registrations?id=eq.${winnerReg.id}`, {
    status: "withdrawn",
  });
  const winnerStill = await one(
    `select status from public.registrations where id = '${winnerReg.id}';`,
  );
  rec(
    "a student cannot withdraw (or otherwise change) their own place",
    winnerStill.status === "approved",
    `HTTP ${selfWithdraw.status} ${winnerStill.status}`,
  );
  const selfForged = await post(tokA, "registrations", {
    student_id: studentA.id,
    group_id: group2.id,
    status: "approved",
  });
  rec(
    "a student still cannot create an approved registration (SEC-01)",
    !selfForged.ok,
    `HTTP ${selfForged.status}`,
  );
  const teacherPlace = await post(teacher, "registrations", {
    student_id: studentC.id,
    group_id: group2.id,
    status: "approved",
  });
  const teacherWithdraw = await patch(teacher, `registrations?id=eq.${winnerReg.id}`, {
    status: "withdrawn",
  });
  const winnerAfterTeacher = await one(
    `select status from public.registrations where id = '${winnerReg.id}';`,
  );
  rec(
    "a teacher cannot place a student, nor withdraw one, even in their own group",
    !teacherPlace.ok && winnerAfterTeacher.status === "approved",
    `place HTTP ${teacherPlace.status}, withdraw HTTP ${teacherWithdraw.status}`,
  );
  const anon = await post(null, "registrations", {
    student_id: studentC.id,
    group_id: group2.id,
    status: "approved",
  });
  rec("an anonymous visitor cannot place anyone", !anon.ok, `HTTP ${anon.status}`);

  /* ------------------------------------------------------------------ 8. bounded reads */
  console.log("\n--- bounded reads ---");
  const scoped = await rest(admin, `registrations?group_id=eq.${group.id}&select=id&limit=2`, {
    headers: { Prefer: "count=exact" },
  });
  const total = (
    await one(`select count(*)::int c from public.registrations where group_id = '${group.id}';`)
  ).c;
  const range = scoped.headers.get("content-range") ?? "";
  rec(
    "the group-scoped list reports the exact total even when capped",
    scoped.ok && scoped.body.length === 2 && range.endsWith(`/${total}`),
    `range=${range} total=${total}`,
  );
  const search = await rest(
    admin,
    `profiles?select=id,full_name,students!inner(status)&or=(full_name.ilike.*Lifecycle*)&limit=20`,
  );
  rec(
    "the student search finds students by name, capped, students only",
    search.ok && search.body.length === 3 && search.body.length <= 20,
    `HTTP ${search.status} n=${search.body?.length}`,
  );
  const teacherSearch = await rest(
    teacher,
    `profiles?select=id,students!inner(status)&or=(full_name.ilike.*Lifecycle*)&limit=20`,
  );
  rec(
    "a teacher's search only reaches students they teach (RLS)",
    teacherSearch.ok && teacherSearch.body.every((p) => [winner.id, studentC.id].includes(p.id)),
    JSON.stringify(teacherSearch.body?.map((p) => p.id)),
  );
} finally {
  await cleanupFixtures();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
