/**
 * Level System foundation (Phase 3A, 20261004110000 + 20261004110100), against the LOCAL stack.
 *
 * What must hold:
 *   - built-in systems: Algerian School, CEFR, Training, Custom (one each)
 *   - the 12 school levels are the same rows, in the school system, with their stages and
 *     codes 1AP..3AS; A1..C2 belong to CEFR and Beginner/Intermediate/Advanced to Training,
 *     with no stage; nothing is duplicated
 *   - a school level needs a stage; no other level may have one; a level never changes system
 *   - a formation's level must belong to its system; the system is filled from the level
 *   - Phase 3B: a group of a formation that names a system carries only that system's levels
 *   - streams and a student's level are school levels only
 *   - built-in systems cannot be removed or redefined; only administrators write
 *   - the existing school behaviour (the Levels screen's insert, groups, catalogue) is intact
 *
 * RUN ALONE -- fixture cleanup is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-level-systems.mjs
 */
import {
  sql,
  API,
  PUBLISHABLE_KEY,
  TEST_PASSWORD,
  withFixtures,
  createGroupFixture,
  cleanupFixtures,
} from "./fixtures.mjs";

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};
const TAG = "e2e-fixture";
const one = async (q) => (await sql(q))[0];
const refusedSql = async (q) => {
  try {
    await sql(q);
    return false;
  } catch {
    return true;
  }
};

const signIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return (await r.json()).access_token;
};
const rest = async (tok, path, init = {}) => {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
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
const post = (tok, table, row) => rest(tok, table, { method: "POST", body: JSON.stringify(row) });

const fx = await withFixtures({ admin: true, teacher: true, student: true });

try {
  const admin = await signIn(fx.admin.email);
  const teacher = await signIn(fx.teacher.email);
  const student = await signIn(fx.student.email);
  const sys = Object.fromEntries(
    (await sql(`select code, id::text id from public.level_systems`)).map((r) => [r.code, r.id]),
  );
  const levelId = async (system, code) =>
    (
      await one(`select l.id::text id from public.levels l join public.level_systems s on s.id = l.system_id
                  where s.code = '${system}' and l.code = '${code}';`)
    )?.id;

  /* ------------------------------------------------------------------ systems */
  console.log("\n--- level systems ---");
  const builtIns = await sql(
    `select code, kind from public.level_systems where built_in order by position;`,
  );
  rec(
    "the four built-in systems exist, one per kind: Algerian School, CEFR, Training, Custom",
    builtIns.map((s) => `${s.code}:${s.kind}`).join(",") ===
      "algerian_school:school,cefr:cefr,training:training,custom:custom",
    JSON.stringify(builtIns),
  );

  /* ------------------------------------------------------------------ levels */
  console.log("\n--- levels in their systems ---");
  const school = await sql(`select code, stage::text, name from public.levels
                             where system_id = '${sys.algerian_school}' order by position;`);
  rec(
    "the 12 school levels belong to the school system with codes 1AP..5AP, 1AM..4AM, 1AS..3AS",
    school.map((l) => l.code).join(",") === "1AP,2AP,3AP,4AP,5AP,1AM,2AM,3AM,4AM,1AS,2AS,3AS",
    school.map((l) => l.code).join(","),
  );
  rec(
    "school levels keep their stages (5 primary, 4 middle, 3 high) and names",
    school.filter((l) => l.stage === "primary").length === 5 &&
      school.filter((l) => l.stage === "middle").length === 4 &&
      school.filter((l) => l.stage === "high").length === 3 &&
      school[7]?.name === "3ème année moyenne",
    JSON.stringify(school.map((l) => l.stage)),
  );
  const cefr = await sql(`select code, stage from public.levels
                           where system_id = '${sys.cefr}' order by position;`);
  rec(
    "A1..C2 are CEFR levels, in order, without a school stage",
    cefr.map((l) => l.code).join(",") === "A1,A2,B1,B2,C1,C2" &&
      cefr.every((l) => l.stage === null),
    JSON.stringify(cefr),
  );
  const training = await sql(`select code, name, stage from public.levels
                               where system_id = '${sys.training}' order by position;`);
  rec(
    "Beginner/Intermediate/Advanced are Training levels without a school stage",
    training.map((l) => l.code).join(",") === "beginner,intermediate,advanced" &&
      training.every((l) => l.stage === null),
    JSON.stringify(training),
  );
  const dupes = await one(`select count(*)::int c from (select system_id, lower(code)
                             from public.levels where code is not null
                             group by 1, 2 having count(*) > 1) d;`);
  const total = await one(`select count(*)::int c from public.levels;`);
  rec(
    "no seeded level is duplicated (21 levels: 12 + 6 + 3)",
    dupes.c === 0 && total.c === 21,
    `dupes=${dupes.c} total=${total.c}`,
  );
  const streams =
    await one(`select count(*)::int c from public.streams st join public.levels l on l.id = st.level_id
                              where l.system_id = '${sys.algerian_school}';`);
  const allStreams = await one(`select count(*)::int c from public.streams;`);
  rec(
    "every existing stream still references a school level",
    streams.c === allStreams.c && allStreams.c > 0,
    `${streams.c}/${allStreams.c}`,
  );

  /* ------------------------------------------------------------------ stage rules */
  console.log("\n--- stage rules ---");
  rec(
    "a CEFR level cannot be given a school stage",
    await refusedSql(`insert into public.levels (system_id, code, name, stage)
                      values ('${sys.cefr}', 'X1', '${TAG} X1', 'primary');`),
  );
  rec(
    "a school level cannot be created without its stage",
    await refusedSql(`insert into public.levels (system_id, name, stage)
                      values ('${sys.algerian_school}', '${TAG} sans stage', null);`),
  );
  const a1 = await levelId("cefr", "A1");
  rec(
    "a level cannot move to another system",
    await refusedSql(`update public.levels set system_id = '${sys.training}' where id = '${a1}';`),
  );
  rec(
    "a code is unique within its system",
    await refusedSql(
      `insert into public.levels (system_id, code, name) values ('${sys.cefr}', 'a1', '${TAG} a1');`,
    ),
  );

  // Custom levels: an administrator creates one without any stage.
  const custom = await post(admin, "levels", {
    system_id: sys.custom,
    code: "N1",
    name: `${TAG} Niveau 1`,
    position: 1,
  });
  rec(
    "an administrator can create a custom level with no school stage",
    custom.status === 201 && custom.body?.[0]?.stage === null,
    `HTTP ${custom.status} ${custom.text.slice(0, 120)}`,
  );

  // The existing Levels screen sends no system: its levels are school levels, as before.
  const legacy = await post(admin, "levels", {
    name: `${TAG} Niveau scolaire`,
    stage: "high",
    position: 99,
    status: "active",
  });
  rec(
    "a level created as before (no system) is a school level with its stage",
    legacy.status === 201 && legacy.body?.[0]?.system_id === sys.algerian_school,
    `HTTP ${legacy.status} ${legacy.text.slice(0, 120)}`,
  );

  /* ------------------------------------------------------------------ formations */
  console.log("\n--- formations reference a level system ---");
  const l3am = await levelId("algerian_school", "3AM");
  const viaRpc = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({
      formation: { name: `${TAG} LS Maths 3AM`, category: "academic_support", level_id: l3am },
    }),
  });
  const f1 = await one(`select level_system_id::text s, level_id::text l from public.programs
                         where id = '${viaRpc.body?.program_id}';`);
  rec(
    "a formation created with a school level gets the school system (today's form sends only the level)",
    viaRpc.ok && f1?.s === sys.algerian_school && f1?.l === l3am,
    JSON.stringify(f1),
  );
  const c1 = await levelId("cefr", "C1");
  const cefrFormation = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({
      formation: {
        name: `${TAG} LS English C1`,
        category: "language",
        level_system_id: sys.cefr,
        level_id: c1,
      },
    }),
  });
  rec(
    "a formation can reference CEFR and its C1 level",
    cefrFormation.ok,
    `HTTP ${cefrFormation.status} ${cefrFormation.text.slice(0, 120)}`,
  );
  const mismatch = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({
      formation: {
        name: `${TAG} LS Mismatch`,
        category: "language",
        level_system_id: sys.algerian_school,
        level_id: c1,
      },
    }),
  });
  const mismatchLeft = await one(
    `select count(*)::int c from public.programs where name = '${TAG} LS Mismatch';`,
  );
  rec(
    "a CEFR level is refused for a formation of the school system (23514)",
    !mismatch.ok && mismatch.body?.code === "23514" && mismatchLeft.c === 0,
    `HTTP ${mismatch.status} ${mismatch.text.slice(0, 120)}`,
  );
  const systemOnly = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({
      formation: { name: `${TAG} LS English`, category: "language", level_system_id: sys.cefr },
    }),
  });
  const noLevel = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({ formation: { name: `${TAG} LS Atelier`, category: "workshop" } }),
  });
  const shapes = await sql(`select name, level_system_id::text s, level_id from public.programs
                             where id in ('${systemOnly.body?.program_id}', '${noLevel.body?.program_id}')
                             order by name;`);
  rec(
    "a formation may name a system without a level, or no system at all (no specific level)",
    systemOnly.ok &&
      noLevel.ok &&
      shapes.find((r) => r.name.endsWith("English"))?.s === sys.cefr &&
      shapes.find((r) => r.name.endsWith("Atelier"))?.s === null,
    JSON.stringify(shapes),
  );
  const switchBad = await rest(admin, `programs?id=eq.${cefrFormation.body?.program_id}`, {
    method: "PATCH",
    body: JSON.stringify({ level_system_id: sys.training }),
  });
  rec(
    "changing a formation's system away from its level's system is refused",
    !switchBad.ok && switchBad.body?.code === "23514",
    `HTTP ${switchBad.status}`,
  );
  const formationsOk =
    await one(`select count(*)::int c from public.programs p join public.levels l on l.id = p.level_id
                                   where p.level_system_id is distinct from l.system_id;`);
  rec("every formation's level belongs to its system", formationsOk.c === 0, `${formationsOk.c}`);

  /* ------------------------------------------------------------------ school-only uses */
  console.log("\n--- streams and student levels are school levels ---");
  rec(
    "a stream cannot be attached to a CEFR level",
    await refusedSql(`insert into public.streams (level_id, code, name_fr, name_ar, name_en)
                      values ('${a1}', 'e2e', 'E2E', 'E2E', 'E2E');`),
  );
  const studentToA1 = await rest(admin, `students?id=eq.${fx.student.id}`, {
    method: "PATCH",
    body: JSON.stringify({ level_id: a1 }),
  });
  rec(
    "a student's level cannot be a CEFR level (it is their school identity)",
    !studentToA1.ok && studentToA1.body?.code === "23514",
    `HTTP ${studentToA1.status} ${studentToA1.text.slice(0, 100)}`,
  );

  /* ------------------------------------------------------------------ protection + roles */
  console.log("\n--- built-in protection and who may write ---");
  const delBuiltIn = await rest(admin, `level_systems?id=eq.${sys.custom}`, { method: "DELETE" });
  const stillThere = await one(
    `select count(*)::int c from public.level_systems where code = 'custom';`,
  );
  rec(
    "a built-in system cannot be deleted, even by an administrator",
    !delBuiltIn.ok && stillThere.c === 1,
    `HTTP ${delBuiltIn.status}`,
  );
  const renameCode = await rest(admin, `level_systems?id=eq.${sys.cefr}`, {
    method: "PATCH",
    body: JSON.stringify({ code: "cefr2" }),
  });
  rec("a built-in system's code cannot be changed", !renameCode.ok, `HTTP ${renameCode.status}`);
  const newSchool = await post(admin, "level_systems", {
    code: "second_school",
    kind: "school",
    name: "Second",
  });
  rec(
    "administrators cannot create a second school (or CEFR/training) system",
    !newSchool.ok,
    `HTTP ${newSchool.status}`,
  );
  const newCustom = await post(admin, "level_systems", {
    code: "e2e_custom",
    kind: "custom",
    name: `${TAG} Échelle maison`,
    built_in: true,
  });
  rec(
    "administrators can create a custom system (never marked built-in)",
    newCustom.status === 201 && newCustom.body?.[0]?.built_in === false,
    `HTTP ${newCustom.status} ${newCustom.text.slice(0, 100)}`,
  );
  for (const [who, tok] of [
    ["a teacher", teacher],
    ["a student", student],
  ]) {
    const read = await rest(tok, "level_systems?select=code");
    const write = await post(tok, "levels", { system_id: sys.custom, name: `${TAG} by ${who}` });
    rec(
      `${who} reads the level systems but cannot create levels`,
      read.ok && read.body.length >= 4 && !write.ok,
      `read ${read.status}/${read.body?.length}, write ${write.status}`,
    );
  }
  const anon = await rest(null, "level_systems?select=code");
  rec(
    "an anonymous visitor reads nothing",
    !anon.ok || (Array.isArray(anon.body) && anon.body.length === 0),
    `HTTP ${anon.status}`,
  );

  /* ------------------------------------------------------------------ groups (Phase 3B) */
  console.log("\n--- groups stay within their formation's level system (Phase 3B) ---");
  const english = systemOnly.body?.program_id; // CEFR, every level
  const atelier = noLevel.body?.program_id; // no specific level
  const b1 = await levelId("cefr", "B1");
  const l3as = await levelId("algerian_school", "3AS");
  const gB1 = await post(admin, "groups", {
    name: `${TAG} LS English B1`,
    program_id: english,
    level_id: b1,
  });
  rec(
    "a group of a CEFR formation can be at a CEFR level (B1)",
    gB1.status === 201 && gB1.body?.[0]?.level_id === b1,
    `HTTP ${gB1.status} ${gB1.text.slice(0, 120)}`,
  );
  const gSchool = await post(admin, "groups", {
    name: `${TAG} LS English 3AS`,
    program_id: english,
    level_id: l3as,
  });
  const gSchoolLeft = await one(
    `select count(*)::int c from public.groups where name = '${TAG} LS English 3AS';`,
  );
  rec(
    "a school level (3AS) is refused for a group of a CEFR formation (23514)",
    !gSchool.ok && gSchool.body?.code === "23514" && gSchoolLeft.c === 0,
    `HTTP ${gSchool.status} ${gSchool.text.slice(0, 120)}`,
  );
  const gAny = await post(admin, "groups", {
    name: `${TAG} LS English mixed`,
    program_id: english,
  });
  rec(
    "a group of a CEFR formation may carry no level",
    gAny.status === 201 && gAny.body?.[0]?.level_id === null,
    `HTTP ${gAny.status}`,
  );
  const moveLevel = await rest(admin, `groups?id=eq.${gB1.body?.[0]?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ level_id: l3as }),
  });
  rec(
    "an existing group cannot move to a level outside its formation's system",
    !moveLevel.ok && moveLevel.body?.code === "23514",
    `HTTP ${moveLevel.status}`,
  );
  const standalone = await post(admin, "groups", {
    name: `${TAG} LS standalone 3AM`,
    level_id: l3am,
  });
  const attach = await rest(admin, `groups?id=eq.${standalone.body?.[0]?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ program_id: english }),
  });
  rec(
    "a 3AM standalone group cannot join a CEFR formation",
    standalone.status === 201 && !attach.ok && attach.body?.code === "23514",
    `HTTP ${standalone.status}/${attach.status}`,
  );
  const toTraining = await rest(admin, `programs?id=eq.${english}`, {
    method: "PATCH",
    body: JSON.stringify({ level_system_id: sys.training }),
  });
  const stillCefr = await one(
    `select level_system_id::text s from public.programs where id = '${english}';`,
  );
  rec(
    "a formation cannot move to a system its groups' levels are not part of",
    !toTraining.ok && toTraining.body?.code === "23514" && stillCefr.s === sys.cefr,
    `HTTP ${toTraining.status}`,
  );
  const dropSystem = await rest(admin, `programs?id=eq.${english}`, {
    method: "PATCH",
    body: JSON.stringify({ level_system_id: null }),
  });
  const backToCefr = await rest(admin, `programs?id=eq.${english}`, {
    method: "PATCH",
    body: JSON.stringify({ level_system_id: sys.cefr }),
  });
  rec(
    "it may drop to 'no specific level' and come back to CEFR (its groups are B1 or unset)",
    dropSystem.ok && backToCefr.ok,
    `HTTP ${dropSystem.status}/${backToCefr.status}`,
  );
  const atelierGroup = await post(admin, "groups", {
    name: `${TAG} LS Atelier 3AM`,
    program_id: atelier,
    level_id: l3am,
  });
  rec(
    "a formation with no specific level puts no limit on its groups' levels (as before)",
    atelierGroup.status === 201,
    `HTTP ${atelierGroup.status}`,
  );
  const teacherWrite = await post(teacher, "groups", {
    name: `${TAG} LS teacher`,
    program_id: english,
    level_id: b1,
  });
  rec(
    "only administrators create groups (unchanged)",
    !teacherWrite.ok,
    `HTTP ${teacherWrite.status}`,
  );
  const groupsOk = await one(`select count(*)::int c from public.groups g
                                join public.programs p on p.id = g.program_id
                                join public.levels l on l.id = g.level_id
                               where p.level_system_id is not null and l.system_id <> p.level_system_id;`);
  rec("no group carries a level outside its formation's system", groupsOk.c === 0, `${groupsOk.c}`);
  await sql(`delete from public.groups where name like '${TAG} LS %';`);

  /* ------------------------------------------------------- formation level -> group level */
  console.log("\n--- formation level -> group level (CEFR B1 / CEFR any / no level) ---");
  try {
    const cefr = Object.fromEntries(
      await Promise.all(
        ["A1", "A2", "B1", "B2", "C1", "C2"].map(async (c) => [c, await levelId("cefr", c)]),
      ),
    );
    const beginner = await levelId("training", "beginner");
    const g = (name, extra) => post(admin, "groups", { name: `${TAG} LS3 ${name}`, ...extra });
    const refused = (r) => !r.ok && r.body?.code === "23514";

    // 1. CEFR + B1, created through the application's RPC with its first group. A forged
    //    first-group level (A1) is ignored: the function copies the formation's level.
    const b1Formation = await rest(admin, "rpc/create_formation", {
      method: "POST",
      body: JSON.stringify({
        formation: {
          name: `${TAG} LS3 Anglais B1`,
          category: "language",
          level_system_id: sys.cefr,
          level_id: cefr.B1,
        },
        first_group: { name: `${TAG} LS3 B1 first`, level_id: cefr.A1, schedules: [] },
      }),
    });
    const fB1 = b1Formation.body?.program_id;
    const first = await one(
      `select level_id::text l from public.groups where id = '${b1Formation.body?.group_id}';`,
    );
    rec(
      "CEFR+B1 via create_formation: the first group is at B1 (a forged A1 in first_group is ignored)",
      b1Formation.ok && first?.l === cefr.B1,
      `HTTP ${b1Formation.status} ${JSON.stringify(first)}`,
    );
    const okB1 = await g("B1 second", { program_id: fB1, level_id: cefr.B1 });
    rec(
      "CEFR+B1 allows another group at B1 (admin API)",
      okB1.status === 201,
      `HTTP ${okB1.status}`,
    );

    // 2. The same formation refuses every other level, by every path.
    const wrong = {};
    for (const [label, lvl] of [
      ["A1", cefr.A1],
      ["A2", cefr.A2],
      ["C1", cefr.C1],
      ["3AM", l3am],
      ["beginner", beginner],
    ]) {
      wrong[label] = refused(await g(`B1 wrong ${label}`, { program_id: fB1, level_id: lvl }));
    }
    const wrongLeft = await one(
      `select count(*)::int c from public.groups where name like '${TAG} LS3 B1 wrong%';`,
    );
    rec(
      "CEFR+B1 refuses A1, A2, C1 and non-CEFR levels (3AM, Training beginner) with 23514, nothing created",
      Object.values(wrong).every(Boolean) && wrongLeft.c === 0,
      JSON.stringify(wrong),
    );
    const noLevelInB1 = await g("B1 no level", { program_id: fB1 });
    rec(
      "CEFR+B1 also refuses a group with no level (its groups carry exactly B1, as since Phase 1)",
      refused(noLevelInB1),
      `HTTP ${noLevelInB1.status}`,
    );
    const toA1 = await rest(admin, `groups?id=eq.${okB1.body?.[0]?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ level_id: cefr.A1 }),
    });
    const loneA1 = await g("standalone A1", { level_id: cefr.A1 });
    const joinB1 = await rest(admin, `groups?id=eq.${loneA1.body?.[0]?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ program_id: fB1 }),
    });
    rec(
      "a B1 group cannot be moved to A1, and an A1 group cannot join the B1 formation (PATCH)",
      refused(toA1) && loneA1.status === 201 && refused(joinB1),
      `HTTP ${toA1.status}/${loneA1.status}/${joinB1.status}`,
    );
    const directSql = await refusedSql(
      `insert into public.groups (name, program_id, level_id) values ('${TAG} LS3 B1 sql', '${fB1}', '${cefr.C1}');`,
    );
    rec(
      "a direct database insert (postgres role, no RLS) at C1 is refused too: the rule is a trigger",
      directSql,
    );
    const forgedTeacher = await post(teacher, "groups", {
      name: `${TAG} LS3 forged t`,
      program_id: fB1,
      level_id: cefr.B1,
    });
    const forgedStudent = await post(student, "groups", {
      name: `${TAG} LS3 forged s`,
      program_id: fB1,
      level_id: cefr.A1,
    });
    const forgedPatch = await rest(student, `groups?id=eq.${okB1.body?.[0]?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ level_id: cefr.A1 }),
    });
    const stillB1 = await one(
      `select level_id::text l from public.groups where id = '${okB1.body?.[0]?.id}';`,
    );
    rec(
      "forged teacher/student writes are refused and change nothing",
      !forgedTeacher.ok &&
        !forgedStudent.ok &&
        stillB1?.l === cefr.B1 &&
        (!forgedPatch.ok || (Array.isArray(forgedPatch.body) && forgedPatch.body.length === 0)),
      `HTTP ${forgedTeacher.status}/${forgedStudent.status}/${forgedPatch.status}`,
    );
    const moveFormation = await rest(admin, `programs?id=eq.${fB1}`, {
      method: "PATCH",
      body: JSON.stringify({ level_id: cefr.A1 }),
    });
    rec(
      "the B1 formation cannot move to A1 while its groups are at B1",
      refused(moveFormation),
      `HTTP ${moveFormation.status}`,
    );

    // 3. CEFR, no specific level: every CEFR level is accepted.
    const anyCefr = await rest(admin, "rpc/create_formation", {
      method: "POST",
      body: JSON.stringify({
        formation: {
          name: `${TAG} LS3 Anglais tous niveaux`,
          category: "language",
          level_system_id: sys.cefr,
        },
      }),
    });
    const fAny = anyCefr.body?.program_id;
    const each = {};
    for (const [c, lvl] of Object.entries(cefr))
      each[c] = (await g(`any ${c}`, { program_id: fAny, level_id: lvl })).status;
    const sqlAny = !(await refusedSql(
      `insert into public.groups (name, program_id, level_id) values ('${TAG} LS3 any sql', '${fAny}', '${cefr.B2}');`,
    ));
    rec(
      "CEFR with no level allows groups at every CEFR level, A1..C2 (API and direct insert)",
      Object.values(each).every((s) => s === 201) && sqlAny,
      JSON.stringify(each),
    );
    rec(
      "CEFR with no level still refuses non-CEFR levels",
      refused(await g("any 3AM", { program_id: fAny, level_id: l3am })) &&
        refused(await g("any beginner", { program_id: fAny, level_id: beginner })),
    );

    // 4. No system, no level: the existing no-level behaviour.
    const none = await rest(admin, "rpc/create_formation", {
      method: "POST",
      body: JSON.stringify({
        formation: { name: `${TAG} LS3 Atelier`, category: "workshop" },
        first_group: { name: `${TAG} LS3 Atelier first`, schedules: [] },
      }),
    });
    const fNone = none.body?.program_id;
    const noneFirst = await one(
      `select level_id from public.groups where id = '${none.body?.group_id}';`,
    );
    const noneSecond = await g("Atelier second", { program_id: fNone });
    const noneSchool = await g("Atelier 3AM", { program_id: fNone, level_id: l3am });
    const noneAfter = await one(
      `select level_system_id, level_id from public.programs where id = '${fNone}';`,
    );
    rec(
      "no system + no level: groups without a level are created (RPC first group and API), any level is still accepted",
      none.ok &&
        noneFirst?.level_id === null &&
        noneSecond.status === 201 &&
        noneSchool.status === 201,
      `HTTP ${none.status}/${noneSecond.status}/${noneSchool.status}`,
    );
    rec(
      "and the formation itself stays at no system, no level",
      noneAfter?.level_system_id === null && noneAfter?.level_id === null,
      JSON.stringify(noneAfter),
    );
  } finally {
    await sql(`delete from public.groups where name like '${TAG} LS3 %';`);
  }

  /* ------------------------------------------------------------------ school behaviour */
  console.log("\n--- existing school behaviour ---");
  const schoolView = await rest(
    admin,
    "levels?select=id,level_systems!inner(kind)&level_systems.kind=eq.school",
  );
  rec(
    "the school levels the screens read are the school system's (no CEFR/training mixed in)",
    schoolView.ok && schoolView.body.length === 13, // 12 + the legacy-path level created above
    `n=${schoolView.body?.length}`,
  );
  const group = await createGroupFixture({ teacherId: fx.teacher.id, studentCount: 1 });
  const g =
    await one(`select l.code, s.code system from public.groups gr join public.levels l on l.id = gr.level_id
                        join public.level_systems s on s.id = l.system_id where gr.id = '${group.id}';`);
  rec(
    "groups keep using school levels (3AS) as before",
    g?.code === "3AS" && g?.system === "algerian_school",
    JSON.stringify(g),
  );
} finally {
  await sql(`delete from public.programs where name like '${TAG}%';`);
  await cleanupFixtures();
  await sql(`delete from public.levels where name like '${TAG}%';`);
  await sql(`delete from public.level_systems where code = 'e2e_custom';`);
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
