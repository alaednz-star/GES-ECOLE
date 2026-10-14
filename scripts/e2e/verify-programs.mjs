/**
 * Formations (table `programs`) -- schema rules, group association, RLS, atomic creation with a
 * first group (`create_formation`, 20261003110000) and compatibility with existing data, against
 * the LOCAL stack (20261001100000_programs.sql).
 *
 *   node scripts/e2e/verify-programs.mjs
 *
 * RUN ALONE -- fixture cleanup is global and happens once, in `finally`.
 */

import {
  withFixtures,
  cleanupFixtures,
  createGroupFixture,
  sql,
  API,
  PUBLISHABLE_KEY,
  TEST_PASSWORD,
} from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  ok
    ? (pass++, console.log(`PASS  ${name}`))
    : (fail++, console.log(`FAIL  ${name}  -> ${detail}`));
};

const signIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return (await r.json()).access_token;
};

const api = async (token, path, init = {}) => {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return { status: res.status, ok: res.ok, body };
};
const post = (tok, table, row) => api(tok, table, { method: "POST", body: JSON.stringify([row]) });
const patch = (tok, path, fields) =>
  api(tok, path, { method: "PATCH", body: JSON.stringify(fields) });
const del = (tok, path) => api(tok, path, { method: "DELETE" });
const one = async (q) => (await sql(q))[0];

const TAG = "e2e-fixture prog";

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const other = await withFixtures({ teacher: true });

try {
  const admin = await signIn(fx.admin.email);
  const teacher = await signIn(fx.teacher.email);
  const student = await signIn(fx.student.email);
  const foreignTeacher = await signIn(other.teacher.email);

  const group = await createGroupFixture({ teacherId: fx.teacher.id, studentCount: 0 });
  const g = await one(
    `select level_id, subject_id, stream_id from public.groups where id = '${group.id}';`,
  );
  const otherLevel = (
    await one(`select id from public.levels where id <> '${g.level_id}' limit 1;`)
  ).id;
  const physics = (await one(`select id from public.subjects where key = 'physics';`)).id;

  /* ------------------------------------------------------------------ create */
  console.log("\n--- an administrator creates programmes ---");
  const formation = await post(admin, "programs", {
    name: `${TAG} Excel Advanced`,
    category: "professional_training",
    duration_hours: 30,
  });
  check(
    "a formation with no level, subject or dates can be created",
    formation.status === 201,
    `HTTP ${formation.status} ${JSON.stringify(formation.body)}`,
  );
  const formationId = formation.body?.[0]?.id;
  check(
    "it starts as a draft, registration closed, attributed to its creator",
    formation.body?.[0]?.status === "draft" &&
      formation.body?.[0]?.registration_open === false &&
      formation.body?.[0]?.created_by === fx.admin.id,
    JSON.stringify(formation.body?.[0]),
  );

  const bac = await post(admin, "programs", {
    name: `${TAG} BAC Maths`,
    category: "exam_preparation",
    level_id: g.level_id,
    subject_id: g.subject_id,
    start_date: "2026-10-01",
    end_date: "2027-06-15",
  });
  check(
    "an academic programme with level, subject and dates can be created",
    bac.status === 201,
    `HTTP ${bac.status} ${JSON.stringify(bac.body)}`,
  );
  const bacId = bac.body?.[0]?.id;

  const language = await post(admin, "programs", {
    name: `${TAG} English B1`,
    category: "language",
    level_id: g.level_id,
  });
  check(
    "a language course with a level but no subject can be created",
    language.status === 201,
    `HTTP ${language.status}`,
  );
  const languageId = language.body?.[0]?.id;

  /* ------------------------------------------------------------------ validation */
  console.log("\n--- the database refuses invalid programmes ---");
  for (const [label, row] of [
    ["an empty name", { name: "   " }],
    ["a 121-character name", { name: "n".repeat(121) }],
    ["an unknown category", { name: `${TAG} x1`, category: "karaoke" }],
    ["an unknown status", { name: `${TAG} x2`, status: "paused" }],
    ["open registration on a draft", { name: `${TAG} x3`, registration_open: true }],
    [
      "an end before the start",
      { name: `${TAG} x4`, start_date: "2026-12-01", end_date: "2026-11-01" },
    ],
    ["a zero duration", { name: `${TAG} x5`, duration_hours: 0 }],
    ["a 2001-character description", { name: `${TAG} x6`, description: "d".repeat(2001) }],
  ]) {
    const r = await post(admin, "programs", row);
    check(`${label} is refused`, r.status >= 400, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }

  /* ------------------------------------------------------------------ duplicates */
  console.log("\n--- duplicate names ---");
  const dup = await post(admin, "programs", { name: `  ${TAG} EXCEL advanced ` });
  check(
    "a second live programme with the same name (case/space-insensitive) is refused (23505)",
    dup.status >= 400 && dup.body?.code === "23505",
    `HTTP ${dup.status} ${JSON.stringify(dup.body)}`,
  );

  /* ------------------------------------------------------------------ lifecycle */
  console.log("\n--- lifecycle ---");
  const activate = await patch(admin, `programs?id=eq.${formationId}`, {
    status: "active",
    registration_open: true,
  });
  check(
    "activating with registration open is allowed",
    activate.status === 200 && activate.body?.[0]?.registration_open === true,
    `HTTP ${activate.status}`,
  );
  const badComplete = await patch(admin, `programs?id=eq.${formationId}`, { status: "completed" });
  check(
    "completing while registration is still open is refused",
    badComplete.status >= 400,
    `HTTP ${badComplete.status}`,
  );
  const complete = await patch(admin, `programs?id=eq.${formationId}`, {
    status: "completed",
    registration_open: false,
  });
  check(
    "completing with registration closed is allowed",
    complete.status === 200,
    `HTTP ${complete.status}`,
  );
  const archive = await patch(admin, `programs?id=eq.${formationId}`, { status: "archived" });
  check("archiving is allowed", archive.status === 200, `HTTP ${archive.status}`);
  const reuse = await post(admin, "programs", {
    name: `${TAG} Excel Advanced`,
    category: "professional_training",
  });
  check(
    "an archived programme frees its name for a new edition",
    reuse.status === 201,
    `HTTP ${reuse.status} ${JSON.stringify(reuse.body)}`,
  );
  const restore = await patch(admin, `programs?id=eq.${formationId}`, { status: "draft" });
  check(
    "restoring the archived one while its name is live again is refused (23505)",
    restore.status >= 400 && restore.body?.code === "23505",
    `HTTP ${restore.status}`,
  );
  const newFormationId = reuse.body?.[0]?.id;

  /* ------------------------------------------------------------------ group association */
  console.log("\n--- groups belong to programmes without losing anything ---");
  const attach = await patch(admin, `groups?id=eq.${group.id}`, { program_id: bacId });
  check(
    "a matching group can be attached to a programme",
    attach.status === 200 && attach.body?.[0]?.program_id === bacId,
    `HTTP ${attach.status} ${JSON.stringify(attach.body)}`,
  );

  const mismatchLevel = await patch(admin, `groups?id=eq.${group.id}`, {
    level_id: otherLevel,
    stream_id: null,
  });
  check(
    "changing an attached group's level away from its programme is refused (23514)",
    mismatchLevel.status >= 400 && mismatchLevel.body?.code === "23514",
    `HTTP ${mismatchLevel.status} ${JSON.stringify(mismatchLevel.body)}`,
  );
  const narrowProgram = await patch(admin, `programs?id=eq.${bacId}`, { subject_id: physics });
  check(
    "changing a programme's subject away from its groups is refused (23514)",
    narrowProgram.status >= 400 && narrowProgram.body?.code === "23514",
    `HTTP ${narrowProgram.status}`,
  );

  const phys = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: `${TAG} physics group`,
    weekday: 3,
    studentCount: 0,
    subjectKey: "physics",
  });
  const wrongSubject = await patch(admin, `groups?id=eq.${phys.id}`, { program_id: bacId });
  check(
    "a group of another subject cannot join a subject programme",
    wrongSubject.status >= 400,
    `HTTP ${wrongSubject.status}`,
  );
  const langAttach = await patch(admin, `groups?id=eq.${phys.id}`, { program_id: languageId });
  check(
    "a programme with a level but no subject accepts any subject at that level",
    langAttach.status === 200,
    `HTTP ${langAttach.status} ${JSON.stringify(langAttach.body)}`,
  );

  // A professional formation: no subject, no level, with a trainer -- the database already
  // allowed a subject-less group to have any teacher (qualification applies to subjects only).
  const trainerGroup = await post(admin, "groups", {
    name: `${TAG} Excel group`,
    teacher_id: other.teacher.id,
    program_id: newFormationId,
    max_students: 12,
  });
  check(
    "a subject-less, level-less group with a trainer can run a formation",
    trainerGroup.status === 201 && trainerGroup.body?.[0]?.program_id === newFormationId,
    `HTTP ${trainerGroup.status} ${JSON.stringify(trainerGroup.body)}`,
  );

  /* ------------------------------------------------------------------ RLS */
  console.log("\n--- who can see and change programmes ---");
  const adminAll = await api(
    admin,
    `programs?select=id&name=like.${encodeURIComponent(TAG + "%")}`,
  );
  check(
    "an administrator reads every programme",
    (adminAll.body ?? []).length === 4,
    `${(adminAll.body ?? []).length} rows`,
  );

  const tRead = await api(teacher, "programs?select=id");
  const tIds = (tRead.body ?? []).map((r) => r.id).sort();
  check(
    "a teacher reads exactly the programmes of their own groups",
    JSON.stringify(tIds) === JSON.stringify([bacId, languageId].sort()),
    JSON.stringify(tIds),
  );
  const fRead = await api(foreignTeacher, "programs?select=id");
  check(
    "another teacher reads only the formation their group runs",
    (fRead.body ?? []).length === 1 && fRead.body[0].id === newFormationId,
    JSON.stringify(fRead.body),
  );
  const sRead = await api(student, "programs?select=id");
  check(
    "a student reads no programmes",
    Array.isArray(sRead.body) && sRead.body.length === 0,
    JSON.stringify(sRead.body),
  );
  const anonRead = await api(null, "programs?select=id");
  check(
    "an anonymous visitor is refused",
    anonRead.status === 401 || (Array.isArray(anonRead.body) && anonRead.body.length === 0),
    `HTTP ${anonRead.status}`,
  );

  const tInsert = await post(teacher, "programs", { name: `${TAG} teacher made` });
  check("a teacher cannot create a programme", tInsert.status >= 400, `HTTP ${tInsert.status}`);
  await patch(teacher, `programs?id=eq.${bacId}`, { name: `${TAG} hijacked` });
  await del(teacher, `programs?id=eq.${languageId}`);
  const sInsert = await post(student, "programs", { name: `${TAG} student made` });
  check("a student cannot create a programme", sInsert.status >= 400, `HTTP ${sInsert.status}`);
  await patch(student, `programs?id=eq.${bacId}`, { name: `${TAG} hijacked` });
  const intact = await one(`select (select name from public.programs where id = '${bacId}') n,
                                   (select count(*)::int from public.programs where id = '${languageId}') l;`);
  check(
    "teachers and students cannot edit or delete programmes",
    intact?.n === `${TAG} BAC Maths` && intact?.l === 1,
    JSON.stringify(intact),
  );
  const tAttach = await patch(teacher, `groups?id=eq.${group.id}`, { program_id: null });
  const stillAttached = await one(`select program_id from public.groups where id = '${group.id}';`);
  check(
    "a teacher cannot detach a group from its programme",
    stillAttached?.program_id === bacId,
    `HTTP ${tAttach.status}`,
  );

  /* ------------------------------------------------------------------ deletion */
  console.log("\n--- programmes with groups are archived, not deleted ---");
  const delWithGroups = await del(admin, `programs?id=eq.${bacId}`);
  check(
    "deleting a programme that still has groups is refused (23503)",
    delWithGroups.status >= 400 && delWithGroups.body?.code === "23503",
    `HTTP ${delWithGroups.status} ${JSON.stringify(delWithGroups.body)}`,
  );
  const delEmpty = await del(admin, `programs?id=eq.${formationId}`);
  check(
    "an administrator can delete a programme with no groups",
    delEmpty.status === 200 && delEmpty.body?.length === 1,
    `HTTP ${delEmpty.status}`,
  );

  /* ------------------------------------------------------------------ compatibility */
  console.log("\n--- existing groups, registrations and payments keep working ---");
  // Real data now holds both kinds: groups that deliver a formation and standalone groups
  // (ADR-004). What must hold is that every existing formation link is consistent -- the group
  // carries its formation's level and subject whenever the formation names them -- not that
  // groups stay standalone.
  const linked = await one(`select count(*)::int c from public.groups
                              where program_id is not null and name not like 'e2e-fixture%';`);
  const inconsistent = await one(`select count(*)::int c
                                    from public.groups g join public.programs p on p.id = g.program_id
                                   where g.name not like 'e2e-fixture%'
                                     and ((p.level_id is not null and g.level_id is distinct from p.level_id)
                                       or (p.subject_id is not null and g.subject_id is distinct from p.subject_id));`);
  check(
    "every existing formation-linked group matches its formation's level and subject",
    inconsistent?.c === 0,
    `${inconsistent?.c} inconsistent of ${linked?.c} linked`,
  );
  const standaloneVisible = await api(admin, "groups?select=id&program_id=is.null&limit=1");
  check(
    "standalone groups (no formation) remain valid and readable",
    standaloneVisible.status === 200,
    `HTTP ${standaloneVisible.status}`,
  );

  const groupsSelect =
    "groups?select=id,name,program_id,subjects(key,name,color),levels(name),programs(name)&limit=5";
  for (const [who, tok] of [
    ["admin", admin],
    ["teacher", teacher],
    ["student", student],
  ]) {
    const r = await api(tok, groupsSelect);
    check(
      `the Groups query (with the programme embed) still works for a ${who}`,
      r.status === 200,
      `HTTP ${r.status} ${JSON.stringify(r.body)}`,
    );
  }

  // A student registers into a group that belongs to a programme -- eligibility unchanged.
  await sql(`update public.students set level_id = '${g.level_id}', stream_id = ${g.stream_id ? `'${g.stream_id}'` : "null"}
              where id = '${fx.student.id}';`);
  const reg = await post(student, "registrations", {
    student_id: fx.student.id,
    group_id: group.id,
  });
  check(
    "a student can request a place in a programme's group",
    reg.status === 201 && reg.body?.[0]?.status === "pending",
    `HTTP ${reg.status} ${JSON.stringify(reg.body)}`,
  );
  const regId = reg.body?.[0]?.id;
  const approve = await patch(admin, `registrations?id=eq.${regId}`, {
    status: "approved",
    decided_at: new Date().toISOString(),
  });
  check("an administrator approves it as before", approve.status === 200, `HTTP ${approve.status}`);
  const pay = await post(admin, "payments", {
    registration_id: regId,
    amount_dzd: 1500,
    recorded_by: fx.admin.id,
  });
  check(
    "a payment is recorded against it as before",
    pay.status === 201,
    `HTTP ${pay.status} ${JSON.stringify(pay.body)}`,
  );
  const counts = await api(
    admin,
    `group_enrollment_counts?select=enrolled_count&group_id=eq.${group.id}`,
  );
  check(
    "the enrolment count view reflects it",
    counts.body?.[0]?.enrolled_count === 1,
    JSON.stringify(counts.body),
  );

  /* ------------------------------------------------------------------ create_formation */
  console.log("\n--- creating a formation, with or without its first group, is atomic ---");
  const rpc = (tok, args) =>
    api(tok, "rpc/create_formation", { method: "POST", body: JSON.stringify(args) });
  const maths = (await one(`select id from public.subjects where key = 'mathematics';`)).id;
  const level3 = (await one(`select id from public.levels where name = '3ème année secondaire';`))
    .id;
  const sciences = (
    await one(`select id from public.streams where code = 'sciences' and level_id = '${level3}';`)
  ).id;
  await sql(`insert into public.teacher_subjects (teacher_id, subject_id)
             values ('${fx.teacher.id}', '${maths}') on conflict do nothing;`);

  const alone = await rpc(admin, {
    formation: { name: `${TAG} RPC Alone`, category: "workshop", status: "draft" },
  });
  const aloneRow = await one(
    `select status, registration_open, (select count(*)::int from public.groups where program_id = p.id) groups
       from public.programs p where id = '${alone.body?.program_id}';`,
  );
  check(
    "a formation can be created without any group (zero groups is valid)",
    alone.status === 200 && alone.body?.group_id === null && aloneRow?.groups === 0,
    `HTTP ${alone.status} ${JSON.stringify(alone.body)} ${JSON.stringify(aloneRow)}`,
  );
  check(
    "it starts in the requested status with enrollment closed",
    aloneRow?.status === "draft" && aloneRow?.registration_open === false,
    JSON.stringify(aloneRow),
  );

  const both = await rpc(admin, {
    formation: {
      name: `${TAG} RPC Bac Maths`,
      category: "exam_preparation",
      status: "active",
      level_id: level3,
      subject_id: maths,
      start_date: "2026-11-01",
      end_date: "2027-05-31",
    },
    first_group: {
      name: `${TAG} RPC Bac Maths — Groupe A`,
      teacher_id: fx.teacher.id,
      stream_id: sciences,
      max_students: 18,
      start_date: "2026-11-01",
      end_date: "2027-05-31",
      // A subject/level sent by a client is ignored: the formation's are used.
      subject_id: physics,
      level_id: otherLevel,
      schedules: [
        { weekday: 6, start_time: "09:00", end_time: "11:00", room: "Salle 2" },
        { weekday: 2, start_time: "17:00", end_time: "19:00", room: " " },
      ],
    },
  });
  const created = await one(
    `select g.program_id, g.subject_id, g.level_id, g.stream_id, g.teacher_id, g.max_students,
            g.start_date::text s, g.end_date::text e, p.status,
            (select count(*)::int from public.group_schedules where group_id = g.id) slots,
            (select room from public.group_schedules where group_id = g.id and weekday = 6) room6,
            (select room from public.group_schedules where group_id = g.id and weekday = 2) room2
       from public.groups g join public.programs p on p.id = g.program_id
      where g.id = '${both.body?.group_id}';`,
  );
  check(
    "a formation and its first group (with weekly slots) are created in one call",
    both.status === 200 &&
      created?.program_id === both.body?.program_id &&
      created?.slots === 2 &&
      created?.teacher_id === fx.teacher.id &&
      created?.max_students === 18 &&
      created?.status === "active",
    `HTTP ${both.status} ${JSON.stringify(both.body)} ${JSON.stringify(created)}`,
  );
  check(
    "the group takes the formation's subject and level, never the client's",
    created?.subject_id === maths &&
      created?.level_id === level3 &&
      created?.stream_id === sciences,
    JSON.stringify(created),
  );
  check(
    "the group keeps its own term and rooms (a blank room is stored as none)",
    created?.s === "2026-11-01" &&
      created?.e === "2027-05-31" &&
      created?.room6 === "Salle 2" &&
      created?.room2 === null,
    JSON.stringify(created),
  );

  // Atomicity: the group part fails (two slots on the same weekday violate
  // group_schedules_one_per_day), so the formation must not exist either.
  const broken = await rpc(admin, {
    formation: { name: `${TAG} RPC Atomic`, category: "language", status: "draft" },
    first_group: {
      name: `${TAG} RPC Atomic — Groupe A`,
      max_students: 10,
      schedules: [
        { weekday: 1, start_time: "09:00", end_time: "10:00", room: null },
        { weekday: 1, start_time: "11:00", end_time: "12:00", room: null },
      ],
    },
  });
  const leftovers = await one(
    `select (select count(*)::int from public.programs where name = '${TAG} RPC Atomic') p,
            (select count(*)::int from public.groups where name = '${TAG} RPC Atomic — Groupe A') g;`,
  );
  check(
    "if the first group cannot be created, the formation is not created either",
    broken.status >= 400 && leftovers?.p === 0 && leftovers?.g === 0,
    `HTTP ${broken.status} ${JSON.stringify(broken.body)} ${JSON.stringify(leftovers)}`,
  );

  // A teacher not qualified for the formation's subject is refused by the existing trigger --
  // atomically, again.
  const unqualified = await rpc(admin, {
    formation: { name: `${TAG} RPC Physique`, category: "academic_support", subject_id: physics },
    first_group: { name: `${TAG} RPC Physique — Groupe A`, teacher_id: other.teacher.id },
  });
  const physLeft = await one(
    `select count(*)::int c from public.programs where name = '${TAG} RPC Physique';`,
  );
  check(
    "existing group rules (teacher qualification) still apply, and nothing is left behind",
    unqualified.status >= 400 && physLeft?.c === 0,
    `HTTP ${unqualified.status} ${JSON.stringify(unqualified.body)} left=${physLeft?.c}`,
  );

  const dupRpc = await rpc(admin, {
    formation: { name: `${TAG} RPC Alone`, category: "workshop" },
  });
  check(
    "a duplicate live name is refused (23505)",
    dupRpc.status >= 400 && dupRpc.body?.code === "23505",
    `HTTP ${dupRpc.status} ${JSON.stringify(dupRpc.body)}`,
  );
  const badStatus = await rpc(admin, {
    formation: { name: `${TAG} RPC Archived`, category: "workshop", status: "archived" },
  });
  check(
    "a formation cannot be created already completed, cancelled or archived",
    badStatus.status >= 400,
    `HTTP ${badStatus.status} ${JSON.stringify(badStatus.body)}`,
  );

  for (const [who, tok] of [
    ["a teacher", teacher],
    ["a student", student],
    ["an anonymous visitor", null],
  ]) {
    const r = await rpc(tok, {
      formation: { name: `${TAG} RPC by ${who}`, category: "other" },
      first_group: { name: `${TAG} RPC by ${who} — Groupe A` },
    });
    const made = await one(
      `select count(*)::int c from public.programs where name = '${TAG} RPC by ${who}';`,
    );
    check(
      `${who} cannot create a formation through the function`,
      r.status >= 400 && made?.c === 0,
      `HTTP ${r.status} ${JSON.stringify(r.body)}`,
    );
  }
} finally {
  await cleanupFixtures();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
