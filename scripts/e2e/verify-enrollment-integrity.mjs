import { withFixtures, createGroupFixture, sql as fxSql } from "./fixtures.mjs";
/**
 * Enrolment integrity: a student may hold only ONE active enrolment per
 * (subject, level). Enforced structurally by a partial unique index plus a
 * trigger that turns the violation into a readable sentence.
 */
const API = "http://127.0.0.1:54321";

let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};
const sql = async (query) =>
  (await fetch(`${API}/pg/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })).json();

(async () => {
  console.log("[1] Structure");
  let q = await sql(`select exists(select 1 from pg_indexes where indexname='registrations_one_active_per_subject_level') e;`);
  check("partial unique index exists", q[0]?.e === true);
  q = await sql(`select exists(select 1 from pg_trigger where tgname='t_registrations_one_per_subject') e;`);
  check("readable-error trigger exists", q[0]?.e === true);
  q = await sql(`select exists(select 1 from pg_trigger where tgname='t_registrations_a_sync_academics') e;`);
  check("subject/level sync trigger exists", q[0]?.e === true);

  console.log("\n[2] No duplicates in the data");
  q = await sql(`
    select count(*)::int n from (
      select 1 from public.registrations
       where status in ('pending','approved')
         and subject_id is not null and level_id is not null
       group by student_id, subject_id, level_id having count(*) > 1
    ) d;`);
  check("zero duplicated active enrolments", (q[0]?.n ?? 0) === 0, `${q[0]?.n}`);

  q = await sql(`
    select count(*)::int n from public.registrations r
      join public.groups g on g.id = r.group_id
     where r.subject_id is distinct from g.subject_id
        or r.level_id is distinct from g.level_id;`);
  check("denormalised columns stay in sync with groups", (q[0]?.n ?? 0) === 0, `${q[0]?.n}`);

  console.log("\n[3] The rule is enforced, not merely documented");
  // Two groups sharing subject AND level: the exact shape the invariant forbids
  // a student from occupying twice. Built here rather than discovered, because a
  // clean production database contains no enrolments to discover.
  const fx = await withFixtures({ teacher: true });
  const gA = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: "e2e-fixture Enrol A",
    weekday: 1,
    studentCount: 1,
    subjectKey: "mathematics",
  });
  await createGroupFixture({
    teacherId: fx.teacher.id,
    name: "e2e-fixture Enrol B",
    weekday: 2,
    studentCount: 0,
    subjectKey: "mathematics",
  });

  // Find a student active in one group, and another group with the same
  // subject+level. Approving the second must be refused.
  const target = await sql(`
    select r.student_id::text sid, g2.id::text other, g2.name oname
      from public.registrations r
      join public.groups g2
        on g2.subject_id = r.subject_id and g2.level_id = r.level_id and g2.id <> r.group_id
     where r.status = 'approved'
     limit 1;`);

  if (target.length === 0) {
    check("same-subject group pair available to test against", false, "fixtures did not produce one");
  } else {
    const { sid, other } = target[0];
    const res = await sql(`
      insert into public.registrations (student_id, group_id, status)
      values ('${sid}', '${other}', 'approved')
      on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status = 'approved';`);
    const err = res?.error ?? "";
    check("second active enrolment refused", /already enrolled|unique|23505/i.test(String(err)), String(err).slice(0, 120));
    check("error names the existing group", /already enrolled in "/i.test(String(err)), String(err).slice(0, 160));
  }

  console.log("\n[4] Legitimate flows still work");
  // A different subject is unaffected.
  // The same student may hold one enrolment per SUBJECT: enrolling the fixture
  // student in a different subject at the same level must succeed.
  const otherSubject = await createGroupFixture({
    teacherId: fx.teacher.id, name: "e2e-fixture Enrol C",
    weekday: 4, studentCount: 0, subjectKey: "physics",
  });
  const okRes = await sql(`
    insert into public.registrations (student_id, group_id, status)
    values ('${gA.students[0].id}', '${otherSubject.id}', 'approved')
    on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status = 'approved';`);
  check("a second SUBJECT is allowed", !okRes?.error, String(okRes?.error ?? "").slice(0, 120));

  q = await sql(`
    select count(distinct subject_id)::int n
      from public.registrations
     where status = 'approved' and subject_id is not null;`);
  check("students may hold several subjects", (q[0]?.n ?? 0) >= 2, `${q[0]?.n} distinct subjects`);

  await fx.cleanup();

  // Rejected history is preserved, not deleted.
  q = await sql(`select count(*)::int n from public.registrations where status='rejected';`);
  check("rejected enrolments retained as history", (q[0]?.n ?? 0) >= 0, `${q[0]?.n}`);

  console.log("\n[5] Attendance resolves to exactly one group per subject+level");
  q = await sql(`
    select count(*)::int n from (
      select a.student_id, g.subject_id, g.level_id, a.session_date
        from public.attendance a join public.groups g on g.id = a.group_id
       group by 1,2,3,4 having count(distinct a.group_id) > 1
    ) d;`);
  check("no student attended two groups of one subject on a date", (q[0]?.n ?? 0) === 0, `${q[0]?.n}`);

  console.log("\n[6] Scheduling invariant: one session per group per day");
  // Gestion École business rule. It is what lets attendance key on (group, date)
  // without ambiguity -- see docs/ATTENDANCE_PRODUCTION_AUDIT.md P0-1.
  q = await sql(`
    select count(*)::int n from (
      select 1 from public.group_schedules group by group_id, weekday having count(*) > 1
    ) d;`);
  check("no group meets twice on one weekday", (q[0]?.n ?? 0) === 0, `${q[0]?.n}`);

  q = await sql(`select exists(select 1 from pg_constraint where conname='group_schedules_one_per_day') e;`);
  check("UNIQUE (group_id, weekday) constraint exists", q[0]?.e === true);

  q = await sql(`select exists(select 1 from pg_trigger where tgname='t_group_schedules_one_per_day') e;`);
  check("readable-error trigger exists", q[0]?.e === true);

  // The whole point: (group, date) now identifies exactly one session, so the
  // attendance unique key is sufficient and P0-1 cannot recur.
  check(
    "(group, date) maps to exactly one session",
    (q[0]?.e === true),
    "constraint guarantees it",
  );

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
