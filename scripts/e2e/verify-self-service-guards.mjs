/**
 * What a user may and may not change about themselves (SEC-02, 20261003100100).
 *
 * The self-update policies on `students`, `teachers` and `profiles` let a user write their own
 * row; the column grants decide which columns. Some of those columns are authorisation inputs
 * (a student's status, level and stream) or audit evidence (the account email), so a guard
 * trigger refuses them for non-administrators. This suite asks the database over HTTP with real
 * user tokens -- a UI test could only show that no field is offered.
 *
 * What must hold:
 *   - a student completes onboarding (level, stream, stamp) exactly as the wizard does
 *   - after onboarding, a student cannot change level, stream, the stamp, or their status
 *   - a student can still edit their personal and guardian details, name, phone, photo, and
 *     clear their own forced-password-change flag
 *   - nobody but an administrator changes an account email
 *   - a teacher cannot change their own status, but can edit their bio
 *   - administrators and server-side (service role) writes are unaffected
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API). RUN ALONE -- cleanup is global.
 *
 *   node scripts/e2e/verify-self-service-guards.mjs
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

/** PATCH one row as a real signed-in user (or the service role when `tok` is the service key). */
const patch = async (tok, table, id, values) => {
  const res = await fetch(`${API}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: tok === SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY : PUBLISHABLE_KEY,
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(values),
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

/** A refusal from the guard: an error response carrying 42501, and no row changed. */
const refused = (r) => !r.ok && /42501/.test(r.text);
const one = async (q) => (await sql(q))[0];

const fx = await withFixtures({ admin: true, teacher: true, student: true });

try {
  const level3 = await one(`select id from public.levels where name = '3ème année secondaire';`);
  const level2 = await one(`select id from public.levels where name = '2ème année secondaire';`);
  const sciences = await one(
    `select id from public.streams where code = 'sciences' and level_id = '${level3.id}';`,
  );
  const maths = await one(
    `select id from public.streams where code = 'maths' and level_id = '${level3.id}';`,
  );

  const studentTok = await signIn(fx.student.email);
  const teacherTok = await signIn(fx.teacher.email);
  const adminTok = await signIn(fx.admin.email);
  const studentRow = () =>
    one(`select level_id, stream_id, status, onboarded_at, guardian_name, address
           from public.students where id = '${fx.student.id}';`);

  /* ------------------------------------------------------------- 1. onboarding still works */
  console.log("\n--- onboarding: the wizard's single update still goes through ---");
  const onboard = await patch(studentTok, "students", fx.student.id, {
    gender: "female",
    date_of_birth: "2008-03-14",
    guardian_name: "Parent E2E",
    guardian_phone: "0550000000",
    address: null,
    level_id: level3.id,
    stream_id: sciences.id,
    onboarded_at: new Date().toISOString(),
  });
  const afterOnboard = await studentRow();
  rec(
    "a student who has not finished onboarding can set level, stream and the stamp",
    onboard.ok && afterOnboard.level_id === level3.id && afterOnboard.onboarded_at !== null,
    `HTTP ${onboard.status} ${onboard.text.slice(0, 120)}`,
  );

  /* ------------------------------------------------------------- 2. frozen after onboarding */
  console.log("\n--- after onboarding, academic identity and status are the administration's ---");
  const attempts = [
    ["change their level", { level_id: level2.id }],
    ["change their stream", { stream_id: maths.id }],
    ["re-open onboarding (clear the stamp)", { onboarded_at: null }],
    ["change their status", { status: "suspended" }],
  ];
  for (const [label, values] of attempts) {
    const r = await patch(studentTok, "students", fx.student.id, values);
    const row = await studentRow();
    rec(
      `a student CANNOT ${label}`,
      refused(r) &&
        row.level_id === level3.id &&
        row.stream_id === sciences.id &&
        row.onboarded_at !== null &&
        row.status === "active",
      `HTTP ${r.status} ${r.text.slice(0, 120)}`,
    );
  }

  /* ------------------------------------------------------------- 3. still self-editable */
  console.log("\n--- personal details stay the student's own ---");
  const guardian = await patch(studentTok, "students", fx.student.id, {
    guardian_name: "Parent Modifié",
    address: "12 rue des Oliviers",
  });
  const g = await studentRow();
  rec(
    "a student can still edit guardian and address",
    guardian.ok && g.guardian_name === "Parent Modifié" && g.address === "12 rue des Oliviers",
    `HTTP ${guardian.status} ${guardian.text.slice(0, 120)}`,
  );

  const profile = await patch(studentTok, "profiles", fx.student.id, {
    full_name: "E2E Student Renamed",
    phone: "0661000000",
    avatar_url: null,
  });
  rec(
    "a student can still edit their name, phone and photo (the profile page)",
    profile.ok && profile.body?.[0]?.full_name === "E2E Student Renamed",
    `HTTP ${profile.status} ${profile.text.slice(0, 120)}`,
  );

  await sql(
    `update public.profiles set password_change_required = true where id = '${fx.student.id}';`,
  );
  const flag = await patch(studentTok, "profiles", fx.student.id, {
    password_change_required: false,
  });
  rec(
    "a user can still clear their own forced-password-change flag (change-password flow)",
    flag.ok && flag.body?.[0]?.password_change_required === false,
    `HTTP ${flag.status} ${flag.text.slice(0, 120)}`,
  );

  /* ------------------------------------------------------------- 4. account email */
  console.log("\n--- the account email is not self-editable ---");
  const before = await one(`select email from public.profiles where id = '${fx.student.id}';`);
  const studentEmail = await patch(studentTok, "profiles", fx.student.id, {
    email: "someone.else@example.test",
  });
  const teacherEmail = await patch(teacherTok, "profiles", fx.teacher.id, {
    email: "admin.lookalike@example.test",
  });
  const afterStudent = await one(
    `select email from public.profiles where id = '${fx.student.id}';`,
  );
  const afterTeacher = await one(
    `select email from public.profiles where id = '${fx.teacher.id}';`,
  );
  rec(
    "a student CANNOT change their account email",
    refused(studentEmail) && afterStudent.email === before.email,
    `HTTP ${studentEmail.status} ${studentEmail.text.slice(0, 100)}`,
  );
  rec(
    "a teacher CANNOT change their account email",
    refused(teacherEmail) && afterTeacher.email === fx.teacher.email,
    `HTTP ${teacherEmail.status} ${teacherEmail.text.slice(0, 100)}`,
  );

  /* ------------------------------------------------------------- 5. teachers */
  console.log("\n--- a teacher's status is the administration's ---");
  const teacherStatus = await patch(teacherTok, "teachers", fx.teacher.id, { status: "archived" });
  const ts = await one(`select status from public.teachers where id = '${fx.teacher.id}';`);
  rec(
    "a teacher CANNOT change their own status",
    refused(teacherStatus) && ts.status === "active",
    `HTTP ${teacherStatus.status} ${teacherStatus.text.slice(0, 100)}`,
  );
  const bio = await patch(teacherTok, "teachers", fx.teacher.id, {
    bio: "Professeur de mathématiques.",
  });
  rec(
    "a teacher can still edit their bio",
    bio.ok && bio.body?.[0]?.bio === "Professeur de mathématiques.",
    `HTTP ${bio.status} ${bio.text.slice(0, 100)}`,
  );

  /* ------------------------------------------------------------- 6. admin + server */
  console.log("\n--- administrators and server-side writes are unaffected ---");
  const adminStudent = await patch(adminTok, "students", fx.student.id, {
    level_id: level2.id,
    stream_id: null,
    status: "inactive",
  });
  const as = await studentRow();
  rec(
    "an administrator can change a student's level, stream and status",
    adminStudent.ok && as.level_id === level2.id && as.status === "inactive",
    `HTTP ${adminStudent.status} ${adminStudent.text.slice(0, 120)}`,
  );
  const adminTeacher = await patch(adminTok, "teachers", fx.teacher.id, { status: "inactive" });
  rec(
    "an administrator can change a teacher's status",
    adminTeacher.ok && adminTeacher.body?.[0]?.status === "inactive",
    `HTTP ${adminTeacher.status} ${adminTeacher.text.slice(0, 100)}`,
  );
  const adminEmail = await patch(adminTok, "profiles", fx.student.id, {
    email: before.email,
    full_name: "E2E Student",
  });
  rec(
    "an administrator's profile edit is not blocked by the email guard",
    adminEmail.ok,
    `HTTP ${adminEmail.status} ${adminEmail.text.slice(0, 100)}`,
  );
  const server = await patch(SERVICE_ROLE_KEY, "students", fx.student.id, { status: "active" });
  rec(
    "a server-side (service role) write is not blocked",
    server.ok && server.body?.[0]?.status === "active",
    `HTTP ${server.status} ${server.text.slice(0, 100)}`,
  );

  /* ------------------------------------------------------------- 7. the refusal reads well */
  const sentence = await patch(studentTok, "students", fx.student.id, { status: "archived" });
  rec(
    "the refusal is a permission error with a readable sentence",
    sentence.status === 403 && /administration/.test(sentence.text),
    `HTTP ${sentence.status} ${sentence.text.slice(0, 160)}`,
  );
} finally {
  await fx.cleanup();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
