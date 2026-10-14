/**
 * Session aggregate views -- correctness and RLS, against real rows.
 *
 * Covers, per Phase 2A:
 *   * aggregate counts match the underlying attendance rows exactly
 *   * enrolment counts match `registrations` (approved only)
 *   * groups with zero approved registrations still appear, with 0
 *   * unmarked sessions are ABSENT from the summary (client treats as 0)
 *   * admin sees every session
 *   * a teacher sees ONLY their own groups (the security_invoker guarantee)
 *   * anon is denied outright
 *   * existing attendance behaviour is unchanged
 *
 * The teacher-scoping check is the important one: a view created WITHOUT
 * security_invoker runs as its owner and silently bypasses RLS, which no
 * application screen would reveal.
 *
 * LOCAL ONLY -- fixtures.mjs refuses to run against a non-local API.
 */
import {
  withFixtures,
  createGroupFixture,
  sql,
  API,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY,
  TEST_PASSWORD,
} from "./fixtures.mjs";

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  -> ${detail}`);
  }
};

/** Service role: bypasses RLS, used to build expected values. */
const svc = (path, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

/** A signed-in user's view -- RLS applies. */
const asUser = (token, path) =>
  fetch(`${API}/rest/v1/${path}`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
  });

const signIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
};

const iso = (d) => {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const fx = await withFixtures({ admin: true, teacher: true });
// A second teacher: scoping can only be proven with someone else's data present.
const other = await withFixtures({ teacher: true });

try {
  const today = new Date();
  const weekday = today.getDay();
  const date = iso(today);

  const mine = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: "e2e-fixture SessionAgg Mine",
    weekday,
    studentCount: 5,
  });
  const theirs = await createGroupFixture({
    teacherId: other.teacher.id,
    name: "e2e-fixture SessionAgg Theirs",
    weekday,
    studentCount: 3,
  });
  // Schedule but nobody enrolled -- drives the "0 enrolled" product state.
  const empty = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: "e2e-fixture SessionAgg Empty",
    weekday,
    studentCount: 0,
  });

  console.log("\n[1] Aggregate counts match the underlying rows");

  // 2 present, 1 absent, 1 late = 4 of 5 marked. Leaving one unmarked makes
  // this a PARTIAL session -- the state the old boolean query could not express.
  const ins = await svc("attendance", {
    method: "POST",
    body: JSON.stringify(
      [
        { student_id: mine.students[0].id, status: "present" },
        { student_id: mine.students[1].id, status: "present" },
        { student_id: mine.students[2].id, status: "absent" },
        { student_id: mine.students[3].id, status: "late" },
      ].map((m) => ({
        group_id: mine.id,
        student_id: m.student_id,
        session_date: date,
        status: m.status,
        marked_by: fx.teacher.id,
      })),
    ),
  });
  check("seed attendance accepted", ins.ok, `${ins.status} ${await ins.text().catch(() => "")}`);

  const sumRows = await (
    await svc(`session_attendance_summary?group_id=eq.${mine.id}&session_date=eq.${date}`)
  ).json();
  const s = Array.isArray(sumRows) ? sumRows[0] : null;

  check(
    "exactly one summary row for the session",
    Array.isArray(sumRows) && sumRows.length === 1,
    JSON.stringify(sumRows),
  );
  check("marked_count = 4", s?.marked_count === 4, `got ${s?.marked_count}`);
  check("present_count = 2", s?.present_count === 2, `got ${s?.present_count}`);
  check("absent_count = 1", s?.absent_count === 1, `got ${s?.absent_count}`);
  check("late_count = 1", s?.late_count === 1, `got ${s?.late_count}`);
  check("excused_count = 0", s?.excused_count === 0, `got ${s?.excused_count}`);
  check("last_marked_at present", !!s?.last_marked_at, `got ${s?.last_marked_at}`);

  const raw = await (
    await svc(`attendance?group_id=eq.${mine.id}&session_date=eq.${date}&select=student_id`)
  ).json();
  check(
    "marked_count equals raw row count",
    s?.marked_count === raw.length,
    `summary=${s?.marked_count} raw=${raw.length}`,
  );

  // Independent cross-check straight from SQL, for every session in the table.
  const drift = await sql(`
    select v.group_id, v.session_date, v.marked_count, t.n
      from public.session_attendance_summary v
      join (select group_id, session_date, count(*) n
              from public.attendance group by group_id, session_date) t
        on t.group_id = v.group_id and t.session_date = v.session_date
     where v.marked_count <> t.n;`);
  check(
    "no session's marked_count drifts from a raw GROUP BY",
    Array.isArray(drift) && drift.length === 0,
    JSON.stringify(drift),
  );

  console.log("\n[2] Unmarked sessions are absent from the summary");
  const emptySummary = await (
    await svc(`session_attendance_summary?group_id=eq.${empty.id}`)
  ).json();
  check(
    "group with no attendance yields no summary row",
    Array.isArray(emptySummary) && emptySummary.length === 0,
    JSON.stringify(emptySummary),
  );

  console.log("\n[3] Enrolment counts");
  const encMine = await (await svc(`group_enrollment_counts?group_id=eq.${mine.id}`)).json();
  check(
    "enrolled_count = 5 for my group",
    encMine[0]?.enrolled_count === 5,
    JSON.stringify(encMine),
  );

  const encEmpty = await (await svc(`group_enrollment_counts?group_id=eq.${empty.id}`)).json();
  check(
    "group with 0 approved STILL appears, with 0",
    encEmpty.length === 1 && encEmpty[0].enrolled_count === 0,
    JSON.stringify(encEmpty),
  );

  // Only `approved` counts. A pending registration must not raise the number.
  //
  // The student must be one with no existing enrolment in this subject/level:
  // `enforce_one_group_per_subject` rejects a second registration for the same
  // subject, so reusing another group's student is refused by the database.
  // `empty` has a schedule but no students, so its roster is free -- create a
  // dedicated student and leave the registration pending.
  const spare = await withFixtures({ student: true });
  await sql(`
    insert into public.registrations (student_id, group_id, status)
    values ('${spare.student.id}', '${mine.id}', 'pending')
    on conflict do nothing;`);
  const afterPending = await (await svc(`group_enrollment_counts?group_id=eq.${mine.id}`)).json();
  check(
    "pending registration does NOT raise enrolled_count",
    afterPending[0]?.enrolled_count === 5,
    `got ${afterPending[0]?.enrolled_count}`,
  );

  // Compare the view against an independent count for EVERY group.
  const encDrift = await sql(`
    select g.id, c.enrolled_count, count(r.*) filter (where r.status='approved') as expected
      from public.groups g
      join public.group_enrollment_counts c on c.group_id = g.id
      left join public.registrations r on r.group_id = g.id
     group by g.id, c.enrolled_count
    having c.enrolled_count <> count(r.*) filter (where r.status='approved');`);
  check(
    "every group's enrolled_count matches registrations",
    Array.isArray(encDrift) && encDrift.length === 0,
    JSON.stringify(encDrift),
  );

  console.log("\n[4] RLS -- admin sees everything");
  const adminTok = await signIn(fx.admin.email);
  const adminRows = await (
    await asUser(adminTok, `session_attendance_summary?select=group_id,session_date`)
  ).json();
  const adminGroups = new Set((adminRows ?? []).map((r) => r.group_id));
  check("admin sees my group's session", adminGroups.has(mine.id), JSON.stringify(adminRows));

  console.log("\n[5] RLS -- teacher scoping (the security_invoker guarantee)");
  await svc("attendance", {
    method: "POST",
    body: JSON.stringify([
      {
        group_id: theirs.id,
        student_id: theirs.students[0].id,
        session_date: date,
        status: "present",
        marked_by: other.teacher.id,
      },
    ]),
  });

  const mineTok = await signIn(fx.teacher.email);
  const mineRows = await (
    await asUser(mineTok, `session_attendance_summary?select=group_id,marked_count`)
  ).json();
  const mineSeen = new Set((mineRows ?? []).map((r) => r.group_id));
  check("teacher sees their own session", mineSeen.has(mine.id), JSON.stringify(mineRows));
  check(
    "teacher does NOT see the other teacher's session",
    !mineSeen.has(theirs.id),
    `LEAK: saw ${theirs.id} in ${JSON.stringify(mineRows)}`,
  );

  const otherTok = await signIn(other.teacher.email);
  const otherRows = await (
    await asUser(otherTok, `session_attendance_summary?select=group_id`)
  ).json();
  const otherSeen = new Set((otherRows ?? []).map((r) => r.group_id));
  check("other teacher sees their own", otherSeen.has(theirs.id), JSON.stringify(otherRows));
  check("other teacher does NOT see mine", !otherSeen.has(mine.id), `LEAK: saw ${mine.id}`);

  console.log("\n[6] anon is denied");
  for (const view of ["session_attendance_summary", "group_enrollment_counts"]) {
    const res = await fetch(`${API}/rest/v1/${view}?select=group_id`, {
      headers: { apikey: PUBLISHABLE_KEY },
    });
    const body = await res.text();
    let rows = null;
    try {
      rows = JSON.parse(body);
    } catch {
      /* non-JSON error body is acceptable */
    }
    check(
      `anon gets no rows from ${view}`,
      !res.ok || (Array.isArray(rows) && rows.length === 0),
      `${res.status} ${body.slice(0, 160)}`,
    );
  }

  console.log("\n[7] Existing attendance behaviour unchanged");
  const roster = await (
    await asUser(
      mineTok,
      `attendance?group_id=eq.${mine.id}&session_date=eq.${date}&select=student_id,status`,
    )
  ).json();
  check(
    "teacher still reads their own register (4 rows)",
    Array.isArray(roster) && roster.length === 4,
    JSON.stringify(roster),
  );

  const up = await fetch(`${API}/rest/v1/attendance?on_conflict=group_id,student_id,session_date`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([
      {
        group_id: mine.id,
        student_id: mine.students[0].id,
        session_date: date,
        status: "excused",
        marked_by: fx.teacher.id,
      },
    ]),
  });
  check("upsert still merges", up.ok, `${up.status}`);

  const afterUp = await (
    await svc(`session_attendance_summary?group_id=eq.${mine.id}&session_date=eq.${date}`)
  ).json();
  check(
    "summary reflects the update without duplicating (still 4 marked)",
    afterUp[0]?.marked_count === 4,
    JSON.stringify(afterUp),
  );
  check(
    "status change moved present -> excused",
    afterUp[0]?.present_count === 1 && afterUp[0]?.excused_count === 1,
    JSON.stringify(afterUp),
  );

  // The occurrence trigger must still reject an unscheduled date.
  const badDate = iso(new Date(today.getTime() + 3 * 86_400_000));
  if (new Date(`${badDate}T00:00:00`).getDay() !== weekday) {
    const bad = await svc("attendance", {
      method: "POST",
      body: JSON.stringify([
        {
          group_id: mine.id,
          student_id: mine.students[0].id,
          session_date: badDate,
          status: "present",
          marked_by: fx.teacher.id,
        },
      ]),
    });
    check(
      "validate_attendance_occurrence still rejects an unscheduled date",
      !bad.ok,
      `unexpectedly accepted ${badDate} (${bad.status})`,
    );
  }

  console.log("\n[8] The composite index exists and is usable");
  // NOT asserting that a plan uses it. Measured on 120k synthetic rows, the
  // planner prefers the narrower idx_attendance_session_date when both exist;
  // the composite is a complement (9.99ms with it vs 12.58ms without, and
  // 4.20ms when forced to use it alone). At fixture scale (<10 rows) a seq scan
  // is correctly cheapest, so a plan-shape assertion here would only encode the
  // fixture size. See the migration's section 3 for the measurements.
  const idx = await sql(`
    select indexname from pg_indexes
     where schemaname='public' and tablename='attendance'
     order by indexname;`);
  const names = (idx ?? []).map((r) => r.indexname);
  check(
    "idx_attendance_date_group exists",
    names.includes("idx_attendance_date_group"),
    JSON.stringify(names),
  );
  check(
    "pre-existing idx_attendance_session_date retained",
    names.includes("idx_attendance_session_date"),
    JSON.stringify(names),
  );
  check(
    "pre-existing idx_attendance_student_id retained",
    names.includes("idx_attendance_student_id"),
    JSON.stringify(names),
  );
  check(
    "UNIQUE (group_id, student_id, session_date) retained",
    names.includes("attendance_group_id_student_id_session_date_key"),
    JSON.stringify(names),
  );

  // The composite's column order must match the calendar's grouping key, which
  // is what makes the index-only path possible. Assert the definition, not a
  // plan shape: definitions are stable, plans depend on table size.
  const def = await sql(`
    select indexdef from pg_indexes
     where schemaname='public' and indexname='idx_attendance_date_group';`);
  check(
    "composite is (session_date, group_id) in that order",
    /\(session_date,\s*group_id\)/i.test(def?.[0]?.indexdef ?? ""),
    JSON.stringify(def),
  );
} finally {
  await fx.cleanup();
  await other.cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
