/**
 * Subject domains (20261004130000_subject_domains.sql), against the LOCAL stack.
 *
 * What must hold:
 *   - every subject has a valid domain; the built-in subjects are classified by their stable key
 *     (languages / school subjects); anything else starts as "other" (not classified)
 *   - existing references (formations, groups, registrations, qualifications) are intact
 *   - administrators classify subjects; teachers, students and anonymous visitors cannot
 *   - invalid or missing domains are refused
 *   - the domain is a classification, not a database coupling: formation type + subject stay
 *     free in the database (the form filters), reclassifying a subject never breaks a formation,
 *     and the level system stays independent of both
 *
 * RUN ALONE -- fixture cleanup is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-subject-domains.mjs
 */
import {
  sql,
  API,
  PUBLISHABLE_KEY,
  TEST_PASSWORD,
  withFixtures,
  cleanupFixtures,
} from "./fixtures.mjs";

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};
const TAG = "e2e-fixture";
const KEY = "e2e_sd";
const one = async (q) => (await sql(q))[0];

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
const patch = (tok, path, row) => rest(tok, path, { method: "PATCH", body: JSON.stringify(row) });
const changedNothing = (r) => !r.ok || (Array.isArray(r.body) && r.body.length === 0);

const fx = await withFixtures({ admin: true, teacher: true, student: true });

try {
  const admin = await signIn(fx.admin.email);
  const teacher = await signIn(fx.teacher.email);
  const student = await signIn(fx.student.email);

  /* ------------------------------------------------------------------ schema + backfill */
  console.log("\n--- classification and backfill ---");
  const col = await one(`select is_nullable, column_default from information_schema.columns
                          where table_schema = 'public' and table_name = 'subjects' and column_name = 'domain';`);
  rec(
    "subjects.domain is NOT NULL and defaults to 'other' (the explicit unclassified state)",
    col?.is_nullable === "NO" && /'other'/.test(col?.column_default ?? ""),
    JSON.stringify(col),
  );
  const builtIns = await sql(`select key, domain from public.subjects
                               where key in ('english','french','arabic','mathematics','physics','natural_sciences')
                               order by key;`);
  rec(
    "built-in subjects are classified by key: languages and school subjects",
    builtIns.length === 6 &&
      builtIns.every((s) =>
        ["english", "french", "arabic"].includes(s.key)
          ? s.domain === "languages"
          : s.domain === "school_subjects",
      ),
    JSON.stringify(builtIns),
  );
  const invalid = await one(`select count(*)::int c from public.subjects
                              where domain not in ('languages','school_subjects','computing','professional','other');`);
  rec("every subject has a valid domain", invalid.c === 0, `${invalid.c}`);
  const dangling = await one(`select
      (select count(*) from public.programs p where p.subject_id is not null
         and not exists (select 1 from public.subjects s where s.id = p.subject_id))
    + (select count(*) from public.groups g where g.subject_id is not null
         and not exists (select 1 from public.subjects s where s.id = g.subject_id))
    + (select count(*) from public.teacher_subjects ts
         where not exists (select 1 from public.subjects s where s.id = ts.subject_id)) c;`);
  rec(
    "formations, groups and qualifications still point at existing subjects",
    Number(dangling.c) === 0,
    `${dangling.c}`,
  );

  /* ------------------------------------------------------------------ admin writes */
  console.log("\n--- administrators classify subjects ---");
  const created = await post(admin, "subjects", {
    name: `${TAG} Informatique`,
    key: `${KEY}_it`,
    domain: "computing",
  });
  rec(
    "an administrator creates a subject in a domain",
    created.status === 201 && created.body?.[0]?.domain === "computing",
    `HTTP ${created.status} ${created.text.slice(0, 100)}`,
  );
  const noDomain = await post(admin, "subjects", {
    name: `${TAG} Sans domaine`,
    key: `${KEY}_none`,
  });
  rec(
    "a subject created without a domain is 'other' (older clients keep working)",
    noDomain.status === 201 && noDomain.body?.[0]?.domain === "other",
    `HTTP ${noDomain.status}`,
  );
  const wrongCase = await post(admin, "subjects", {
    name: `${TAG} Mauvais`,
    key: `${KEY}_bad`,
    domain: "Languages",
  });
  const nullDomain = await post(admin, "subjects", {
    name: `${TAG} Nul`,
    key: `${KEY}_null`,
    domain: null,
  });
  const badLeft = await one(
    `select count(*)::int c from public.subjects where key in ('${KEY}_bad', '${KEY}_null');`,
  );
  rec(
    "an unknown domain (23514) and a null domain (23502) are refused",
    wrongCase.body?.code === "23514" && nullDomain.body?.code === "23502" && badLeft.c === 0,
    `${wrongCase.body?.code}/${nullDomain.body?.code}`,
  );
  const itId = created.body?.[0]?.id;
  const reclass = await patch(admin, `subjects?id=eq.${itId}`, { domain: "professional" });
  rec(
    "an administrator reclassifies a subject",
    reclass.ok && reclass.body?.[0]?.domain === "professional",
    `HTTP ${reclass.status}`,
  );

  /* ------------------------------------------------------------------ non-admin writes */
  console.log("\n--- teachers, students and visitors cannot classify ---");
  const english = await one(
    `select id::text id, domain from public.subjects where key = 'english';`,
  );
  const tPatch = await patch(teacher, `subjects?id=eq.${english.id}`, { domain: "other" });
  const sPatch = await patch(student, `subjects?id=eq.${english.id}`, { domain: "other" });
  const aPatch = await patch(null, `subjects?id=eq.${english.id}`, { domain: "other" });
  const stillLang = await one(`select domain from public.subjects where id = '${english.id}';`);
  rec(
    "teacher, student and anonymous updates change nothing",
    changedNothing(tPatch) &&
      changedNothing(sPatch) &&
      changedNothing(aPatch) &&
      stillLang.domain === "languages",
    `HTTP ${tPatch.status}/${sPatch.status}/${aPatch.status}`,
  );
  const tInsert = await post(teacher, "subjects", {
    name: `${TAG} T`,
    key: `${KEY}_t`,
    domain: "computing",
  });
  const sInsert = await post(student, "subjects", {
    name: `${TAG} S`,
    key: `${KEY}_s`,
    domain: "computing",
  });
  rec(
    "teachers and students cannot create subjects",
    !tInsert.ok && !sInsert.ok,
    `HTTP ${tInsert.status}/${sInsert.status}`,
  );
  const tDelete = await rest(teacher, `subjects?id=eq.${itId}`, { method: "DELETE" });
  const itStill = await one(`select count(*)::int c from public.subjects where id = '${itId}';`);
  rec("a teacher cannot delete a subject", itStill.c === 1, `HTTP ${tDelete.status}`);
  const anonRead = await rest(null, "subjects?select=id,domain");
  rec(
    "anonymous visitors read no subjects",
    !anonRead.ok || (Array.isArray(anonRead.body) && anonRead.body.length === 0),
    `HTTP ${anonRead.status}`,
  );
  const studentRead = await rest(student, `subjects?select=id,domain&id=eq.${english.id}`);
  rec(
    "signed-in users still read subjects with their domain (catalogue, profile)",
    studentRead.ok && studentRead.body?.[0]?.domain === "languages",
    `HTTP ${studentRead.status}`,
  );

  /* ------------------------------------------------------------------ not coupled */
  console.log("\n--- a classification, not a coupling ---");
  const maths = await one(`select id::text id from public.subjects where key = 'mathematics';`);
  const sys = Object.fromEntries(
    (await sql(`select code, id::text id from public.level_systems`)).map((r) => [r.code, r.id]),
  );
  const free = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({
      formation: { name: `${TAG} SD langue + maths`, category: "language", subject_id: maths.id },
    }),
  });
  rec(
    "the database does not couple formation type and subject (the form filters; existing data stays valid)",
    free.ok,
    `HTTP ${free.status} ${free.text.slice(0, 100)}`,
  );
  const withSubject = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({
      formation: {
        name: `${TAG} SD informatique`,
        category: "professional_training",
        subject_id: itId,
      },
    }),
  });
  await patch(admin, `subjects?id=eq.${itId}`, { domain: "languages" });
  const after = await one(`select category, subject_id::text s from public.programs
                            where id = '${withSubject.body?.program_id}';`);
  rec(
    "reclassifying a subject leaves the formations that use it unchanged",
    withSubject.ok && after?.category === "professional_training" && after?.s === itId,
    JSON.stringify(after),
  );
  const independent = await rest(admin, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({
      formation: {
        name: `${TAG} SD anglais pro`,
        category: "language",
        subject_id: english.id,
        level_system_id: sys.training,
      },
    }),
  });
  const ind =
    await one(`select s.code from public.programs p join public.level_systems s on s.id = p.level_system_id
                          where p.id = '${independent.body?.program_id}';`);
  rec(
    "a language subject does not force CEFR: the level system stays independent",
    independent.ok && ind?.code === "training",
    JSON.stringify(ind),
  );
  const forged = await post(teacher, "programs", {
    name: `${TAG} SD forged`,
    category: "language",
    subject_id: english.id,
  });
  const forgedS = await rest(student, "rpc/create_formation", {
    method: "POST",
    body: JSON.stringify({ formation: { name: `${TAG} SD forged s`, category: "language" } }),
  });
  const forgedLeft = await one(
    `select count(*)::int c from public.programs where name like '${TAG} SD forged%';`,
  );
  rec(
    "teachers and students still cannot create formations (direct table or RPC)",
    !forged.ok && !forgedS.ok && forgedLeft.c === 0,
    `HTTP ${forged.status}/${forgedS.status}`,
  );
} finally {
  await sql(`delete from public.programs where name like '${TAG}%';`);
  await cleanupFixtures();
  await sql(`delete from public.subjects where key like '${KEY}%';`);
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
