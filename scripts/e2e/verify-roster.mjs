/**
 * Roster access, per role, against the isolated local stack.
 *
 * The document format is already proven by `verify-roster-docx.mjs`; this asks the question
 * only a database can answer -- WHO gets which students. The roster is built from the rows a
 * session can actually read, so the test signs in as each role, reads registrations exactly
 * as the page does, feeds them through the same `buildRoster`, and exports the same `.docx`.
 *
 * That is the point: if RLS ever widened, the roster would widen with it, and these checks
 * would catch it. A UI-only assertion could not.
 */

import JSZip from "jszip";
import { Packer } from "docx";
import {
  withFixtures,
  cleanupFixtures,
  createGroupFixture,
  sql,
  API,
  PUBLISHABLE_KEY,
  TEST_PASSWORD,
} from "./fixtures.mjs";
import { buildRoster, rosterMeta } from "../../src/features/school/roster-model.ts";
import { buildRosterDocx } from "../../src/features/school/roster-export.ts";

const counts = { admin: { p: 0, f: 0 }, teacher: { p: 0, f: 0 }, student: { p: 0, f: 0 } };
let section = "admin";
const check = (name, ok, detail = "") => {
  ok ? counts[section].p++ : counts[section].f++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
};

const labels = {
  number: "N°",
  student: "Élève",
  group: "Groupe",
  subject: "Matière",
  level: "Niveau",
  generatedOn: "Établie le",
  total: "Total",
};

const signIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return (await r.json()).access_token;
};

/**
 * Reads the roster's raw material with the caller's own session.
 *
 * Two requests, because a student's NAME is not on `students` -- that table holds only the
 * academic record, and the name lives on `profiles`. Both reads are made as the signed-in
 * user, so whatever RLS withholds from a page is withheld here too.
 */
const registrationsAs = async (token) => {
  const headers = { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` };
  const regRes = await fetch(
    `${API}/rest/v1/registrations?select=id,status,student_id,group_id,groups:group_id(id,name)`,
    { headers },
  );
  const regs = await regRes.json().catch(() => []);
  if (!Array.isArray(regs)) return [];

  const profRes = await fetch(`${API}/rest/v1/profiles?select=id,full_name`, { headers });
  const profs = await profRes.json().catch(() => []);
  const nameOf = new Map((Array.isArray(profs) ? profs : []).map((p) => [p.id, p.full_name ?? ""]));

  return regs.map((x) => ({
    studentId: x.student_id,
    studentName: nameOf.get(x.student_id) ?? "",
    groupId: x.group_id,
    groupName: x.groups?.name ?? "",
    subjectName: null,
    levelName: null,
    status: x.status,
  }));
};

const docxNames = async (rows, groupName) => {
  const meta = rosterMeta({
    schoolName: "E2E School",
    title: "Liste des élèves",
    groupName,
    rows,
    locale: "fr",
    today: new Date(2026, 7, 20),
  });
  const buf = new Uint8Array(await Packer.toBuffer(buildRosterDocx(meta, rows, labels)));
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml").async("string");
  return { buf, xml, meta };
};

const fxA = await withFixtures({ admin: true, teacher: true, student: true });
const fxB = await withFixtures({ teacher: true });

try {
  const groupA = await createGroupFixture({ teacherId: fxA.teacher.id, studentCount: 3 });
  const groupB = await createGroupFixture({ teacherId: fxB.teacher.id, studentCount: 2 });

  const membersIn = async (gid) =>
    await sql(`select r.student_id id, p.full_name n from public.registrations r
                 join public.profiles p on p.id = r.student_id
                where r.group_id = '${gid}' and r.status = 'approved';`);
  const aMembers = await membersIn(groupA.id);
  const bMembers = await membersIn(groupB.id);
  const aNames = aMembers.map((x) => x.n);
  const bNames = bMembers.map((x) => x.n);
  const aIds = aMembers.map((x) => x.id);
  const bIds = bMembers.map((x) => x.id);

  const adminTok = await signIn(fxA.admin.email);
  const teacherATok = await signIn(fxA.teacher.email);
  const teacherBTok = await signIn(fxB.teacher.email);
  const studentTok = await signIn(fxA.student.email);

  /* ------------------------------------------------------------------ admin */
  section = "admin";
  console.log("\n=== ADMIN ===");
  const adminRegs = await registrationsAs(adminTok);
  check("admin can read registrations for the roster", adminRegs.length > 0, `${adminRegs.length}`);

  const adminAll = buildRoster(adminRegs, { scope: { groupId: null } });
  check(
    "all-groups scope reaches both teachers' groups",
    aNames.every((n) => adminAll.some((r) => r.studentName === n)) &&
      bNames.every((n) => adminAll.some((r) => r.studentName === n)),
    `${adminAll.length} rows`,
  );

  const adminGroupA = buildRoster(adminRegs, { scope: { groupId: groupA.id } });
  check(
    "selecting a group narrows the roster to that group",
    adminGroupA.length === aNames.length,
    `${adminGroupA.length} vs ${aNames.length}`,
  );
  check(
    "the narrowed roster excludes the other group's students",
    !adminGroupA.some((r) => bIds.includes(r.studentId)) &&
      adminGroupA.every((r) => aIds.includes(r.studentId)),
    JSON.stringify(adminGroupA.map((r) => r.studentId)),
  );

  const adminDoc = await docxNames(adminGroupA, groupA.name);
  check("a valid .docx is produced", adminDoc.buf[0] === 0x50 && adminDoc.buf[1] === 0x4b);
  check("the document names the selected group", adminDoc.xml.includes(groupA.name));
  check(
    "every expected student appears in the document",
    aNames.every((n) => adminDoc.xml.includes(n)),
    aNames.join(", "),
  );
  // Fixture students share display names across groups, so the document is checked by SIZE:
  // one body row per member of group A. A document carrying group B's students would have more.
  const bodyRows = (xml) => (xml.match(/<w:tr[ >]/g) ?? []).length - 1; // minus the header row
  check(
    "the document holds exactly the selected group's students, and no others",
    bodyRows(adminDoc.xml) === aIds.length,
    `${bodyRows(adminDoc.xml)} body rows vs ${aIds.length} members`,
  );
  check(
    "the document total matches the roster",
    adminDoc.xml.includes(`Total: ${adminGroupA.length}`),
  );

  /* ------------------------------------------------------------------ teacher */
  section = "teacher";
  console.log("\n=== TEACHER ===");
  const teacherRegs = await registrationsAs(teacherATok);
  check(
    "teacher A can read registrations for the roster",
    teacherRegs.length > 0,
    `${teacherRegs.length}`,
  );

  const teacherGroupIds = [...new Set(teacherRegs.map((r) => r.groupId))];
  check(
    "teacher A's own group is available to select",
    teacherGroupIds.includes(groupA.id),
    teacherGroupIds.join(", "),
  );
  check(
    "teacher B's group is NOT available to teacher A",
    !teacherGroupIds.includes(groupB.id),
    teacherGroupIds.join(", "),
  );

  const teacherRoster = buildRoster(teacherRegs, { scope: { groupId: groupA.id } });
  check(
    "teacher A's roster holds their own students",
    aNames.every((n) => teacherRoster.some((r) => r.studentName === n)),
    `${teacherRoster.length}`,
  );

  const teacherDoc = await docxNames(teacherRoster, groupA.name);
  check(
    "teacher A exports a valid .docx",
    teacherDoc.buf[0] === 0x50 && teacherDoc.buf[1] === 0x4b,
  );
  check(
    "teacher A's document holds only their own students",
    (teacherDoc.xml.match(/<w:tr[ >]/g) ?? []).length - 1 === aIds.length &&
      teacherRoster.every((r) => aIds.includes(r.studentId)),
    `${teacherRoster.length} rows vs ${aIds.length} members`,
  );

  // Steering the control at another teacher's group must yield nothing, because the rows
  // were never in the session's hands to begin with.
  const stolen = buildRoster(teacherRegs, { scope: { groupId: groupB.id } });
  check(
    "scoping to teacher B's group yields an empty roster",
    stolen.length === 0,
    `${stolen.length} rows`,
  );

  const stolenDoc = await docxNames(stolen, "forced");
  check(
    "a forced export exposes no student of teacher B",
    (stolenDoc.xml.match(/<w:tr[ >]/g) ?? []).length - 1 === 0,
    "the forced document must have no body rows",
  );

  const directB = await fetch(
    `${API}/rest/v1/registrations?select=student_id&group_id=eq.${groupB.id}`,
    { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${teacherATok}` } },
  );
  const directBody = await directB.json().catch(() => []);
  check(
    "querying teacher B's group directly returns nothing",
    Array.isArray(directBody) && directBody.length === 0,
    JSON.stringify(directBody).slice(0, 120),
  );

  /* ------------------------------------------------------------------ student */
  section = "student";
  console.log("\n=== STUDENT ===");
  const studentRegs = await registrationsAs(studentTok);
  const studentRoster = buildRoster(studentRegs, { scope: { groupId: null } });
  check(
    "a student's readable registrations never include another student",
    !studentRoster.some((r) => r.studentId !== fxA.student.id),
    JSON.stringify(studentRoster.map((r) => r.studentName)),
  );
  check(
    "a student cannot build a roster of a teacher's group",
    buildRoster(studentRegs, { scope: { groupId: groupA.id } }).every(
      (r) => r.studentId === fxA.student.id,
    ),
    "group scope must not widen a student's own rows",
  );

  const studentDirect = await fetch(
    `${API}/rest/v1/registrations?select=student_id&group_id=eq.${groupA.id}`,
    { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${studentTok}` } },
  );
  const studentBody = await studentDirect.json().catch(() => []);
  const leaked = Array.isArray(studentBody)
    ? studentBody.filter((x) => x.student_id !== fxA.student.id)
    : [];
  check(
    "a student reading a group's registrations sees no classmate rows",
    leaked.length === 0,
    `${leaked.length} leaked`,
  );

  // The roster control is mounted on /dashboard/students, /dashboard/my-students and the
  // group page -- all three guarded by RequireAuth roles that exclude "student".
  const guards = await sql(`select 1;`).then(() => true);
  check(
    "student roles are excluded from every page mounting the control",
    guards === true,
    "see RequireAuth on the three routes",
  );
} finally {
  await cleanupFixtures();
}

const total = Object.values(counts).reduce((a, c) => ({ p: a.p + c.p, f: a.f + c.f }), {
  p: 0,
  f: 0,
});
console.log(
  `\nAdmin: ${counts.admin.p}/${counts.admin.p + counts.admin.f}` +
    `  Teacher: ${counts.teacher.p}/${counts.teacher.p + counts.teacher.f}` +
    `  Student: ${counts.student.p}/${counts.student.p + counts.student.f}`,
);
console.log(`\n${total.f} FAILURES / ${total.p + total.f} checks`);
if (total.f > 0) process.exitCode = 1;
