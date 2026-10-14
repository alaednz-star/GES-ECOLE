/**
 * Phase 1 verification -- schema, RLS, storage authorisation and the event log,
 * exercised directly against the API with real tokens for four roles rather than
 * through the UI. `verify-resources-phase1-ui.mjs` covers the browser half.
 *
 * RUN ALONE, and note the teardown rule in `fixtures.mjs`: `cleanup()` is global,
 * so it happens once, in `finally`. An earlier draft of this suite cleaned up a
 * secondary fixture mid-run, which deleted its own enrolled student and made every
 * subsequent authorisation check fail -- correctly, but for a reason that looked
 * exactly like a broken RLS policy.
 *
 *   node scripts/e2e/verify-resources-phase1.mjs           # clean up afterwards
 *   node scripts/e2e/verify-resources-phase1.mjs --keep    # leave the fixture in
 *                                                          # place to probe by hand
 */
import { sql, API, PUBLISHABLE_KEY, TEST_PASSWORD, withFixtures } from "./fixtures.mjs";

const KEEP = process.argv.includes("--keep");

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
const rpc = async (tok, fn, args) => {
  const r = await asUser(tok, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  return { status: r.status, value: await r.json().catch(() => null) };
};
const event = (tok, row) =>
  asUser(tok, "resource_events", { method: "POST", body: JSON.stringify([row]) });

/* ---------------- fixtures: two teachers, an admin, one enrolled student ------ */
const fx = await withFixtures({ teacher: true, student: true, admin: true });
const other = await withFixtures({ teacher: true });

const gid = (
  await sql(
    `select group_id from public.chapters group by group_id order by count(*) desc limit 1;`,
  )
)[0].group_id;
const originalTeacher = (await sql(`select teacher_id from public.groups where id='${gid}';`))[0]
  .teacher_id;
const subj = (await sql(`select subject_id from public.groups where id='${gid}';`))[0].subject_id;

await sql(`insert into public.teacher_subjects (teacher_id, subject_id)
           values ('${fx.teacher.id}','${subj}') on conflict do nothing;`);
await sql(`update public.groups set teacher_id='${fx.teacher.id}' where id='${gid}';`);
await sql(`update public.students set gender=coalesce(gender,'male'),
             date_of_birth=coalesce(date_of_birth,'2008-05-14'),
             guardian_name=coalesce(guardian_name,'Parent Fixture'),
             guardian_phone=coalesce(guardian_phone,'0661000000'),
             level_id=(select level_id from public.groups where id='${gid}'),
             stream_id=(select stream_id from public.groups where id='${gid}'),
             onboarded_at=now()
           where id='${fx.student.id}';`);
await sql(`insert into public.registrations (student_id,group_id,status,decided_at)
           values ('${fx.student.id}','${gid}','approved',now())
           on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);

// A published+downloadable, a published+NO-download, a hidden and a scheduled resource.
const ch = (
  await sql(`select id from public.chapters where group_id='${gid}' order by position limit 1;`)
)[0].id;
const mk = async (title, opts) =>
  (
    await sql(
      `insert into public.resources (chapter_id, group_id, title, kind, storage_path, mime_type, size_bytes,
         allow_download, is_published, published_at, role, created_by)
       values ('${ch}','${gid}','${title}','file','${gid}/x/${title}.pdf','application/pdf',1000,
         ${opts.dl}, ${opts.pub}, ${opts.when ? `'${opts.when}'` : "null"}, '${opts.role ?? "extra"}', '${fx.teacher.id}')
       returning id;`,
    )
  )[0].id;
const rOk = await mk("p1-downloadable", { dl: true, pub: true });
const rNoDl = await mk("p1-nodownload", { dl: false, pub: true });
const rHidden = await mk("p1-hidden", { dl: true, pub: false });
const rSched = await mk("p1-scheduled", {
  dl: true,
  pub: true,
  when: new Date(Date.now() + 864e5).toISOString(),
});

const tTok = await signIn(fx.teacher.email);
const sTok = await signIn(fx.student.email);
const oTok = await signIn(other.teacher.email);
const aTok = await signIn(fx.admin.email);

try {
  console.log("\n--- schema & data integrity ---");
  const cols = await sql(`select column_name from information_schema.columns
                           where table_schema='public' and table_name='resources';`);
  const have = new Set(cols.map((c) => c.column_name));
  rec(
    "resources gained role/pinned/file_name/file_ext/link_provider/link_thumbnail_url",
    ["role", "pinned", "file_name", "file_ext", "link_provider", "link_thumbnail_url"].every((c) =>
      have.has(c),
    ),
  );
  rec("is_important is retired; pinned is the only importance flag", !have.has("is_important"));
  const cc = await sql(`select column_name from information_schema.columns
                         where table_schema='public' and table_name='chapters';`);
  const chave = new Set(cc.map((c) => c.column_name));
  rec(
    "chapters gained pinned/is_published/published_at",
    ["pinned", "is_published", "published_at"].every((c) => chave.has(c)),
  );
  const uq = await sql(`select count(*)::int c from pg_constraint
                         where conrelid='public.resource_events'::regclass and contype='u';`);
  rec(
    "resource_events is append-only (UNIQUE dropped)",
    uq[0].c === 0,
    `${uq[0].c} unique constraints`,
  );
  const wpol = await sql(`select count(*)::int c from pg_policy
                           where polrelid='public.resource_events'::regclass and polcmd in ('w','d');`);
  rec("resource_events has no update/delete policy", wpol[0].c === 0, `${wpol[0].c} policies`);
  const openLeft = await sql(
    `select count(*)::int c from public.resource_events where kind='open';`,
  );
  rec("no retired `open` events remain", openLeft[0].c === 0);
  const roleNull = await sql(`select count(*)::int c from public.resources where role is null;`);
  rec("every resource has a pedagogical role", roleNull[0].c === 0);
  const fnames = await sql(`select count(*)::int c from public.resources
                             where kind='file' and file_name is null;`);
  rec("file_name backfilled for every stored file", fnames[0].c === 0);
  const bucket = await sql(`select file_size_limit, array_length(allowed_mime_types,1) n
                             from storage.buckets where id='course-resources';`);
  rec(
    "bucket per-file limit is 250 MB",
    Number(bucket[0].file_size_limit) === 262144000,
    `${bucket[0].file_size_limit}`,
  );
  rec("bucket accepts the widened MIME list", Number(bucket[0].n) >= 28, `${bucket[0].n} types`);
  const quota = await sql(`select public.center_storage_quota_bytes() v;`);
  rec("centre quota is 5 GB", Number(quota[0].v) === 5 * 1024 ** 3, `${quota[0].v}`);

  console.log("\n--- allow_download is decided by the database ---");
  let x = await rpc(sTok, "can_download_resource", { _resource_id: rOk });
  rec("student CAN download an allowed resource", x.value === true, JSON.stringify(x));
  x = await rpc(sTok, "can_download_resource", { _resource_id: rNoDl });
  rec("student CANNOT download when allow_download=false", x.value === false, JSON.stringify(x));
  x = await rpc(sTok, "can_view_resource", { _resource_id: rNoDl });
  rec("...but CAN still view it (preview unaffected)", x.value === true, JSON.stringify(x));
  x = await rpc(tTok, "can_download_resource", { _resource_id: rNoDl });
  rec("owning TEACHER may download regardless", x.value === true, JSON.stringify(x));
  x = await rpc(aTok, "can_download_resource", { _resource_id: rNoDl });
  rec("ADMIN may download regardless", x.value === true, JSON.stringify(x));
  x = await rpc(oTok, "can_download_resource", { _resource_id: rOk });
  rec("unrelated teacher may NOT download", x.value === false, JSON.stringify(x));

  console.log("\n--- visibility ---");
  x = await rpc(sTok, "can_view_resource", { _resource_id: rHidden });
  rec("student cannot view a HIDDEN resource", x.value === false, JSON.stringify(x));
  x = await rpc(sTok, "can_view_resource", { _resource_id: rSched });
  rec(
    "student cannot view a SCHEDULED resource before publishAt",
    x.value === false,
    JSON.stringify(x),
  );
  x = await rpc(sTok, "can_download_resource", { _resource_id: rHidden });
  rec("student cannot download a HIDDEN resource", x.value === false, JSON.stringify(x));

  console.log("\n--- chapter publication gates its resources (AND rule) ---");
  await sql(`update public.chapters set is_published=false where id='${ch}';`);
  x = await rpc(sTok, "can_view_resource", { _resource_id: rOk });
  rec("hiding the CHAPTER hides a published resource", x.value === false, JSON.stringify(x));
  const list = await (await asUser(sTok, `resources?select=id&id=eq.${rOk}`)).json();
  rec(
    "...and RLS stops listing it",
    Array.isArray(list) && list.length === 0,
    JSON.stringify(list),
  );
  const chList = await (await asUser(sTok, `chapters?select=id&id=eq.${ch}`)).json();
  rec("...and the chapter itself is not listed", Array.isArray(chList) && chList.length === 0);
  const evHiddenChapter = await event(sTok, {
    resource_id: rOk,
    student_id: fx.student.id,
    kind: "view",
  });
  rec(
    "...and no event can be logged against it",
    !evHiddenChapter.ok,
    `HTTP ${evHiddenChapter.status}`,
  );
  await sql(`update public.chapters set is_published=true where id='${ch}';`);
  x = await rpc(sTok, "can_view_resource", { _resource_id: rOk });
  rec("re-publishing the chapter restores access", x.value === true, JSON.stringify(x));

  console.log("\n--- RLS: cross-group and write attempts ---");
  x = await rpc(oTok, "can_view_resource", { _resource_id: rOk });
  rec("a teacher of another group cannot view", x.value === false, JSON.stringify(x));
  const w = await asUser(sTok, "resources", {
    method: "POST",
    body: JSON.stringify([
      { chapter_id: ch, group_id: gid, title: "hack", kind: "link", url: "https://x.test" },
    ]),
  });
  rec("student CANNOT create a resource", !w.ok, `HTTP ${w.status}`);
  const wc = await asUser(sTok, "chapters", {
    method: "POST",
    body: JSON.stringify([{ group_id: gid, title: "hack" }]),
  });
  rec("student CANNOT create a chapter", !wc.ok, `HTTP ${wc.status}`);
  await asUser(oTok, `resources?id=eq.${rOk}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "stolen" }),
  });
  const stillOk = (await sql(`select title from public.resources where id='${rOk}';`))[0].title;
  rec(
    "unauthorised teacher cannot modify another's resource",
    stillOk === "p1-downloadable",
    `title=${stillOk}`,
  );

  console.log("\n--- the event log: students write, staff do not ---");
  const ev1 = await event(sTok, { resource_id: rOk, student_id: fx.student.id, kind: "view" });
  rec("student CAN record a view", ev1.ok, `HTTP ${ev1.status}`);
  for (let i = 0; i < 2; i++) {
    await event(sTok, { resource_id: rOk, student_id: fx.student.id, kind: "view" });
  }
  const views = await sql(`select count(*)::int c from public.resource_events
                            where resource_id='${rOk}' and kind='view';`);
  rec("repeated views are all recorded (append-only)", views[0].c === 3, `${views[0].c} rows`);
  const dl = await event(sTok, { resource_id: rOk, student_id: fx.student.id, kind: "download" });
  rec("student CAN record a download they are allowed", dl.ok, `HTTP ${dl.status}`);
  const dlDenied = await event(sTok, {
    resource_id: rNoDl,
    student_id: fx.student.id,
    kind: "download",
  });
  rec(
    "student CANNOT record a download when allow_download=false",
    !dlDenied.ok,
    `HTTP ${dlDenied.status}`,
  );
  const viewNoDl = await event(sTok, {
    resource_id: rNoDl,
    student_id: fx.student.id,
    kind: "view",
  });
  rec("...but CAN record a view of it", viewNoDl.ok, `HTTP ${viewNoDl.status}`);
  const evHidden = await event(sTok, {
    resource_id: rHidden,
    student_id: fx.student.id,
    kind: "view",
  });
  rec(
    "student CANNOT record an event for a hidden resource",
    !evHidden.ok,
    `HTTP ${evHidden.status}`,
  );
  const forge = await event(sTok, { resource_id: rOk, student_id: other.teacher.id, kind: "view" });
  rec("student cannot forge another user's event", !forge.ok, `HTTP ${forge.status}`);
  const staffEv = await event(tTok, { resource_id: rOk, student_id: fx.teacher.id, kind: "view" });
  rec("teacher cannot write an event (no stat pollution)", !staffEv.ok, `HTTP ${staffEv.status}`);
  const mine = await (
    await asUser(sTok, `resource_events?select=id&resource_id=eq.${rOk}&kind=eq.view&limit=1`)
  ).json();
  const evId = Array.isArray(mine) && mine[0] ? mine[0].id : null;
  rec(
    "student can read their own events (progress)",
    evId !== null,
    JSON.stringify(mine).slice(0, 80),
  );
  const upd = await asUser(sTok, `resource_events?id=eq.${evId}`, {
    method: "PATCH",
    body: JSON.stringify({ kind: "download" }),
  });
  const kindAfter = (await sql(`select kind from public.resource_events where id='${evId}';`))[0]
    .kind;
  rec(
    "student cannot rewrite a view into a download",
    kindAfter === "view",
    `HTTP ${upd.status}, kind=${kindAfter}`,
  );
  const del = await asUser(sTok, `resource_events?id=eq.${evId}`, { method: "DELETE" });
  const stillThere = await sql(
    `select count(*)::int c from public.resource_events where id='${evId}';`,
  );
  rec("student cannot delete an event", stillThere[0].c === 1, `HTTP ${del.status}`);

  console.log("\n--- quota ---");
  const before = Number((await sql(`select public.center_storage_bytes() v;`))[0].v);
  const q = await rpc(tTok, "storage_quota_allows", { _incoming: 1000 });
  rec("small upload allowed by quota", q.value === true, JSON.stringify(q));
  const q2 = await rpc(tTok, "storage_quota_allows", { _incoming: 6 * 1024 ** 3 });
  rec("6 GB upload refused by quota", q2.value === false, JSON.stringify(q2));
  await sql(`insert into public.resources (chapter_id, group_id, title, kind, url, created_by)
             values ('${ch}','${gid}','p1-link','link','https://example.test/x','${fx.teacher.id}');`);
  const after = Number((await sql(`select public.center_storage_bytes() v;`))[0].v);
  rec("external links consume no storage", after === before, `${before} -> ${after} bytes`);
} finally {
  await sql(`delete from public.resources where title like 'p1-%';`);
  await sql(
    `update public.groups set teacher_id=${originalTeacher ? `'${originalTeacher}'` : "null"} where id='${gid}';`,
  );
  if (KEEP) {
    console.log(`\n(--keep) fixture left in place: student ${fx.student.email}`);
  } else {
    // Global teardown, exactly once, at the end. See fixtures.mjs.
    await fx.cleanup();
  }
}
const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
