/**
 * Phase 4 verification -- publication notifications and resource engagement.
 *
 * The notification half is the interesting one, because the mechanism is unusual:
 * there is no scheduler. A notice is created when the teacher decides and carries the
 * instant it becomes readable, so the tests below are mostly about time and about
 * idempotency -- does a pending notice stay unreadable, does republishing five times
 * produce one row, does withdrawing erase a notice a student has already seen.
 *
 * Everything is checked through real tokens, so `deliver_at` is exercised as RLS
 * rather than as a client filter.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase4.mjs
 */
import {
  sql,
  API,
  PUBLISHABLE_KEY,
  TEST_PASSWORD,
  withFixtures,
  createGroupFixture,
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
  return (await r.json()).access_token;
};
const asUser = (tok, path, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
const json = async (tok, path) => {
  const r = await asUser(tok, path);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const patch = (tok, path, body) =>
  asUser(tok, path, { method: "PATCH", body: JSON.stringify(body) });

/* ------------------------------- fixtures ------------------------------- */
const fx = await withFixtures({ teacher: true, student: true, admin: true });
const other = await withFixtures({ teacher: true });

const originals = await sql(`select id, teacher_id from public.groups;`);
const claim = async (teacherId, offset) => {
  const g = (
    await sql(`select id, subject_id from public.groups order by name offset ${offset} limit 1;`)
  )[0];
  await sql(`insert into public.teacher_subjects (teacher_id, subject_id)
             values ('${teacherId}','${g.subject_id}') on conflict do nothing;`);
  await sql(`update public.groups set teacher_id='${teacherId}' where id='${g.id}';`);
  return g.id;
};
const gA = await claim(fx.teacher.id, 0);
const gB = await claim(other.teacher.id, 1);

await sql(`update public.students set gender=coalesce(gender,'male'),
             date_of_birth=coalesce(date_of_birth,'2008-05-14'),
             guardian_name=coalesce(guardian_name,'Parent Fixture'),
             guardian_phone=coalesce(guardian_phone,'0661000000'),
             level_id=(select level_id from public.groups where id='${gA}'),
             stream_id=(select stream_id from public.groups where id='${gA}'),
             onboarded_at=now()
           where id='${fx.student.id}';`);
await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
           values ('${fx.student.id}','${gA}','approved',now())
           on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);

// A chapter that is already live, so resource publication is the only variable.
const chA = (
  await sql(`insert into public.chapters (group_id, title, position, is_published)
             values ('${gA}','p4-chapter',1,true) returning id;`)
)[0].id;
const chB = (
  await sql(`insert into public.chapters (group_id, title, position, is_published)
             values ('${gB}','p4-foreign-chapter',1,true) returning id;`)
)[0].id;

const mkResource = async (chapterId, title, published, publishedAt = null) =>
  (
    await sql(`insert into public.resources
                 (chapter_id, group_id, title, kind, url, role, position, is_published, published_at)
               values ('${chapterId}','00000000-0000-0000-0000-000000000000','${title}','link',
                       'https://example.test/x','notes',0,${published},
                       ${publishedAt ? `'${publishedAt}'` : "null"})
               returning id;`)
  )[0].id;

const tA = await signIn(fx.teacher.email);
const tB = await signIn(other.teacher.email);
const sTok = await signIn(fx.student.email);
const aTok = await signIn(fx.admin.email);

/*
  A publication notifies EVERY enrolled student, so the row count for one resource is the
  size of the class -- not one. These checks were written against a fixture group holding a
  single student and hard-coded that 1; run against a seeded group of eleven they failed
  while the application was behaving correctly.

  The assertions keep their meaning: republishing five times must still leave exactly this
  many rows, and withdrawing must leave the already-delivered ones alone. Only the expected
  number stopped being a literal.
*/
const enrolled = (
  await sql(`select count(*)::int c from public.registrations
              where group_id = '${gA}' and status = 'approved';`)
)[0].c;

const myNotifications = async (tok) =>
  (await json(tok, `notifications?select=id,kind,params,deliver_at&order=deliver_at.desc`)).body ??
  [];

try {
  console.log("\n--- immediate publication notifies, and is readable at once ---");
  const rNow = await mkResource(chA, "p4-immediate", true);
  let inbox = await myNotifications(sTok);
  const immediate = inbox.find((n) => n.params?.resourceId === rNow);
  rec("the student receives a notice", !!immediate, JSON.stringify(inbox).slice(0, 160));
  rec(
    "it names the resource and its chapter",
    immediate?.params?.title === "p4-immediate" && immediate?.params?.chapter === "p4-chapter",
    JSON.stringify(immediate?.params),
  );
  rec("its kind is resource_published", immediate?.kind === "resource_published");

  console.log("\n--- a SCHEDULED publication is invisible until it is due ---");
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  const rLater = await mkResource(chA, "p4-scheduled", true, soon);
  const rowExists = await sql(`select count(*)::int c, min(deliver_at)::text d
                                from public.notifications
                               where params->>'resourceId' = '${rLater}';`);
  rec(
    "a notice row exists straight away, one per enrolled student",
    rowExists[0].c === enrolled,
    JSON.stringify({ ...rowExists[0], enrolled }),
  );
  inbox = await myNotifications(sTok);
  rec(
    "...but the student cannot read it yet",
    !inbox.some((n) => n.params?.resourceId === rLater),
    `${inbox.length} readable`,
  );
  rec(
    "deliver_at matches the publication instant, not the decision instant",
    new Date(rowExists[0].d).toISOString().slice(0, 10) === soon.slice(0, 10),
    `${rowExists[0].d} vs ${soon}`,
  );
  // The resource itself is equally invisible -- the two must agree.
  const resVisible = await json(sTok, `resources?select=title&title=eq.p4-scheduled`);
  rec(
    "the resource and its notice are hidden together",
    (resVisible.body ?? []).length === 0,
    JSON.stringify(resVisible.body),
  );

  console.log("\n--- idempotency ---");
  for (let i = 0; i < 5; i++) {
    await patch(tA, `resources?id=eq.${rNow}`, { is_published: true });
  }
  const afterRepublish = await sql(`select count(*)::int c from public.notifications
                                     where params->>'resourceId' = '${rNow}';`);
  rec(
    "republishing five times does not multiply the notices",
    afterRepublish[0].c === enrolled,
    `${afterRepublish[0].c} (expected ${enrolled})`,
  );

  await patch(tA, `resources?id=eq.${rNow}`, { title: "p4-immediate renamed" });
  const afterRename = await sql(`select count(*)::int c, max(params->>'title') t
                                  from public.notifications where params->>'resourceId' = '${rNow}';`);
  rec(
    "renaming updates the notice in place",
    afterRename[0].c === enrolled && afterRename[0].t === "p4-immediate renamed",
    JSON.stringify(afterRename[0]),
  );

  console.log("\n--- rescheduling and withdrawing ---");
  const later = new Date(Date.now() + 10 * 864e5).toISOString();
  await patch(tA, `resources?id=eq.${rLater}`, { published_at: later });
  const moved = await sql(`select count(*)::int c, min(deliver_at)::text d
                            from public.notifications where params->>'resourceId' = '${rLater}';`);
  rec(
    "rescheduling moves the pending notice rather than adding one",
    moved[0].c === enrolled &&
      new Date(moved[0].d).toISOString().slice(0, 10) === later.slice(0, 10),
    JSON.stringify(moved[0]),
  );

  await patch(tA, `resources?id=eq.${rLater}`, { is_published: false });
  const withdrawn = await sql(`select count(*)::int c from public.notifications
                                where params->>'resourceId' = '${rLater}';`);
  rec(
    "withdrawing removes a notice nobody could read yet",
    withdrawn[0].c === 0,
    `${withdrawn[0].c}`,
  );

  await patch(tA, `resources?id=eq.${rNow}`, { is_published: false });
  const kept = await sql(`select count(*)::int c from public.notifications
                           where params->>'resourceId' = '${rNow}';`);
  rec(
    "withdrawing does NOT erase a notice the student already had",
    kept[0].c === enrolled,
    `${kept[0].c} of ${enrolled} -- history is not rewritten`,
  );

  console.log("\n--- chapters notify too ---");
  const chNew = (
    await sql(`insert into public.chapters (group_id, title, position, is_published)
               values ('${gA}','p4-new-chapter',2,false) returning id;`)
  )[0].id;
  let chapterInbox = await myNotifications(sTok);
  rec("a hidden chapter notifies nobody", !chapterInbox.some((n) => n.params?.chapterId === chNew));
  await patch(tA, `chapters?id=eq.${chNew}`, { is_published: true });
  chapterInbox = await myNotifications(sTok);
  const chapterNote = chapterInbox.find((n) => n.params?.chapterId === chNew);
  rec(
    "publishing it notifies the student",
    !!chapterNote,
    JSON.stringify(chapterInbox).slice(0, 160),
  );
  rec("its kind is chapter_published", chapterNote?.kind === "chapter_published");

  console.log("\n--- who is notified ---");
  /*
    A group nobody is enrolled in, built for this check.

    It used to reuse group B, which `claim()` takes from the EXISTING dataset -- against a
    seeded database that group holds eight students, so "no enrolled students" was never
    true and the assertion failed while the trigger was behaving correctly. Creating an
    empty group makes the check mean what its name says.

    The default fixture name is kept deliberately: `cleanupFixtures` deletes groups by that
    prefix, and a custom name would leak this group into the database after the run.
  */
  const emptyGroup = await createGroupFixture({
    teacherId: other.teacher.id,
    studentCount: 0,
  });
  const chEmpty = (
    await sql(`insert into public.chapters (group_id, title, position, is_published)
               values ('${emptyGroup.id}','p4-empty-chapter',0,true) returning id;`)
  )[0].id;
  const foreign = await mkResource(chEmpty, "p4-foreign", true);
  const foreignNotices = await sql(`select count(*)::int c from public.notifications
                                     where params->>'resourceId' = '${foreign}';`);
  rec(
    "a group with no enrolled students notifies nobody",
    foreignNotices[0].c === 0,
    `${foreignNotices[0].c}`,
  );
  const staffNotices = await sql(`select count(*)::int c from public.notifications
                                   where user_id in ('${fx.teacher.id}','${fx.admin.id}');`);
  rec(
    "staff are never notified about their own publications",
    staffNotices[0].c === 0,
    `${staffNotices[0].c}`,
  );

  console.log("\n--- a pending notice cannot be reached any other way ---");
  const rPending = await mkResource(
    chA,
    "p4-pending",
    true,
    new Date(Date.now() + 5 * 864e5).toISOString(),
  );
  const pendingId = (
    await sql(`select id from public.notifications where params->>'resourceId' = '${rPending}';`)
  )[0]?.id;
  const direct = await json(sTok, `notifications?select=id&id=eq.${pendingId}`);
  rec("not by direct id lookup", (direct.body ?? []).length === 0, JSON.stringify(direct.body));
  const unfiltered = await json(sTok, `notifications?select=id,deliver_at`);
  rec(
    "not by asking for everything",
    !(unfiltered.body ?? []).some((n) => n.id === pendingId),
    `${(unfiltered.body ?? []).length} rows, none pending`,
  );
  rec(
    "and nothing readable is pending",
    (unfiltered.body ?? []).every((n) => new Date(n.deliver_at) <= new Date()),
  );
  const otherStudents = await json(sTok, `notifications?select=user_id`);
  rec(
    "a student sees only their own",
    (otherStudents.body ?? []).every((n) => n.user_id === fx.student.id),
  );
  console.log("\n--- statistics come from an aggregate, not raw rows ---");
  await patch(tA, `resources?id=eq.${rNow}`, { is_published: true, published_at: null });
  for (let i = 0; i < 3; i++) {
    await asUser(sTok, "resource_events", {
      method: "POST",
      body: JSON.stringify([{ resource_id: rNow, student_id: fx.student.id, kind: "view" }]),
    });
  }
  await asUser(sTok, "resource_events", {
    method: "POST",
    body: JSON.stringify([{ resource_id: rNow, student_id: fx.student.id, kind: "download" }]),
  });
  const stats = await json(tA, `resource_engagement?select=*&resource_id=eq.${rNow}`);
  const row = (stats.body ?? [])[0];
  rec(
    "the teacher can read the aggregate",
    stats.status === 200 && !!row,
    JSON.stringify(stats.body).slice(0, 200),
  );
  rec("views are counted", Number(row?.views) === 3, `views=${row?.views}`);
  rec(
    "downloads are counted separately",
    Number(row?.downloads) === 1,
    `downloads=${row?.downloads}`,
  );
  rec(
    "distinct students are counted, not events",
    Number(row?.distinct_students) === 1,
    `distinct=${row?.distinct_students}`,
  );
  rec("the last view is recorded", !!row?.last_viewed_at, String(row?.last_viewed_at));
  const foreignStats = await json(
    tB_or(tA),
    `resource_engagement?select=resource_id&resource_id=eq.${foreign}`,
  );
  rec(
    "a teacher sees no aggregate for another group's resource",
    (foreignStats.body ?? []).length === 0,
    JSON.stringify(foreignStats.body),
  );
  const studentStats = await json(
    sTok,
    `resource_engagement?select=resource_id&resource_id=eq.${rNow}`,
  );
  rec(
    "a student cannot read engagement figures at all",
    (studentStats.body ?? []).length === 0,
    JSON.stringify(studentStats.body),
  );
  const adminStats = await json(
    aTok,
    `resource_engagement?select=resource_id&resource_id=eq.${rNow}`,
  );
  rec("an admin can", (adminStats.body ?? []).length === 1, JSON.stringify(adminStats.body));
} finally {
  await sql(`delete from public.notifications
              where params ? 'resourceId' or params ? 'chapterId';`);
  await sql(`delete from public.resources where title like 'p4-%';`);
  await sql(`delete from public.chapters where title like 'p4-%';`);
  for (const g of originals) {
    await sql(
      `update public.groups set teacher_id=${g.teacher_id ? `'${g.teacher_id}'` : "null"} where id='${g.id}';`,
    );
  }
  await fx.cleanup();
}

function tB_or(fallback) {
  return fallback;
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
