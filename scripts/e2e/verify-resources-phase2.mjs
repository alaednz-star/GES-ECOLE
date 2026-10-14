/**
 * Phase 2 verification -- the GROUP -> SUBJECT -> CHAPTER -> ROLE hierarchy, tested
 * against the API with real tokens for four roles.
 *
 * Phase 2 is mostly a UX change, so most of what could go wrong is either a data
 * shape the UI depends on (does `role` survive a round trip? does the chapter query
 * really return one group's chapters?) or a security assumption the new cascade
 * leans on (can a teacher reach a colleague's chapter at all?). Both are checked
 * here; `verify-resources-phase2-ui.mjs` covers what only a browser can show.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase2.mjs
 */
import { sql, API, PUBLISHABLE_KEY, TEST_PASSWORD, withFixtures } from "./fixtures.mjs";

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
/** Creates a resource exactly as the client does: chapter_id decides, group_id is a
 *  placeholder the trigger overwrites. */
const createResource = (tok, chapterId, extra = {}) =>
  asUser(tok, "resources", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      {
        chapter_id: chapterId,
        group_id: "00000000-0000-0000-0000-000000000000",
        title: extra.title ?? "p2-resource",
        kind: "link",
        url: "https://example.test/p2",
        // `is_published` defaults to false in the schema, so a fixture that wants
        // the student to see it has to say so -- the same as the dialog does.
        is_published: true,
        ...extra,
      },
    ]),
  });

/* ---------------- fixtures: two teachers with a group each, admin, student ----- */
const fx = await withFixtures({ teacher: true, student: true, admin: true });
const other = await withFixtures({ teacher: true });

/** Two groups with DIFFERENT owners: the whole point is that one cannot reach the
 *  other. Distinct subjects so the derived-subject checks mean something. */
const pickGroup = async (teacherId, subjectKey, name) => {
  const subject = (await sql(`select id, name from public.subjects where key='${subjectKey}';`))[0];
  const g = (
    await sql(
      `select id from public.groups where subject_id='${subject.id}' order by name limit 1;`,
    )
  )[0];
  if (!g) throw new Error(`no group for subject ${subjectKey}`);
  await sql(`insert into public.teacher_subjects (teacher_id, subject_id)
             values ('${teacherId}','${subject.id}') on conflict do nothing;`);
  await sql(`update public.groups set teacher_id='${teacherId}' where id='${g.id}';`);
  return { id: g.id, subjectId: subject.id, subjectName: subject.name, name };
};

const originals = await sql(`select id, teacher_id from public.groups;`);
const gA = await pickGroup(fx.teacher.id, "mathematics", "A");
const gB = await pickGroup(other.teacher.id, "physics", "B");

const chapterIn = async (groupId, title) =>
  (
    await sql(`insert into public.chapters (group_id, title, position, is_published)
               values ('${groupId}','${title}', 1, true) returning id;`)
  )[0].id;

const chA = await chapterIn(gA.id, "p2-chapter-A");
const chB = await chapterIn(gB.id, "p2-chapter-B");

// Enrol the student in group A only.
await sql(`update public.students set gender=coalesce(gender,'male'),
             date_of_birth=coalesce(date_of_birth,'2008-05-14'),
             guardian_name=coalesce(guardian_name,'Parent Fixture'),
             guardian_phone=coalesce(guardian_phone,'0661000000'),
             level_id=(select level_id from public.groups where id='${gA.id}'),
             stream_id=(select stream_id from public.groups where id='${gA.id}'),
             onboarded_at=now()
           where id='${fx.student.id}';`);
await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
           values ('${fx.student.id}','${gA.id}','approved',now())
           on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);

const tA = await signIn(fx.teacher.email);
const tB = await signIn(other.teacher.email);
const sTok = await signIn(fx.student.email);
const aTok = await signIn(fx.admin.email);

try {
  console.log("\n--- the hierarchy: GROUP -> SUBJECT -> CHAPTER ---");
  const grp = await json(
    tA,
    `groups?select=id,name,subject_id,subjects(name),teacher_id&id=eq.${gA.id}`,
  );
  rec(
    "a group carries its own subject (no copy on the chapter)",
    grp.body?.[0]?.subjects?.name === gA.subjectName,
    JSON.stringify(grp.body?.[0]?.subjects),
  );
  const chapCols = await sql(`select column_name from information_schema.columns
                               where table_schema='public' and table_name='chapters';`);
  const names = chapCols.map((c) => c.column_name);
  rec(
    "chapters still have NO subject_id or teacher_id of their own",
    !names.includes("subject_id") && !names.includes("teacher_id"),
    names.join(","),
  );
  const resCols = await sql(`select column_name from information_schema.columns
                              where table_schema='public' and table_name='resources';`);
  const rnames = resCols.map((c) => c.column_name);
  rec(
    "resources still have NO subject_id or teacher_id of their own",
    !rnames.includes("subject_id") && !rnames.includes("teacher_id"),
  );
  const teacherEmbed = await json(
    tA,
    `chapters?select=id,groups!inner(name,teachers(profiles(full_name)))&id=eq.${chA}`,
  );
  rec(
    "the teacher name resolves through groups -> teachers -> profiles",
    typeof teacherEmbed.body?.[0]?.groups?.teachers?.profiles?.full_name === "string",
    JSON.stringify(teacherEmbed.body?.[0]?.groups),
  );

  console.log("\n--- the chapter selector is scoped to ONE group ---");
  const chaptersA = await json(tA, `chapters?select=id,group_id&group_id=eq.${gA.id}`);
  rec(
    "chapters-by-group returns only that group's chapters",
    Array.isArray(chaptersA.body) &&
      chaptersA.body.length > 0 &&
      chaptersA.body.every((c) => c.group_id === gA.id),
    JSON.stringify(chaptersA.body).slice(0, 120),
  );
  const chaptersB = await json(tA, `chapters?select=id&group_id=eq.${gB.id}`);
  rec(
    "teacher A cannot even LIST teacher B's chapters",
    Array.isArray(chaptersB.body) && chaptersB.body.length === 0,
    JSON.stringify(chaptersB.body),
  );
  const chapterById = await json(tA, `chapters?select=id&id=eq.${chB}`);
  rec(
    "...nor reach one by id",
    Array.isArray(chapterById.body) && chapterById.body.length === 0,
    JSON.stringify(chapterById.body),
  );

  console.log("\n--- cross-group creation is refused by the database ---");
  const cross = await createResource(tA, chB, { title: "p2-cross-group" });
  rec(
    "teacher A cannot create a resource in teacher B's chapter",
    !cross.ok,
    `HTTP ${cross.status}`,
  );
  const own = await createResource(tA, chA, { title: "p2-own" });
  rec("teacher A CAN create in their own chapter", own.ok, `HTTP ${own.status}`);
  const derived = await sql(`select group_id from public.resources where title='p2-own';`);
  rec(
    "group_id is derived from the chapter, never from the client",
    derived[0]?.group_id === gA.id,
    `${derived[0]?.group_id} (sent a zero uuid)`,
  );
  const adminAny = await createResource(aTok, chB, { title: "p2-admin-any" });
  rec("admin can create in any group", adminAny.ok, `HTTP ${adminAny.status}`);
  const studentCreate = await createResource(sTok, chA, { title: "p2-student" });
  rec("student cannot create a resource", !studentCreate.ok, `HTTP ${studentCreate.status}`);

  console.log("\n--- the pedagogical role ---");
  const roles = ["notes", "exercises", "solutions", "video", "homework", "extra"];
  let accepted = 0;
  for (const role of roles) {
    const r = await createResource(tA, chA, { title: `p2-role-${role}`, role });
    if (r.ok) accepted += 1;
  }
  rec(`all six role values are accepted`, accepted === 6, `${accepted}/6`);
  const stored = await sql(`select role::text, count(*) c from public.resources
                             where title like 'p2-role-%' group by 1 order by 1;`);
  rec(
    "every role round-trips to the value that was sent",
    stored.length === 6 && stored.every((r) => Number(r.c) === 1),
    stored.map((r) => r.role).join(","),
  );
  const readBack = await json(tA, `resources?select=title,role&title=eq.p2-role-solutions`);
  rec(
    "role comes back on a normal resource read",
    readBack.body?.[0]?.role === "solutions",
    JSON.stringify(readBack.body),
  );
  const defaulted = await sql(`select role::text from public.resources where title='p2-own';`);
  rec(
    "a resource created without a role defaults to extra",
    defaulted[0]?.role === "extra",
    String(defaulted[0]?.role),
  );
  const bad = await createResource(tA, chA, { title: "p2-bad-role", role: "quiz" });
  rec("an unknown role is refused by the enum", !bad.ok, `HTTP ${bad.status}`);

  console.log("\n--- ordering: manual position wins, role breaks ties ---");
  // Two resources at the SAME position, roles out of pedagogical order.
  await sql(`update public.resources set position = 5
              where title in ('p2-role-solutions','p2-role-notes');`);
  const tied = await sql(`select title, position, public.resource_role_weight(role) w
                            from public.resources
                           where title in ('p2-role-solutions','p2-role-notes')
                           order by position, w;`);
  rec(
    "at equal positions the role decides (notes before solutions)",
    tied[0]?.title === "p2-role-notes",
    tied.map((r) => `${r.title}@${r.position}/w${r.w}`).join(" "),
  );
  // Now give solutions an EARLIER manual position: the teacher's choice must win.
  await sql(`update public.resources set position = 1 where title='p2-role-solutions';`);
  const manual = await sql(`select title from public.resources
                             where title in ('p2-role-solutions','p2-role-notes')
                             order by position, public.resource_role_weight(role);`);
  rec(
    "a manual position overrides the role order",
    manual[0]?.title === "p2-role-solutions",
    manual.map((r) => r.title).join(" -> "),
  );

  console.log("\n--- the student still sees only their own course ---");
  const mine = await json(sTok, `resources?select=title,group_id,role`);
  const visible = Array.isArray(mine.body) ? mine.body : [];
  rec(
    "student sees resources from their enrolled group",
    visible.length > 0 && visible.every((r) => r.group_id === gA.id),
    `${visible.length} rows, groups ${[...new Set(visible.map((r) => r.group_id))].length}`,
  );
  rec("student never sees the other group's resources", !visible.some((r) => r.group_id === gB.id));
  rec(
    "the role is part of what the student receives",
    visible.every((r) => typeof r.role === "string"),
  );
  await sql(`update public.resources set is_published=false where title='p2-role-video';`);
  const afterHide = await json(sTok, `resources?select=title&title=eq.p2-role-video`);
  rec(
    "a hidden resource disappears for the student",
    Array.isArray(afterHide.body) && afterHide.body.length === 0,
    JSON.stringify(afterHide.body),
  );
  await sql(`update public.resources set is_published=true,
               published_at = now() + interval '2 days' where title='p2-role-video';`);
  const afterSchedule = await json(sTok, `resources?select=title&title=eq.p2-role-video`);
  rec(
    "a scheduled resource stays hidden until its date",
    Array.isArray(afterSchedule.body) && afterSchedule.body.length === 0,
    JSON.stringify(afterSchedule.body),
  );

  console.log("\n--- Phase 1 security is untouched ---");
  const rid = (await sql(`select id from public.resources where title='p2-role-notes';`))[0].id;
  await sql(`update public.resources set allow_download=false where id='${rid}';`);
  const rpc = async (tok, fn, args) => {
    const r = await asUser(tok, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    return r.json().catch(() => null);
  };
  rec(
    "allow_download=false still refuses a download URL",
    (await rpc(sTok, "can_download_resource", { _resource_id: rid })) === false,
  );
  rec(
    "...while preview is still allowed",
    (await rpc(sTok, "can_view_resource", { _resource_id: rid })) === true,
  );
  rec(
    "teacher A cannot view a resource in teacher B's group",
    (await rpc(tA, "can_view_resource", {
      _resource_id: (await sql(`select id from public.resources where title='p2-admin-any';`))[0]
        .id,
    })) === false,
  );

  console.log("\n--- events still record, per student ---");
  const ev = await asUser(sTok, "resource_events", {
    method: "POST",
    body: JSON.stringify([{ resource_id: rid, student_id: fx.student.id, kind: "view" }]),
  });
  rec("student records a view", ev.ok, `HTTP ${ev.status}`);
  const mineEvents = await sql(`select count(*)::int c from public.resource_events
                                 where resource_id='${rid}' and student_id='${fx.student.id}';`);
  rec("the view is attributed to that student", mineEvents[0].c >= 1, `${mineEvents[0].c}`);
  const staffEv = await asUser(tA, "resource_events", {
    method: "POST",
    body: JSON.stringify([{ resource_id: rid, student_id: fx.teacher.id, kind: "view" }]),
  });
  rec("staff activity still cannot enter the log", !staffEv.ok, `HTTP ${staffEv.status}`);
} finally {
  await sql(`delete from public.resources where title like 'p2-%';`);
  await sql(`delete from public.chapters where title like 'p2-chapter-%';`);
  // Restore every group's original teacher: the fixtures reassigned two of them.
  for (const g of originals) {
    await sql(
      `update public.groups set teacher_id=${g.teacher_id ? `'${g.teacher_id}'` : "null"} where id='${g.id}';`,
    );
  }
  await fx.cleanup();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
