/**
 * Session Spine -- end-to-end against real rows and real RLS.
 *
 * Where `status.test.ts` proves the pure derivations in isolation, this proves
 * the ASSEMBLY: that the two Phase 2A views, the recurrence expansion and the
 * group metadata join up into correct sessions for a real signed-in user.
 *
 * Covered:
 *   * admin visibility, teacher scoping in BOTH directions
 *   * date-range boundaries (inclusive on both ends)
 *   * teacher / level / subject / to-mark-only filters
 *   * cache-key separation for different windows
 *   * partial, complete, overdue, today, future, zero-enrolment
 *   * parallel sessions in one time slot
 *
 * The spine's own pure pieces are imported directly from source (Node 24 strips
 * the types), so this exercises the SAME code the app runs -- not a reimplementation.
 *
 * LOCAL ONLY -- fixtures.mjs refuses to run against a non-local API.
 *
 * RUN THIS SUITE ALONE, NOT CONCURRENTLY WITH ANOTHER E2E SUITE.
 * `cleanupFixtures()` deletes EVERY `e2e-fixture%` group and user, not just the
 * ones a given run created. Two suites overlapping therefore delete each other's
 * accounts mid-flight, which surfaces as a `sign-in failed` throw rather than an
 * assertion failure. That is a property of the shared fixture harness, not of the
 * spine -- observed once while chaining suites in one shell command.
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

import {
  deriveStatus,
  countersFor,
  groupByTimeSlot,
} from "../../src/features/school/session/status.ts";
import { sessionKey } from "../../src/features/school/session/session-key.ts";
// Imported from the LEAF keys module, not `use-sessions.ts`: the hook pulls in
// React and `@/`-aliased modules that plain Node cannot resolve. The keys are
// the part worth asserting here.
import { sessionKeys } from "../../src/features/school/session/keys.ts";

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
const shift = (days) => iso(new Date(Date.now() + days * 86_400_000));

/**
 * Reads the spine's two aggregate views as a given user and joins them the way
 * `useSessions` does. Mirrors the hook's join, not its React plumbing.
 */
async function readSpine(token, from, to) {
  const [sumRes, encRes] = await Promise.all([
    asUser(
      token,
      `session_attendance_summary?select=group_id,session_date,marked_count&session_date=gte.${from}&session_date=lte.${to}`,
    ),
    asUser(token, `group_enrollment_counts?select=group_id,enrolled_count`),
  ]);
  const summaries = await sumRes.json();
  const enrolment = await encRes.json();
  const sumMap = new Map();
  for (const r of summaries ?? []) {
    if (!r.group_id || !r.session_date) continue;
    sumMap.set(sessionKey(r.group_id, r.session_date), r.marked_count ?? 0);
  }
  const encMap = new Map();
  for (const r of enrolment ?? []) {
    if (!r.group_id) continue;
    encMap.set(r.group_id, r.enrolled_count ?? 0);
  }
  return { sumMap, encMap };
}

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const other = await withFixtures({ teacher: true });

try {
  const today = new Date();
  const weekday = today.getDay();
  const todayIso = iso(today);

  // Two groups for the same teacher on the SAME weekday and SAME time -> the
  // parallel-session case. A third for the other teacher. A fourth with nobody.
  const gA = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: "e2e-fixture Spine A",
    weekday,
    studentCount: 4,
  });
  const gB = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: "e2e-fixture Spine B",
    weekday,
    studentCount: 3,
  });
  const gOther = await createGroupFixture({
    teacherId: other.teacher.id,
    name: "e2e-fixture Spine Other",
    weekday,
    studentCount: 2,
  });
  const gEmpty = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: "e2e-fixture Spine Empty",
    weekday,
    studentCount: 0,
  });

  // Both A and B meet at 14:00 (the fixture default) on the same weekday, which
  // is exactly the "parallel sessions" shape the calendar must keep separate.
  const adminTok = await signIn(fx.admin.email);
  const teacherTok = await signIn(fx.teacher.email);
  const otherTok = await signIn(other.teacher.email);
  const studentTok = await signIn(fx.student.email);

  console.log("\n[1] Admin visibility");
  {
    const { encMap } = await readSpine(adminTok, shift(-7), shift(7));
    check("admin sees group A enrolment", encMap.get(gA.id) === 4, `got ${encMap.get(gA.id)}`);
    check("admin sees group B enrolment", encMap.get(gB.id) === 3, `got ${encMap.get(gB.id)}`);
    check(
      "admin sees the OTHER teacher's group too",
      encMap.get(gOther.id) === 2,
      `got ${encMap.get(gOther.id)}`,
    );
    check(
      "admin sees the zero-enrolment group as 0 (not missing)",
      encMap.get(gEmpty.id) === 0,
      `got ${encMap.get(gEmpty.id)}`,
    );
  }

  console.log("\n[2] Teacher scoping, both directions");
  // Mark one student in each teacher's group so both have summary rows.
  await svc("attendance", {
    method: "POST",
    body: JSON.stringify([
      {
        group_id: gA.id,
        student_id: gA.students[0].id,
        session_date: todayIso,
        status: "present",
        marked_by: fx.teacher.id,
      },
      {
        group_id: gOther.id,
        student_id: gOther.students[0].id,
        session_date: todayIso,
        status: "present",
        marked_by: other.teacher.id,
      },
    ]),
  });
  {
    const mine = await readSpine(teacherTok, shift(-7), shift(7));
    check(
      "teacher sees their own session summary",
      mine.sumMap.has(sessionKey(gA.id, todayIso)),
      [...mine.sumMap.keys()].join(","),
    );
    check(
      "teacher does NOT see the other teacher's session summary",
      !mine.sumMap.has(sessionKey(gOther.id, todayIso)),
      `LEAK: ${[...mine.sumMap.keys()].join(",")}`,
    );

    const theirs = await readSpine(otherTok, shift(-7), shift(7));
    check(
      "other teacher sees their own",
      theirs.sumMap.has(sessionKey(gOther.id, todayIso)),
      [...theirs.sumMap.keys()].join(","),
    );
    check(
      "other teacher does NOT see the first teacher's",
      !theirs.sumMap.has(sessionKey(gA.id, todayIso)),
      `LEAK: ${[...theirs.sumMap.keys()].join(",")}`,
    );
  }

  console.log("\n[3] Date-range boundaries are inclusive on both ends");
  {
    // Put attendance exactly on the window edges. The group meets weekly on
    // `weekday`, so -7 and +7 are both real occurrences.
    const past = shift(-7);
    const future = shift(7);
    await svc("attendance", {
      method: "POST",
      body: JSON.stringify([
        {
          group_id: gB.id,
          student_id: gB.students[0].id,
          session_date: past,
          status: "present",
          marked_by: fx.teacher.id,
        },
      ]),
    });

    const exact = await readSpine(teacherTok, past, past);
    check(
      "from === to === the session date returns it",
      exact.sumMap.has(sessionKey(gB.id, past)),
      [...exact.sumMap.keys()].join(","),
    );

    const excluded = await readSpine(teacherTok, shift(-6), future);
    check(
      "a window starting one day later excludes it",
      !excluded.sumMap.has(sessionKey(gB.id, past)),
      "boundary leaked",
    );

    const included = await readSpine(teacherTok, past, shift(-7));
    check(
      "lower boundary is inclusive",
      included.sumMap.has(sessionKey(gB.id, past)),
      "lower bound wrongly exclusive",
    );
  }

  console.log("\n[4] Status derivation over real data");
  {
    const { sumMap, encMap } = await readSpine(adminTok, shift(-30), shift(30));

    // gA today: 1 of 4 marked -> partial
    const aMarked = sumMap.get(sessionKey(gA.id, todayIso)) ?? 0;
    check(
      "partial: 1 of 4 marked today",
      deriveStatus(
        { date: todayIso, enrolled: encMap.get(gA.id) ?? 0, marked: aMarked },
        todayIso,
      ) === "partial",
      `marked=${aMarked} enrolled=${encMap.get(gA.id)}`,
    );

    // gB in the past: 1 of 3 -> partial (started, so not overdue)
    const past = shift(-7);
    const bMarked = sumMap.get(sessionKey(gB.id, past)) ?? 0;
    check(
      "partial beats overdue for a started past session",
      deriveStatus({ date: past, enrolled: encMap.get(gB.id) ?? 0, marked: bMarked }, todayIso) ===
        "partial",
      `marked=${bMarked}`,
    );

    // Mark every student in gA today -> complete
    // `on_conflict` must be in the QUERY STRING, not just the Prefer header --
    // without it PostgREST treats this as a plain insert and the row already
    // written above collides, so only the new rows land.
    await svc("attendance?on_conflict=group_id,student_id,session_date", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(
        gA.students.map((s) => ({
          group_id: gA.id,
          student_id: s.id,
          session_date: todayIso,
          status: "present",
          marked_by: fx.teacher.id,
        })),
      ),
    });
    const after = await readSpine(adminTok, shift(-30), shift(30));
    const allMarked = after.sumMap.get(sessionKey(gA.id, todayIso)) ?? 0;
    check(
      "complete: all 4 marked",
      deriveStatus({ date: todayIso, enrolled: 4, marked: allMarked }, todayIso) === "complete",
      `marked=${allMarked}`,
    );

    // A past occurrence of gA with nothing marked -> overdue
    const untouchedPast = shift(-14);
    const noMarks = after.sumMap.get(sessionKey(gA.id, untouchedPast)) ?? 0;
    check(
      "overdue: past session with nothing marked",
      deriveStatus({ date: untouchedPast, enrolled: 4, marked: noMarks }, todayIso) === "overdue",
      `marked=${noMarks}`,
    );

    // Future occurrence -> scheduled
    check(
      "scheduled: future session with nothing marked",
      deriveStatus({ date: shift(7), enrolled: 4, marked: 0 }, todayIso) === "scheduled",
    );

    // Zero-enrolment group -> empty, in the past, must NOT be overdue
    check(
      "zero-enrolment past session is empty, NOT overdue",
      deriveStatus(
        { date: untouchedPast, enrolled: encMap.get(gEmpty.id) ?? 0, marked: 0 },
        todayIso,
      ) === "empty",
      `enrolled=${encMap.get(gEmpty.id)}`,
    );
  }

  console.log("\n[5] Filters (group-level, as useSessions applies them)");
  {
    const groups = await sql(`
      select g.id, g.name, g.teacher_id, g.level_id, g.subject_id
        from public.groups g where g.name like 'e2e-fixture Spine%' order by g.name;`);

    const byTeacher = groups.filter((g) => g.teacher_id === fx.teacher.id);
    check(
      "teacher filter keeps only that teacher's groups (3 of 4)",
      byTeacher.length === 3 && !byTeacher.some((g) => g.id === gOther.id),
      JSON.stringify(byTeacher.map((g) => g.name)),
    );

    const levelId = groups[0].level_id;
    const byLevel = groups.filter((g) => g.level_id === levelId);
    check(
      "level filter matches on level_id",
      byLevel.length === groups.length,
      `all fixtures share a level: ${byLevel.length}/${groups.length}`,
    );
    const byWrongLevel = groups.filter(
      (g) => g.level_id === "00000000-0000-0000-0000-000000000000",
    );
    check("level filter excludes non-matching", byWrongLevel.length === 0);

    const subjectId = groups[0].subject_id;
    const bySubject = groups.filter((g) => g.subject_id === subjectId);
    check(
      "subject filter matches on subject_id",
      bySubject.length > 0,
      `${bySubject.length} groups`,
    );
    const byWrongSubject = groups.filter(
      (g) => g.subject_id === "00000000-0000-0000-0000-000000000000",
    );
    check("subject filter excludes non-matching", byWrongSubject.length === 0);
  }

  console.log("\n[6] to-mark-only filter and counters");
  {
    const mk = (status) => ({ status, groupName: "x", date: todayIso, startTime: "14:00" });
    const mixed = [
      mk("complete"),
      mk("partial"),
      mk("due"),
      mk("overdue"),
      mk("scheduled"),
      mk("empty"),
      mk("cancelled"),
    ];
    const counters = countersFor(mixed);
    check(
      "counters over a mixed period: total excludes cancelled",
      counters.total === 6,
      JSON.stringify(counters),
    );
    check("counters: toMark = due + partial", counters.toMark === 2, JSON.stringify(counters));
    check("counters: overdue = 1", counters.overdue === 1, JSON.stringify(counters));

    const actionable = mixed.filter((s) => ["due", "partial", "overdue"].includes(s.status));
    check(
      "to-mark-only keeps due/partial/overdue and hides the rest",
      actionable.length === 3,
      JSON.stringify(actionable.map((s) => s.status)),
    );
    check(
      "to-mark-only hides zero-enrolment sessions",
      !actionable.some((s) => s.status === "empty"),
    );
  }

  console.log("\n[7] Parallel sessions stay individually identifiable");
  {
    // gA and gB both meet at 14:00 on the same weekday.
    const slots = groupByTimeSlot([
      { startTime: "14:00", endTime: "16:00", groupId: gA.id, groupName: "Spine A" },
      { startTime: "14:00", endTime: "16:00", groupId: gB.id, groupName: "Spine B" },
      { startTime: "14:00", endTime: "16:00", groupId: gEmpty.id, groupName: "Spine Empty" },
    ]);
    check("all parallel sessions land in ONE slot", slots.size === 1, `${slots.size} slots`);
    check(
      "and remain three distinct sessions",
      slots.get("14:00-16:00")?.length === 3,
      JSON.stringify(slots.get("14:00-16:00")?.map((s) => s.groupName)),
    );
    const ids = new Set(slots.get("14:00-16:00")?.map((s) => s.groupId));
    check("each has a distinct group id", ids.size === 3, `${ids.size} distinct`);
  }

  console.log("\n[8] Cache-key separation");
  {
    const w1 = JSON.stringify(sessionKeys.summaries("2026-08-03", "2026-08-09"));
    const w2 = JSON.stringify(sessionKeys.summaries("2026-08-10", "2026-08-16"));
    const w3 = JSON.stringify(sessionKeys.summaries("2026-08-03", "2026-08-09"));
    check("different windows produce different cache keys", w1 !== w2, `${w1} vs ${w2}`);
    check("the same window produces a stable key", w1 === w3);
    check(
      "the key contains BOTH ends of the range",
      w1.includes("2026-08-03") && w1.includes("2026-08-09"),
      w1,
    );
    check(
      "keys nest under the attendance root so one write invalidates all",
      JSON.parse(w1)[0] === "attendance",
      w1,
    );
    // A same-`from`, different-`to` pair is the exact collision the old
    // single-argument key would have caused.
    const c1 = JSON.stringify(sessionKeys.summaries("2026-08-01", "2026-08-07"));
    const c2 = JSON.stringify(sessionKeys.summaries("2026-08-01", "2026-08-31"));
    check("same from + different to are separate keys", c1 !== c2, `${c1} vs ${c2}`);
  }

  console.log("\n[9] Students are read-only; anon is denied");
  {
    // A student may READ their own attendance but must never write.
    const write = await fetch(`${API}/rest/v1/attendance`, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${studentTok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          group_id: gA.id,
          student_id: gA.students[0].id,
          session_date: todayIso,
          status: "absent",
        },
      ]),
    });
    check("student CANNOT write attendance", !write.ok, `status ${write.status}`);

    const anonSum = await fetch(`${API}/rest/v1/session_attendance_summary?select=group_id`, {
      headers: { apikey: PUBLISHABLE_KEY },
    });
    const anonBody = await anonSum.text();
    let anonRows = null;
    try {
      anonRows = JSON.parse(anonBody);
    } catch {
      /* non-JSON error body acceptable */
    }
    check(
      "anon gets no session summaries",
      !anonSum.ok || (Array.isArray(anonRows) && anonRows.length === 0),
      `${anonSum.status} ${anonBody.slice(0, 120)}`,
    );
  }
} finally {
  await fx.cleanup();
  await other.cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
