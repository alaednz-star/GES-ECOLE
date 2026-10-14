/**
 * Phase 3 verification -- chapter management, publication, ordering, pinning,
 * duplication and bulk actions, against the API with real tokens for four roles.
 *
 * Phase 3 adds operations that MOVE and DELETE things, so the interesting questions
 * are not "does the button work" but "what happens to the resources", "can this reach
 * another teacher's course", and "does the publication rule still hold after all
 * this". Those are the checks below.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase3.mjs
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
const patch = (tok, path, body) =>
  asUser(tok, path, { method: "PATCH", body: JSON.stringify(body) });
const post = (tok, path, body) =>
  asUser(tok, path, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });

/* ---------------- fixtures: two teachers with a group each ---------------- */
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

const mkChapter = async (groupId, title, position, published = true) =>
  (
    await sql(`insert into public.chapters (group_id, title, position, is_published)
               values ('${groupId}','${title}',${position},${published}) returning id;`)
  )[0].id;

const mkResource = async (chapterId, title, role, position, published = true) =>
  (
    await sql(`insert into public.resources
                 (chapter_id, group_id, title, kind, url, role, position, is_published)
               values ('${chapterId}','00000000-0000-0000-0000-000000000000','${title}','link',
                       'https://example.test/${role}','${role}',${position},${published})
               returning id;`)
  )[0].id;

// Enrol the student in group A only.
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

const tA = await signIn(fx.teacher.email);
const tB = await signIn(other.teacher.email);
const sTok = await signIn(fx.student.email);
const aTok = await signIn(fx.admin.email);

try {
  console.log("\n--- chapter lifecycle ---");
  const created = await post(tA, "chapters", [
    { group_id: gA, title: "p3-chapter-one", position: 1, is_published: true },
  ]);
  const createdBody = await created.json().catch(() => []);
  const ch1 = Array.isArray(createdBody) ? createdBody[0]?.id : undefined;
  rec(
    "teacher creates a chapter in their own group",
    created.ok && !!ch1,
    `HTTP ${created.status} ${JSON.stringify(createdBody).slice(0, 200)}`,
  );
  if (!ch1) throw new Error("cannot continue without a chapter");

  const renamed = await patch(tA, `chapters?id=eq.${ch1}`, { title: "p3-chapter-renamed" });
  const afterRename = await sql(`select title from public.chapters where id='${ch1}';`);
  rec("teacher renames it", renamed.ok && afterRename[0]?.title === "p3-chapter-renamed");

  const pinned = await patch(tA, `chapters?id=eq.${ch1}`, { pinned: true });
  const afterPin = await sql(`select pinned from public.chapters where id='${ch1}';`);
  rec("teacher pins it", pinned.ok && afterPin[0]?.pinned === true);

  const hidden = await patch(tA, `chapters?id=eq.${ch1}`, { is_published: false });
  const afterHide = await sql(`select is_published from public.chapters where id='${ch1}';`);
  rec("teacher hides it", hidden.ok && afterHide[0]?.is_published === false);
  await patch(tA, `chapters?id=eq.${ch1}`, { is_published: true, published_at: null });

  const ch2 = await mkChapter(gA, "p3-chapter-two", 2);
  const ch3 = await mkChapter(gA, "p3-chapter-three", 3);
  const reorder = await patch(tA, `chapters?id=eq.${ch3}`, { position: 0 });
  const order = await sql(`select title from public.chapters
                            where group_id='${gA}' and title like 'p3-chapter%'
                            order by pinned desc, position, title;`);
  rec(
    "chapter order persists, pinned first",
    reorder.ok &&
      order[0]?.title === "p3-chapter-renamed" &&
      order[1]?.title === "p3-chapter-three",
    order.map((r) => r.title).join(" -> "),
  );
  const positions = await sql(`select count(distinct position)::int d, count(*)::int c
                                from public.chapters where group_id='${gA}' and title like 'p3-chapter%';`);
  rec(
    "no two chapters share a position",
    positions[0].d === positions[0].c,
    JSON.stringify(positions[0]),
  );

  console.log("\n--- resources: publication, ordering, pinning ---");
  const rNotes = await mkResource(ch1, "p3-notes", "notes", 0);
  const rEx = await mkResource(ch1, "p3-exercises", "exercises", 1);
  const rSol = await mkResource(ch1, "p3-solutions", "solutions", 2);
  const rVid = await mkResource(ch1, "p3-video", "video", 3);

  const pinRes = await patch(tA, `resources?id=eq.${rNotes}`, { pinned: true });
  rec("teacher pins a resource", pinRes.ok);
  const manual = await patch(tA, `resources?id=eq.${rSol}`, { position: -1 });
  const resOrder = await sql(`select title from public.resources where chapter_id='${ch1}'
                               order by position, public.resource_role_weight(role), created_at;`);
  rec(
    "manual order beats the role order",
    manual.ok && resOrder[0]?.title === "p3-solutions",
    resOrder.map((r) => r.title).join(" -> "),
  );
  const changeRole = await patch(tA, `resources?id=eq.${rSol}`, { role: "extra" });
  const afterRoleChange = await sql(`select title, position from public.resources
                                      where chapter_id='${ch1}' order by position limit 1;`);
  rec(
    "changing a role does NOT reorder anything",
    changeRole.ok && afterRoleChange[0]?.title === "p3-solutions",
    JSON.stringify(afterRoleChange[0]),
  );
  await patch(tA, `resources?id=eq.${rSol}`, { role: "solutions" });

  console.log("\n--- bulk publish / hide ---");
  const bulkHide = await patch(tA, `resources?id=in.(${rEx},${rVid})`, { is_published: false });
  const hiddenCount = await sql(`select count(*)::int c from public.resources
                                  where id in ('${rEx}','${rVid}') and is_published = false;`);
  rec(
    "bulk hide applies to every selected row",
    bulkHide.ok && hiddenCount[0].c === 2,
    `${hiddenCount[0].c}/2`,
  );
  const bulkPublish = await patch(tA, `resources?id=in.(${rEx},${rVid})`, {
    is_published: true,
    published_at: null,
  });
  const publishedCount = await sql(`select count(*)::int c from public.resources
                                     where id in ('${rEx}','${rVid}')
                                       and is_published and published_at is null;`);
  rec(
    "bulk publish clears any pending schedule",
    bulkPublish.ok && publishedCount[0].c === 2,
    `${publishedCount[0].c}/2`,
  );

  console.log("\n--- bulk move validates the destination ---");
  const moveOk = await patch(tA, `resources?id=in.(${rVid})`, { chapter_id: ch2 });
  const moved = await sql(`select chapter_id, group_id from public.resources where id='${rVid}';`);
  rec(
    "a move within the group lands in the target chapter",
    moveOk.ok && moved[0]?.chapter_id === ch2 && moved[0]?.group_id === gA,
    JSON.stringify(moved[0]),
  );
  const chForeign = await mkChapter(gB, "p3-foreign-chapter", 1);
  const moveCross = await patch(tA, `resources?id=in.(${rVid})`, { chapter_id: chForeign });
  const afterCross = await sql(`select chapter_id from public.resources where id='${rVid}';`);
  rec(
    "teacher A cannot move a resource into teacher B's chapter",
    afterCross[0]?.chapter_id === ch2,
    `HTTP ${moveCross.status}, chapter=${afterCross[0]?.chapter_id === ch2 ? "unchanged" : "MOVED"}`,
  );

  console.log("\n--- bulk delete ---");
  const throwaway = await mkResource(ch1, "p3-throwaway", "extra", 9);
  const del = await asUser(tA, `resources?id=in.(${throwaway})`, { method: "DELETE" });
  const gone = await sql(`select count(*)::int c from public.resources where id='${throwaway}';`);
  rec("bulk delete removes the selected rows", del.ok && gone[0].c === 0);
  const foreignRes = await mkResource(chForeign, "p3-foreign-res", "notes", 0);
  await asUser(tA, `resources?id=in.(${foreignRes})`, { method: "DELETE" });
  const survived = await sql(
    `select count(*)::int c from public.resources where id='${foreignRes}';`,
  );
  rec("teacher A cannot delete teacher B's resource", survived[0].c === 1, `${survived[0].c}`);

  console.log("\n--- duplication ---");
  // A duplicate is a new row in the same chapter, hidden, with no history.
  const dupSource = await sql(`select * from public.resources where id='${rNotes}';`);
  const dup = await post(tA, "resources", [
    {
      chapter_id: ch1,
      group_id: "00000000-0000-0000-0000-000000000000",
      title: "p3-notes (copie)",
      kind: dupSource[0].kind,
      url: dupSource[0].url,
      role: dupSource[0].role,
      pinned: false,
      allow_download: dupSource[0].allow_download,
      is_published: false,
    },
  ]);
  const dupId = (await dup.json().catch(() => []))[0]?.id;
  rec("a duplicate is created", dup.ok && !!dupId, `HTTP ${dup.status}`);
  rec("the duplicate has its own id", dupId !== rNotes);
  const dupRow = await sql(
    `select is_published, group_id, pinned from public.resources where id='${dupId}';`,
  );
  rec(
    "the duplicate starts hidden, unpinned, in the same group",
    dupRow[0]?.is_published === false && dupRow[0]?.group_id === gA && dupRow[0]?.pinned === false,
    JSON.stringify(dupRow[0]),
  );
  await asUser(sTok, "resource_events", {
    method: "POST",
    body: JSON.stringify([{ resource_id: rNotes, student_id: fx.student.id, kind: "view" }]),
  });
  const dupEvents = await sql(
    `select count(*)::int c from public.resource_events where resource_id='${dupId}';`,
  );
  rec("the duplicate inherits no view history", dupEvents[0].c === 0, `${dupEvents[0].c} events`);
  const dupCross = await post(tA, "resources", [
    {
      chapter_id: chForeign,
      group_id: "00000000-0000-0000-0000-000000000000",
      title: "p3-cross-dup",
      kind: "link",
      url: "https://example.test/x",
      is_published: false,
    },
  ]);
  rec("teacher A cannot duplicate into teacher B's group", !dupCross.ok, `HTTP ${dupCross.status}`);

  console.log("\n--- chapter delete: cascade vs keep ---");
  const chDoomed = await mkChapter(gA, "p3-doomed", 7);
  const doomedRes = await mkResource(chDoomed, "p3-doomed-res", "notes", 0);
  const unfiled = await post(tA, "chapters", [
    { group_id: gA, title: "Non classé", position: 9999, is_published: false },
  ]);
  const unfiledId = (await unfiled.json().catch(() => []))[0]?.id;
  const reparent = await patch(tA, `resources?chapter_id=eq.${chDoomed}`, {
    chapter_id: unfiledId,
  });
  await asUser(tA, `chapters?id=eq.${chDoomed}`, { method: "DELETE" });
  const kept = await sql(`select chapter_id from public.resources where id='${doomedRes}';`);
  rec(
    "keeping resources reparents them before the chapter goes",
    reparent.ok && kept[0]?.chapter_id === unfiledId,
    JSON.stringify(kept[0]),
  );
  const chDoomed2 = await mkChapter(gA, "p3-doomed-2", 8);
  const cascadeRes = await mkResource(chDoomed2, "p3-cascade-res", "notes", 0);
  await asUser(tA, `chapters?id=eq.${chDoomed2}`, { method: "DELETE" });
  const cascaded = await sql(
    `select count(*)::int c from public.resources where id='${cascadeRes}';`,
  );
  rec("cascading takes the resources with it", cascaded[0].c === 0, `${cascaded[0].c}`);

  console.log("\n--- student visibility after all of it ---");
  const visible = await json(sTok, `resources?select=title,chapter_id`);
  const titles = (Array.isArray(visible.body) ? visible.body : []).map((r) => r.title);
  rec(
    "student sees the published resources of their group",
    titles.includes("p3-notes"),
    titles.join(","),
  );
  rec("student never sees a duplicate (hidden by design)", !titles.includes("p3-notes (copie)"));
  rec("student never sees another group's resource", !titles.includes("p3-foreign-res"));

  await patch(tA, `resources?id=eq.${rEx}`, { is_published: false });
  let after = await json(sTok, `resources?select=title&title=eq.p3-exercises`);
  rec("hiding a resource removes it for the student", (after.body ?? []).length === 0);
  await patch(tA, `resources?id=eq.${rEx}`, {
    is_published: true,
    published_at: new Date(Date.now() + 864e5).toISOString(),
  });
  after = await json(sTok, `resources?select=title&title=eq.p3-exercises`);
  rec("a scheduled resource stays hidden until its time", (after.body ?? []).length === 0);
  const rpc = async (tok, fn, args) => {
    const r = await asUser(tok, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    return r.json().catch(() => null);
  };
  rec(
    "...and no signed URL can be obtained for it either",
    (await rpc(sTok, "can_view_resource", { _resource_id: rEx })) === false,
  );
  await patch(tA, `resources?id=eq.${rEx}`, { is_published: true, published_at: null });

  // The chapter half of the AND rule, after everything above.
  await patch(tA, `chapters?id=eq.${ch1}`, { is_published: false });
  const chapterHidden = await json(sTok, `resources?select=title&chapter_id=eq.${ch1}`);
  rec(
    "hiding the chapter withdraws all of its resources",
    (chapterHidden.body ?? []).length === 0,
    JSON.stringify(chapterHidden.body),
  );
  await patch(tA, `chapters?id=eq.${ch1}`, { is_published: true, published_at: null });
  const restored = await json(sTok, `resources?select=title&chapter_id=eq.${ch1}`);
  rec(
    "...and republishing restores exactly what was published before",
    (restored.body ?? []).length > 0 &&
      !(restored.body ?? []).some((r) => r.title === "p3-notes (copie)"),
    `${(restored.body ?? []).length} rows`,
  );

  console.log("\n--- permissions on the new operations ---");
  rec(
    "teacher A cannot rename teacher B's chapter",
    !(await patch(tA, `chapters?id=eq.${chForeign}`, { title: "hacked" })).ok ||
      (await sql(`select title from public.chapters where id='${chForeign}';`))[0].title ===
        "p3-foreign-chapter",
  );
  rec(
    "teacher A cannot pin teacher B's chapter",
    await sql(`select pinned from public.chapters where id='${chForeign}';`).then(async (r) => {
      await patch(tA, `chapters?id=eq.${chForeign}`, { pinned: true });
      const now = await sql(`select pinned from public.chapters where id='${chForeign}';`);
      return now[0].pinned === r[0].pinned;
    }),
  );
  rec(
    "teacher A cannot publish teacher B's resources",
    await (async () => {
      // Start from hidden, so "still hidden" actually means the write was refused
      // rather than that it was already in the expected state.
      await sql(`update public.resources set is_published=false where id='${foreignRes}';`);
      const res = await patch(tA, `resources?id=eq.${foreignRes}`, { is_published: true });
      const row = await sql(`select is_published from public.resources where id='${foreignRes}';`);
      return row[0].is_published === false && `HTTP ${res.status}`.length > 0;
    })(),
  );
  rec(
    "teacher A cannot delete teacher B's chapter",
    await (async () => {
      await asUser(tA, `chapters?id=eq.${chForeign}`, { method: "DELETE" });
      const row = await sql(`select count(*)::int c from public.chapters where id='${chForeign}';`);
      return row[0].c === 1;
    })(),
  );
  rec(
    "admin can manage any group's chapter",
    (await patch(aTok, `chapters?id=eq.${chForeign}`, { pinned: true })).ok,
  );
  rec(
    "student cannot create a chapter",
    !(await post(sTok, "chapters", [{ group_id: gA, title: "x" }])).ok,
  );
  rec(
    "student cannot publish a resource",
    await (async () => {
      await patch(sTok, `resources?id=eq.${rSol}`, { is_published: false });
      const row = await sql(`select is_published from public.resources where id='${rSol}';`);
      return row[0].is_published === true;
    })(),
  );
  rec(
    "student cannot move a resource",
    await (async () => {
      await patch(sTok, `resources?id=eq.${rNotes}`, { chapter_id: ch2 });
      const row = await sql(`select chapter_id from public.resources where id='${rNotes}';`);
      return row[0].chapter_id === ch1;
    })(),
  );
  rec(
    "student cannot delete a resource",
    await (async () => {
      await asUser(sTok, `resources?id=eq.${rNotes}`, { method: "DELETE" });
      const row = await sql(`select count(*)::int c from public.resources where id='${rNotes}';`);
      return row[0].c === 1;
    })(),
  );
} finally {
  await sql(`delete from public.resources where title like 'p3-%';`);
  await sql(`delete from public.chapters where title like 'p3-%' or title = 'Non classé';`);
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
