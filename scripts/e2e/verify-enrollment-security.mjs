/**
 * Enrolment authorisation, asked over the API with real user tokens.
 *
 * The redesigned catalogue at `/dashboard/registration` added two things a student can
 * now do from the UI -- send a request, and withdraw one that has not been decided. Both
 * go through PostgREST with the student's own JWT, so the only thing standing between a
 * curious student and someone else's enrolment is RLS. This suite asks the database
 * directly, because a UI test can only prove that the button is hidden.
 *
 * What must hold:
 *   - a student may enrol only THEMSELVES
 *   - a student may not touch anyone else's request, in any way
 *   - a student may not approve their own request (only an admin decides)
 *   - ...not even by CREATING it already decided: a student's insert is a pending request,
 *     with no decision date and no decision note (SEC-01, 20261003100000)
 *   - the one-active-enrolment-per-(subject, level) rule holds server-side
 *   - capacity is enforced at approval, which is when a seat is actually taken
 *   - a student may withdraw their OWN request, and only their own
 *   - ...and only while it is PENDING: approved and rejected rows are not theirs to delete
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-enrollment-security.mjs
 */
import {
  sql,
  API,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY,
  TEST_PASSWORD,
  withFixtures,
} from "./fixtures.mjs";

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};

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

/** PostgREST as a real signed-in user -- never the service role. */
const rest = async (tok, path, init = {}) => {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${tok}`,
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
  return { status: res.status, ok: res.ok, body, text };
};

const TAG = "e2e-fixture";

/**
 * A group the fixture students are eligible for, with no enrolments of its own.
 *
 * `createGroupFixture` enrols students as a side effect, which is wrong here: the point
 * is to observe what happens when a student tries to enrol. So the group is built
 * directly, in the level and stream the fixture students are given below.
 */
const makeGroup = async ({ teacherId, name, subjectKey, capacity = 20, status = "active" }) => {
  const subject = (await sql(`select id from public.subjects where key = '${subjectKey}';`))[0];
  if (!subject) throw new Error(`no subject with key '${subjectKey}' -- check the seed`);
  const level = (
    await sql(`select id from public.levels where name = '3ème année secondaire';`)
  )[0];
  const stream = (
    await sql(`select id from public.streams where code='sciences' and level_id='${level.id}';`)
  )[0];
  await sql(`insert into public.teacher_subjects (teacher_id, subject_id)
             values ('${teacherId}', '${subject.id}') on conflict do nothing;`);
  const g = (
    await sql(`
      insert into public.groups
        (name, subject_id, teacher_id, level_id, stream_id, max_students, price_dzd, status,
         start_date, end_date)
      values ('${name}', '${subject.id}', '${teacherId}', '${level.id}', '${stream.id}',
              ${capacity}, 3000, '${status}', current_date - 30, current_date + 180)
      returning id;`)
  )[0];
  await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time)
             values ('${g.id}', 1, '14:00', '16:00');`);
  return { id: g.id, subjectId: subject.id, levelId: level.id, streamId: stream.id };
};

/** Gives a fixture student the academic identity `can_join_group` reads. */
const enrolAcademics = async (studentId, levelId, streamId) => {
  await sql(`update public.students
                set level_id = '${levelId}', stream_id = '${streamId}'
              where id = '${studentId}';`);
};

const fx = await withFixtures({ teacher: true, student: true, admin: true });

try {
  // A SECOND student, so "someone else's request" is a real row and not a hypothetical.
  // `withFixtures` makes one student per call and its cleanup is global, so calling it
  // twice would be the mid-run cleanup footgun documented in fixtures.mjs. Created here
  // through the same admin path instead, with the same tag so cleanup still finds it.
  const second = await (async () => {
    const email = `${TAG}-student-second-${Date.now().toString(36)}@example.test`;
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
        user_metadata: { full_name: "E2E Student Two", [TAG]: true },
        app_metadata: { role: "student", [TAG]: true },
      }),
    });
    if (!res.ok) throw new Error(`second student: ${res.status} ${await res.text()}`);
    const u = await res.json();
    await sql(`update public.profiles set password_change_required = false where id = '${u.id}';`);
    return { id: u.id, email };
  })();

  const maths = await makeGroup({
    teacherId: fx.teacher.id,
    name: `${TAG} sec Maths`,
    subjectKey: "mathematics",
  });
  await enrolAcademics(fx.student.id, maths.levelId, maths.streamId);
  await enrolAcademics(second.id, maths.levelId, maths.streamId);

  const studentTok = await signIn(fx.student.email);
  const secondTok = await signIn(second.email);
  const adminTok = await signIn(fx.admin.email);

  // ------------------------------------------------------------------ 0. no decided inserts
  console.log("\n--- a student cannot create a request that is already decided ---");
  // Until 20261003100000 the insert policy checked who the row was for but not what it said,
  // so `status: "approved"` in the POST body was stored as an approved place (HTTP 201). Each
  // forged shape is tried BEFORE the student's real request, so the unique (student, group)
  // pair cannot be what refuses it.
  const forgedShapes = [
    ["status approved", { status: "approved" }],
    ["status rejected", { status: "rejected" }],
    ["a decision date", { decided_at: new Date().toISOString() }],
    ["a decision note", { note: "approved by myself" }],
  ];
  for (const [label, extra] of forgedShapes) {
    const forged = await rest(studentTok, "registrations", {
      method: "POST",
      body: JSON.stringify({ student_id: fx.student.id, group_id: maths.id, ...extra }),
    });
    const stored = await sql(
      `select count(*)::int c from public.registrations
        where student_id = '${fx.student.id}' and group_id = '${maths.id}';`,
    );
    rec(
      `a student CANNOT create their request with ${label}`,
      !forged.ok && stored[0].c === 0,
      `HTTP ${forged.status} rows=${stored[0].c} ${forged.text.slice(0, 80)}`,
    );
  }

  // ------------------------------------------------------------------ 1. enrol self
  console.log("\n--- a student enrols themselves ---");
  const own = await rest(studentTok, "registrations", {
    method: "POST",
    body: JSON.stringify({ student_id: fx.student.id, group_id: maths.id }),
  });
  rec(
    "a student can send their own request",
    own.ok,
    `HTTP ${own.status} ${own.text.slice(0, 120)}`,
  );
  const ownId = Array.isArray(own.body) ? own.body[0]?.id : null;
  rec(
    "it lands as pending, not approved",
    Array.isArray(own.body) && own.body[0]?.status === "pending",
    String(Array.isArray(own.body) && own.body[0]?.status),
  );

  // ------------------------------------------------------------------ 2. enrol others
  console.log("\n--- and nobody else ---");
  const impersonate = await rest(studentTok, "registrations", {
    method: "POST",
    body: JSON.stringify({ student_id: second.id, group_id: maths.id }),
  });
  rec(
    "a student CANNOT enrol another student",
    !impersonate.ok,
    `HTTP ${impersonate.status} ${impersonate.text.slice(0, 100)}`,
  );
  const forged = await sql(
    `select count(*)::int c from public.registrations where student_id = '${second.id}';`,
  );
  rec("no row was created for the other student", forged[0].c === 0, `${forged[0].c}`);

  // ------------------------------------------------------------------ 3. approve self
  console.log("\n--- a student cannot decide their own request ---");
  const selfApprove = await rest(studentTok, `registrations?id=eq.${ownId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "approved", decided_at: new Date().toISOString() }),
  });
  const afterSelfApprove = await sql(
    `select status from public.registrations where id = '${ownId}';`,
  );
  rec(
    "a student CANNOT approve their own request",
    afterSelfApprove[0]?.status === "pending",
    `status=${afterSelfApprove[0]?.status} HTTP ${selfApprove.status}`,
  );

  // A silent no-op is the RLS-correct outcome for UPDATE: the row is invisible to the
  // write, so PostgREST reports success on zero rows. What matters is the stored status.
  rec(
    "the update touched zero rows",
    !Array.isArray(selfApprove.body) || selfApprove.body.length === 0,
    JSON.stringify(selfApprove.body).slice(0, 80),
  );

  // ------------------------------------------------------------------ 4. others' rows
  console.log("\n--- one student cannot see or alter another's request ---");
  const peek = await rest(secondTok, `registrations?id=eq.${ownId}&select=id,status`);
  rec(
    "another student cannot even read the request",
    Array.isArray(peek.body) && peek.body.length === 0,
    JSON.stringify(peek.body).slice(0, 80),
  );

  const tamper = await rest(secondTok, `registrations?id=eq.${ownId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "rejected", note: "hijacked" }),
  });
  const afterTamper = await sql(
    `select status, note from public.registrations where id = '${ownId}';`,
  );
  rec(
    "another student CANNOT alter it",
    afterTamper[0]?.status === "pending" && afterTamper[0]?.note === null,
    `status=${afterTamper[0]?.status} note=${afterTamper[0]?.note} HTTP ${tamper.status}`,
  );

  const foreignDelete = await rest(secondTok, `registrations?id=eq.${ownId}`, { method: "DELETE" });
  const survived = await sql(
    `select count(*)::int c from public.registrations where id = '${ownId}';`,
  );
  rec(
    "another student CANNOT delete it",
    survived[0].c === 1,
    `rows=${survived[0].c} HTTP ${foreignDelete.status}`,
  );

  // ------------------------------------------------------------------ 5. subject+level
  console.log("\n--- one active enrolment per subject and level ---");
  const mathsTwo = await makeGroup({
    teacherId: fx.teacher.id,
    name: `${TAG} sec Maths bis`,
    subjectKey: "mathematics",
  });
  const dupe = await rest(studentTok, "registrations", {
    method: "POST",
    body: JSON.stringify({ student_id: fx.student.id, group_id: mathsTwo.id }),
  });
  rec(
    "a second maths group at the same level is refused",
    !dupe.ok,
    `HTTP ${dupe.status} ${dupe.text.slice(0, 140)}`,
  );
  rec(
    "and the refusal is a readable sentence, not a constraint name",
    /déjà|already|inscrit/i.test(dupe.text),
    dupe.text.slice(0, 140),
  );

  // A DIFFERENT subject at the same level must still be allowed -- the rule is per
  // subject, and blocking everything would be just as wrong as blocking nothing.
  const physics = await makeGroup({
    teacherId: fx.teacher.id,
    name: `${TAG} sec Physique`,
    subjectKey: "physics",
  });
  const otherSubject = await rest(studentTok, "registrations", {
    method: "POST",
    body: JSON.stringify({ student_id: fx.student.id, group_id: physics.id }),
  });
  rec(
    "a different subject at the same level is still allowed",
    otherSubject.ok,
    `HTTP ${otherSubject.status} ${otherSubject.text.slice(0, 120)}`,
  );
  const physicsId = Array.isArray(otherSubject.body) ? otherSubject.body[0]?.id : null;

  // ------------------------------------------------------------------ 6. eligibility
  console.log("\n--- eligibility and capacity are server rules ---");
  const otherLevel = (
    await sql(`select id from public.levels where name <> '3ème année secondaire' limit 1;`)
  )[0];
  const wrongLevel = (
    await sql(`
      insert into public.groups
        (name, subject_id, teacher_id, level_id, max_students, price_dzd, status,
         start_date, end_date)
      values ('${TAG} sec WrongLevel', '${physics.subjectId}', '${fx.teacher.id}',
              '${otherLevel.id}', 20, 3000, 'active', current_date - 30, current_date + 180)
      returning id;`)
  )[0];
  const wrong = await rest(studentTok, "registrations", {
    method: "POST",
    body: JSON.stringify({ student_id: fx.student.id, group_id: wrongLevel.id }),
  });
  rec(
    "a student cannot enrol into another level's group",
    !wrong.ok,
    `HTTP ${wrong.status} ${wrong.text.slice(0, 100)}`,
  );
  const wrongVisible = await rest(studentTok, `groups?id=eq.${wrongLevel.id}&select=id`);
  rec(
    "nor even read it",
    Array.isArray(wrongVisible.body) && wrongVisible.body.length === 0,
    JSON.stringify(wrongVisible.body).slice(0, 60),
  );

  // Capacity: a group with one seat, already taken.
  const tiny = await makeGroup({
    teacherId: fx.teacher.id,
    name: `${TAG} sec Tiny`,
    subjectKey: "natural_sciences",
    capacity: 1,
  });
  await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
             values ('${second.id}', '${tiny.id}', 'approved', now());`);
  const full = await rest(studentTok, "registrations", {
    method: "POST",
    body: JSON.stringify({ student_id: fx.student.id, group_id: tiny.id }),
  });
  // `enforce_group_capacity` states the rule in its first line: "Only approved
  // registrations consume a seat; pending ones are requests." So ASKING for a seat in a
  // full group is allowed by design -- the seat rule bites when someone decides.
  // (The catalogue UI still offers no button in that state: there is no waitlist table,
  // so queueing a student behind a full class would promise something the schema cannot
  // deliver. A narrower UI than the database permits is a product choice, not a hole.)
  rec(
    "a request for a full group is accepted -- a request is not a seat",
    full.ok,
    `HTTP ${full.status} ${full.text.slice(0, 140)}`,
  );
  const fullId = Array.isArray(full.body) ? full.body[0]?.id : null;

  const approveIntoFull = await rest(adminTok, `registrations?id=eq.${fullId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "approved", decided_at: new Date().toISOString() }),
  });
  const fullStatus = await sql(`select status from public.registrations where id = '${fullId}';`);
  rec(
    "but it CANNOT be approved past capacity, not even by an admin",
    !approveIntoFull.ok && fullStatus[0]?.status === "pending",
    `HTTP ${approveIntoFull.status} status=${fullStatus[0]?.status} ${approveIntoFull.text.slice(0, 100)}`,
  );

  // ------------------------------------------------------------------ 7. withdraw
  console.log("\n--- withdrawing is a DELETE of your own pending row ---");
  const withdraw = await rest(studentTok, `registrations?id=eq.${physicsId}`, {
    method: "DELETE",
  });
  const gone = await sql(
    `select count(*)::int c from public.registrations where id = '${physicsId}';`,
  );
  rec(
    "a student can withdraw their own pending request",
    withdraw.ok && gone[0].c === 0,
    `HTTP ${withdraw.status} rows=${gone[0].c}`,
  );

  // The UI's reason for DELETE rather than a status change: it frees the pair, so the
  // student can apply again. A tombstone row would make the second attempt fail.
  const again = await rest(studentTok, "registrations", {
    method: "POST",
    body: JSON.stringify({ student_id: fx.student.id, group_id: physics.id }),
  });
  rec(
    "and can then apply to the same group again",
    again.ok,
    `HTTP ${again.status} ${again.text.slice(0, 120)}`,
  );

  // ------------------------------------------------------------------ 8. admin decides
  console.log("\n--- only an admin decides ---");
  const approve = await rest(adminTok, `registrations?id=eq.${ownId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "approved", decided_at: new Date().toISOString() }),
  });
  const decided = await sql(`select status from public.registrations where id = '${ownId}';`);
  rec(
    "an admin can approve",
    approve.ok && decided[0]?.status === "approved",
    `HTTP ${approve.status} status=${decided[0]?.status}`,
  );

  const teacherTok = await signIn(fx.teacher.email);
  const teacherApprove = await rest(teacherTok, `registrations?id=eq.${ownId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "rejected" }),
  });
  const stillApproved = await sql(`select status from public.registrations where id = '${ownId}';`);
  rec(
    "the group's own teacher cannot overturn the decision",
    stillApproved[0]?.status === "approved",
    `status=${stillApproved[0]?.status} HTTP ${teacherApprove.status}`,
  );

  // ------------------------------------------------------------------ 9. what the UI reads
  console.log("\n--- the fields the redesigned cards read ---");
  const mine = await rest(
    studentTok,
    "registrations?select=id,status,note,created_at,decided_at,groups(name,price_dzd,max_students,subjects(key,name,color),teacher_id)",
  );
  rec(
    "a student can read their own requests with the group embedded",
    Array.isArray(mine.body) && mine.body.length > 0,
    `${Array.isArray(mine.body) ? mine.body.length : mine.text.slice(0, 100)} rows`,
  );
  rec(
    "`note` is readable -- it is what the rejection reason renders from",
    Array.isArray(mine.body) && mine.body.every((r) => "note" in r),
    JSON.stringify(Array.isArray(mine.body) ? Object.keys(mine.body[0] ?? {}) : []).slice(0, 120),
  );

  // The teacher photo on every card comes from `profiles.avatar_url` through the group's
  // teacher relationship. A student must be able to read it, or every card falls back to
  // initials in production while looking fine in a seeded dev database.
  const photos = await rest(studentTok, "profiles?select=id,full_name,avatar_url");
  rec(
    "a student can read teacher names and photos from profiles",
    Array.isArray(photos.body) && photos.body.some((p) => p.id === fx.teacher.id),
    `${Array.isArray(photos.body) ? photos.body.length : photos.text.slice(0, 100)} rows`,
  );

  // ------------------------------------------------------------------ 10. decided rows stay
  console.log("\n--- a decided registration is not the student's to delete ---");
  // Until 20260930110000 the delete policy had no status predicate, and a student could
  // remove an APPROVED place (or a REJECTED row kept as history) over the API. The student
  // branch now requires `status = 'pending'`, matching the only case the UI offers.
  const deleteApproved = await rest(studentTok, `registrations?id=eq.${ownId}`, {
    method: "DELETE",
  });
  const approvedStill = await sql(
    `select count(*)::int c from public.registrations where id = '${ownId}';`,
  );
  rec(
    "a student CANNOT delete their own approved registration",
    approvedStill[0].c === 1,
    `HTTP ${deleteApproved.status} rows=${approvedStill[0].c}`,
  );

  await sql(`update public.registrations set status = 'rejected' where id = '${ownId}';`);
  const deleteRejected = await rest(studentTok, `registrations?id=eq.${ownId}`, {
    method: "DELETE",
  });
  const rejectedStill = await sql(
    `select count(*)::int c from public.registrations where id = '${ownId}';`,
  );
  rec(
    "a student CANNOT delete their own rejected registration (history)",
    rejectedStill[0].c === 1,
    `HTTP ${deleteRejected.status} rows=${rejectedStill[0].c}`,
  );

  const adminDelete = await rest(adminTok, `registrations?id=eq.${ownId}`, { method: "DELETE" });
  const adminGone = await sql(
    `select count(*)::int c from public.registrations where id = '${ownId}';`,
  );
  rec(
    "an administrator can still remove a registration without payments",
    adminDelete.ok && adminGone[0].c === 0,
    `HTTP ${adminDelete.status} rows=${adminGone[0].c}`,
  );

  // ------------------------------------------------------------------ 11. admin places directly
  console.log("\n--- the administration can still create a decided place ---");
  // The request-only rule binds students. An administrator's insert may carry a decision,
  // which the admin enrolment flow relies on.
  const direct = await rest(adminTok, "registrations", {
    method: "POST",
    body: JSON.stringify({
      student_id: fx.student.id,
      group_id: maths.id,
      status: "approved",
      decided_at: new Date().toISOString(),
    }),
  });
  rec(
    "an administrator can insert an approved registration directly",
    direct.ok && Array.isArray(direct.body) && direct.body[0]?.status === "approved",
    `HTTP ${direct.status} ${direct.text.slice(0, 100)}`,
  );
} finally {
  await fx.cleanup();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
