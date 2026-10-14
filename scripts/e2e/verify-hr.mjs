/**
 * HR foundation -- schema rules, history preservation, RLS, private documents, audit and
 * teacher integration, against the LOCAL stack (20261001110100_hr_foundation.sql).
 *
 *   node scripts/e2e/verify-hr.mjs
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
const rows = (r) => (Array.isArray(r.body) ? r.body : []);

const storage = (token, path, init = {}) =>
  fetch(`${API}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
const PDF = new TextEncoder().encode("%PDF-1.4\n% e2e hr document\n%%EOF\n");

const isoDaysFromNow = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const other = await withFixtures({ teacher: true });

try {
  const admin = await signIn(fx.admin.email);
  const teacher = await signIn(fx.teacher.email);
  const student = await signIn(fx.student.email);
  const otherTeacher = await signIn(other.teacher.email);

  /* ------------------------------------------------------------------ employee */
  console.log("\n--- employee files ---");
  const created = await post(admin, "employees", {
    profile_id: fx.teacher.id,
    staff_type: "teacher",
    position: "Enseignant de mathématiques",
    start_date: "2026-09-01",
    employee_code: "E2E-001",
  });
  check(
    "an administrator opens an HR file for a teacher account",
    created.status === 201,
    `HTTP ${created.status} ${JSON.stringify(created.body)}`,
  );
  const empId = created.body?.[0]?.id;
  check(
    "it starts active and attributed",
    created.body?.[0]?.employment_status === "active" &&
      created.body?.[0]?.created_by === fx.admin.id,
    JSON.stringify(created.body?.[0]),
  );

  const otherEmp = await post(admin, "employees", {
    profile_id: other.teacher.id,
    staff_type: "trainer",
    start_date: "2026-01-01",
  });
  const otherEmpId = otherEmp.body?.[0]?.id;

  const second = await post(admin, "employees", { profile_id: fx.teacher.id });
  check(
    "a second HR file for the same person is refused (23505)",
    second.status >= 400 && second.body?.code === "23505",
    `HTTP ${second.status}`,
  );
  const dupCode = await post(admin, "employees", {
    profile_id: fx.admin.id,
    employee_code: " e2e-001 ",
  });
  check(
    "a staff code already in use is refused, case/space-insensitive",
    dupCode.status >= 400 && dupCode.body?.code === "23505",
    `HTTP ${dupCode.status}`,
  );

  for (const [label, fields] of [
    ["an unknown staff type", { staff_type: "janitor" }],
    ["an unknown employment status", { employment_status: "fired" }],
    ["an end date before the start", { end_date: "2026-08-01" }],
    ["'ended' without an end date", { employment_status: "ended" }],
    ["a 121-character position", { position: "p".repeat(121) }],
  ]) {
    const r = await patch(admin, `employees?id=eq.${empId}`, fields);
    check(`${label} is refused`, r.status >= 400, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
  const edit = await patch(admin, `employees?id=eq.${empId}`, {
    department: "Sciences",
    employment_status: "on_leave",
    notes: "Note RH privée",
  });
  check(
    "an administrator edits employment information",
    edit.status === 200 && edit.body?.[0]?.employment_status === "on_leave",
    `HTTP ${edit.status}`,
  );
  const moveFile = await patch(admin, `employees?id=eq.${empId}`, { profile_id: fx.admin.id });
  const stillOwn = await one(`select profile_id from public.employees where id = '${empId}';`);
  check(
    "an HR file cannot be moved to another person",
    moveFile.status >= 400 && stillOwn?.profile_id === fx.teacher.id,
    `HTTP ${moveFile.status}`,
  );
  const ended = await patch(admin, `employees?id=eq.${otherEmpId}`, {
    employment_status: "ended",
    end_date: "2026-09-30",
  });
  check(
    "lifecycle: ending employment with an end date is allowed",
    ended.status === 200,
    `HTTP ${ended.status}`,
  );
  const delEmp = await del(admin, `employees?id=eq.${otherEmpId}`);
  const empStill = await one(
    `select count(*)::int c from public.employees where id = '${otherEmpId}';`,
  );
  check(
    "an HR file is never deleted through the API, even by an admin",
    empStill?.c === 1,
    `HTTP ${delEmp.status}`,
  );
  const banned = await one(`select banned_until from auth.users where id = '${other.teacher.id}';`);
  check(
    "ending employment does not touch the account (no ban)",
    banned?.banned_until === null,
    JSON.stringify(banned),
  );
  await patch(admin, `employees?id=eq.${empId}`, { employment_status: "active" });

  /* ------------------------------------------------------------------ contracts */
  console.log("\n--- contracts keep their history ---");
  const c1 = await post(admin, "employee_contracts", {
    employee_id: empId,
    contract_type: "fixed_term",
    working_time: "part_time",
    start_date: "2026-09-01",
    end_date: "2027-06-30",
  });
  check(
    "a fixed-term, part-time contract is created",
    c1.status === 201,
    `HTTP ${c1.status} ${JSON.stringify(c1.body)}`,
  );
  const c1Id = c1.body?.[0]?.id;
  const c2 = await post(admin, "employee_contracts", {
    employee_id: empId,
    contract_type: "permanent",
    start_date: "2026-10-01",
  });
  check(
    "a second ACTIVE contract is refused (one at a time)",
    c2.status >= 400 && c2.body?.code === "23505",
    `HTTP ${c2.status}`,
  );
  for (const [label, row] of [
    [
      "a fixed-term contract without an end date",
      { contract_type: "fixed_term", start_date: "2026-09-01", status: "ended" },
    ],
    [
      "a contract ending before it starts",
      {
        contract_type: "permanent",
        start_date: "2026-09-01",
        end_date: "2026-01-01",
        status: "ended",
      },
    ],
    [
      "an unknown contract type",
      { contract_type: "karaoke", start_date: "2026-09-01", status: "cancelled" },
    ],
    [
      "an 'ended' contract without an end date",
      { contract_type: "permanent", start_date: "2026-09-01", status: "ended" },
    ],
  ]) {
    const r = await post(admin, "employee_contracts", { employee_id: empId, ...row });
    check(`${label} is refused`, r.status >= 400, `HTTP ${r.status}`);
  }
  const editContract = await patch(admin, `employee_contracts?id=eq.${c1Id}`, { notes: "Avenant" });
  check(
    "an administrator edits a contract",
    editContract.status === 200,
    `HTTP ${editContract.status}`,
  );
  const endContract = await patch(admin, `employee_contracts?id=eq.${c1Id}`, {
    status: "ended",
    end_date: "2026-12-31",
  });
  check(
    "a contract is ended rather than deleted",
    endContract.status === 200,
    `HTTP ${endContract.status}`,
  );
  const c3 = await post(admin, "employee_contracts", {
    employee_id: empId,
    contract_type: "permanent",
    working_time: "full_time",
    start_date: "2027-01-01",
  });
  check("after ending it, a new active contract can start", c3.status === 201, `HTTP ${c3.status}`);
  const delContract = await del(admin, `employee_contracts?id=eq.${c1Id}`);
  const history = await one(
    `select count(*)::int c from public.employee_contracts where employee_id = '${empId}';`,
  );
  check(
    "contracts are never deleted: the history holds both",
    history?.c === 2,
    `HTTP ${delContract.status} count=${history?.c}`,
  );

  /* ------------------------------------------------------------------ availability */
  console.log("\n--- availability ---");
  const a1 = await post(admin, "employee_availability", {
    employee_id: empId,
    weekday: 1,
    start_time: "09:00",
    end_time: "12:00",
  });
  check("an availability range is created", a1.status === 201, `HTTP ${a1.status}`);
  const a1Id = a1.body?.[0]?.id;
  const inverted = await post(admin, "employee_availability", {
    employee_id: empId,
    weekday: 2,
    start_time: "12:00",
    end_time: "09:00",
  });
  check("an end before the start is refused", inverted.status >= 400, `HTTP ${inverted.status}`);
  const badDay = await post(admin, "employee_availability", {
    employee_id: empId,
    weekday: 7,
    start_time: "09:00",
    end_time: "10:00",
  });
  check("an impossible weekday is refused", badDay.status >= 400, `HTTP ${badDay.status}`);
  const overlap = await post(admin, "employee_availability", {
    employee_id: empId,
    weekday: 1,
    start_time: "11:00",
    end_time: "13:00",
  });
  check(
    "an overlapping range on the same day is refused (23514)",
    overlap.status >= 400 && overlap.body?.code === "23514",
    `HTTP ${overlap.status}`,
  );
  const adjacent = await post(admin, "employee_availability", {
    employee_id: empId,
    weekday: 1,
    start_time: "14:00",
    end_time: "18:00",
  });
  check(
    "a separate afternoon range is allowed",
    adjacent.status === 201,
    `HTTP ${adjacent.status}`,
  );
  const editAv = await patch(admin, `employee_availability?id=eq.${a1Id}`, { end_time: "12:30" });
  check("an availability range is edited", editAv.status === 200, `HTTP ${editAv.status}`);

  /* ------------------------------------------------------------------ staff attendance */
  console.log("\n--- working time ---");
  const t1 = await post(admin, "staff_attendance", {
    employee_id: empId,
    work_date: "2026-09-15",
    status: "present",
    check_in: "08:30",
    check_out: "12:00",
  });
  check(
    "a working day is recorded",
    t1.status === 201,
    `HTTP ${t1.status} ${JSON.stringify(t1.body)}`,
  );
  check(
    "worked minutes are derived by the database (210)",
    t1.body?.[0]?.worked_minutes === 210,
    JSON.stringify(t1.body?.[0]),
  );
  const t1Id = t1.body?.[0]?.id;
  const sameDay = await post(admin, "staff_attendance", {
    employee_id: empId,
    work_date: "2026-09-15",
    status: "late",
    check_in: "09:00",
  });
  check(
    "a second record for the same day is refused (23505)",
    sameDay.status >= 400 && sameDay.body?.code === "23505",
    `HTTP ${sameDay.status}`,
  );
  for (const [label, row] of [
    [
      "check-out before check-in",
      { work_date: "2026-09-16", status: "present", check_in: "12:00", check_out: "08:00" },
    ],
    ["present without a check-in", { work_date: "2026-09-17", status: "present" }],
    ["absent with times", { work_date: "2026-09-18", status: "absent", check_in: "08:00" }],
    [
      "a check-out without a check-in",
      { work_date: "2026-09-19", status: "partial", check_out: "10:00" },
    ],
    ["a future date", { work_date: isoDaysFromNow(5), status: "absent" }],
    [
      "a forged worked_minutes",
      {
        work_date: "2026-09-20",
        status: "present",
        check_in: "08:00",
        check_out: "09:00",
        worked_minutes: 900,
      },
    ],
  ]) {
    const r = await post(admin, "staff_attendance", { employee_id: empId, ...row });
    check(`${label} is refused`, r.status >= 400, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
  const fixTime = await patch(admin, `staff_attendance?id=eq.${t1Id}`, { check_out: "12:30" });
  check(
    "a correction recomputes the duration (240)",
    fixTime.status === 200 && fixTime.body?.[0]?.worked_minutes === 240,
    JSON.stringify(fixTime.body),
  );

  /* ------------------------------------------------------------------ leave */
  console.log("\n--- leave ---");
  const l1 = await post(admin, "employee_leaves", {
    employee_id: empId,
    leave_type: "annual",
    start_date: "2026-12-20",
    end_date: "2026-12-31",
  });
  check(
    "a leave is requested (pending)",
    l1.status === 201 && l1.body?.[0]?.status === "pending",
    `HTTP ${l1.status}`,
  );
  const l1Id = l1.body?.[0]?.id;
  const badLeave = await post(admin, "employee_leaves", {
    employee_id: empId,
    leave_type: "annual",
    start_date: "2026-12-10",
    end_date: "2026-12-01",
  });
  check(
    "a leave ending before it starts is refused",
    badLeave.status >= 400,
    `HTTP ${badLeave.status}`,
  );
  const overlapLeave = await post(admin, "employee_leaves", {
    employee_id: empId,
    leave_type: "training",
    start_date: "2026-12-28",
    end_date: "2027-01-03",
  });
  check(
    "an overlapping leave is refused (23514)",
    overlapLeave.status >= 400 && overlapLeave.body?.code === "23514",
    `HTTP ${overlapLeave.status}`,
  );
  const approve = await patch(admin, `employee_leaves?id=eq.${l1Id}`, {
    status: "approved",
    decided_by: fx.admin.id,
    decided_at: new Date().toISOString(),
  });
  check(
    "an administrator approves it",
    approve.status === 200 && approve.body?.[0]?.status === "approved",
    `HTTP ${approve.status}`,
  );
  const l2 = await post(admin, "employee_leaves", {
    employee_id: empId,
    leave_type: "unpaid",
    start_date: "2027-02-01",
    end_date: "2027-02-02",
  });
  const reject = await patch(admin, `employee_leaves?id=eq.${l2.body?.[0]?.id}`, {
    status: "rejected",
  });
  check(
    "an administrator rejects another",
    reject.status === 200 && reject.body?.[0]?.status === "rejected",
    `HTTP ${reject.status}`,
  );
  const afterReject = await post(admin, "employee_leaves", {
    employee_id: empId,
    leave_type: "other",
    start_date: "2027-02-01",
    end_date: "2027-02-01",
  });
  check(
    "a rejected leave does not block the same dates",
    afterReject.status === 201,
    `HTTP ${afterReject.status}`,
  );
  const delLeave = await del(admin, `employee_leaves?id=eq.${l1Id}`);
  const leaveStill = await one(
    `select count(*)::int c from public.employee_leaves where id = '${l1Id}';`,
  );
  check(
    "leave records are never deleted (cancel instead)",
    leaveStill?.c === 1,
    `HTTP ${delLeave.status}`,
  );

  /* ------------------------------------------------------------------ RLS */
  console.log("\n--- nobody but administrators sees HR ---");
  const tables = [
    "employees",
    "employee_contracts",
    "employee_availability",
    "staff_attendance",
    "employee_leaves",
    "employee_documents",
  ];
  for (const [who, tok] of [
    ["the teacher themself", teacher],
    ["another teacher", otherTeacher],
    ["a student", student],
    ["an anonymous visitor", null],
  ]) {
    let seen = 0;
    let errs = 0;
    for (const t of tables) {
      const r = await api(tok, `${t}?select=id`);
      if (r.status >= 400) errs++;
      else seen += rows(r).length;
    }
    check(`${who} reads nothing from any HR table`, seen === 0, `rows=${seen} refused=${errs}`);
  }
  const tWrite = await post(teacher, "staff_attendance", {
    employee_id: empId,
    work_date: "2026-09-22",
    status: "present",
    check_in: "08:00",
  });
  check(
    "a teacher cannot record their own working time",
    tWrite.status >= 400,
    `HTTP ${tWrite.status}`,
  );
  const tContract = await post(teacher, "employee_contracts", {
    employee_id: empId,
    contract_type: "permanent",
    start_date: "2026-01-01",
    status: "cancelled",
  });
  check("a teacher cannot create a contract", tContract.status >= 400, `HTTP ${tContract.status}`);
  await patch(teacher, `employees?id=eq.${empId}`, { notes: "hijacked" });
  await patch(student, `employees?id=eq.${empId}`, { notes: "hijacked" });
  const notes = await one(`select notes from public.employees where id = '${empId}';`);
  check(
    "teachers and students cannot edit an HR file",
    notes?.notes === "Note RH privée",
    JSON.stringify(notes),
  );
  const sLeave = await post(student, "employee_leaves", {
    employee_id: empId,
    leave_type: "annual",
    start_date: "2027-03-01",
    end_date: "2027-03-02",
  });
  check("a student cannot create a leave", sLeave.status >= 400, `HTTP ${sLeave.status}`);

  /* ------------------------------------------------------------------ documents */
  console.log("\n--- HR documents are private ---");
  const path = `${empId}/e2e-contract.pdf`;
  const up = await storage(admin, `object/hr-documents/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: PDF,
  });
  check(
    "an administrator uploads to the private bucket",
    up.status === 200,
    `HTTP ${up.status} ${await up.clone().text()}`,
  );
  const doc = await post(admin, "employee_documents", {
    employee_id: empId,
    category: "contract",
    title: "Contrat 2026",
    storage_path: path,
    file_name: "contract.pdf",
    mime_type: "application/pdf",
    size_bytes: PDF.length,
    contract_id: c1Id,
  });
  check(
    "the document is recorded",
    doc.status === 201,
    `HTTP ${doc.status} ${JSON.stringify(doc.body)}`,
  );
  const docId = doc.body?.[0]?.id;

  const adminGet = await storage(admin, `object/authenticated/hr-documents/${path}`);
  check("an administrator can download it", adminGet.status === 200, `HTTP ${adminGet.status}`);
  const adminSign = await storage(admin, `object/sign/hr-documents/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  check(
    "an administrator can mint a signed URL",
    adminSign.status === 200,
    `HTTP ${adminSign.status}`,
  );
  for (const [who, tok] of [
    ["the teacher themself", teacher],
    ["another teacher", otherTeacher],
    ["a student", student],
  ]) {
    const g = await storage(tok, `object/authenticated/hr-documents/${path}`);
    const s = await storage(tok, `object/sign/hr-documents/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    });
    check(
      `${who} can neither download nor sign the document`,
      g.status >= 400 && s.status >= 400,
      `get=${g.status} sign=${s.status}`,
    );
  }
  const anonPublic = await fetch(`${API}/storage/v1/object/public/hr-documents/${path}`);
  check(
    "there is no public URL for an HR document",
    anonPublic.status >= 400,
    `HTTP ${anonPublic.status}`,
  );
  const tUpload = await storage(teacher, `object/hr-documents/${empId}/forged.pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: PDF,
  });
  check(
    "a teacher cannot upload into the HR bucket",
    tUpload.status >= 400,
    `HTTP ${tUpload.status}`,
  );
  const svg = await storage(admin, `object/hr-documents/${empId}/x.svg`, {
    method: "POST",
    headers: { "Content-Type": "image/svg+xml" },
    body: new TextEncoder().encode("<svg/>"),
  });
  check("an SVG is refused even for an administrator", svg.status >= 400, `HTTP ${svg.status}`);
  const stray = await storage(admin, `object/hr-documents/not-an-employee/x.pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: PDF,
  });
  check(
    "objects must live under an existing employee's folder",
    stray.status >= 400,
    `HTTP ${stray.status}`,
  );
  const tDelDoc = await del(teacher, `employee_documents?id=eq.${docId}`);
  const docStill = await one(
    `select count(*)::int c from public.employee_documents where id = '${docId}';`,
  );
  check("a teacher cannot delete a document record", docStill?.c === 1, `HTTP ${tDelDoc.status}`);

  /* ------------------------------------------------------------------ audit */
  console.log("\n--- every HR change is audited ---");
  const audit = await sql(`select details->>'entity' entity, action::text action
                             from public.audit_log where target_id = '${fx.teacher.id}' and action::text like 'hr_%';`);
  const has = (entity, action) => audit.some((a) => a.entity === entity && a.action === action);
  check(
    "file creation and edits are audited",
    has("employees", "hr_created") && has("employees", "hr_updated"),
    JSON.stringify(audit.length),
  );
  check(
    "contracts, availability, time, leave and documents are audited",
    has("employee_contracts", "hr_created") &&
      has("employee_contracts", "hr_updated") &&
      has("employee_availability", "hr_created") &&
      has("staff_attendance", "hr_updated") &&
      has("employee_leaves", "hr_updated") &&
      has("employee_documents", "hr_created"),
    JSON.stringify([...new Set(audit.map((a) => `${a.entity}:${a.action}`))]),
  );
  const leaveDecision = await one(`select details from public.audit_log
                                    where action = 'hr_updated' and details->>'entity' = 'employee_leaves'
                                      and details->>'record_id' = '${l1Id}' order by created_at desc limit 1;`);
  check(
    "a leave approval records before/after status",
    leaveDecision?.details?.before?.status === "pending" &&
      leaveDecision?.details?.after?.status === "approved",
    JSON.stringify(leaveDecision?.details),
  );
  // Counted before and after, not by time window: a fast run can put a legitimate update
  // within any window, which made an earlier version of this check flaky.
  const countEmployeeUpdates = async () =>
    (
      await one(`select count(*)::int c from public.audit_log where action = 'hr_updated'
                   and details->>'entity' = 'employees' and target_id = '${fx.teacher.id}';`)
    )?.c;
  const beforeNoop = await countEmployeeUpdates();
  const noopPatch = await patch(admin, `employees?id=eq.${empId}`, { department: "Sciences" });
  const afterNoop = await countEmployeeUpdates();
  check(
    "an update that changes nothing is not audited",
    noopPatch.status === 200 && afterNoop === beforeNoop,
    `${beforeNoop} -> ${afterNoop}`,
  );
  const delDoc = await del(admin, `employee_documents?id=eq.${docId}`);
  const docAudit = await one(
    `select count(*)::int c from public.audit_log where action = 'hr_deleted' and details->>'record_id' = '${docId}';`,
  );
  check(
    "removing a document is allowed for an admin and audited",
    delDoc.status === 200 && docAudit?.c === 1,
    `HTTP ${delDoc.status}`,
  );

  /* ------------------------------------------------------------------ teacher integration */
  console.log("\n--- the teacher system keeps working, and HR history protects the account ---");
  const group = await createGroupFixture({ teacherId: fx.teacher.id, studentCount: 1 });
  const teacherGroups = await api(teacher, `groups?select=id&teacher_id=eq.${fx.teacher.id}`);
  check(
    "the teacher still reads their groups",
    rows(teacherGroups).some((g) => g.id === group.id),
    JSON.stringify(teacherGroups.body),
  );
  const adminSchedule = await api(
    admin,
    `groups?select=id,group_schedules(weekday,start_time,end_time)&teacher_id=eq.${fx.teacher.id}`,
  );
  check(
    "HR reads the teacher's schedule from groups (no copy)",
    rows(adminSchedule).length === 1 && rows(adminSchedule)[0].group_schedules.length === 1,
    JSON.stringify(adminSchedule.body),
  );
  const deps = await sql(
    `select source_table, row_count, severity from private.entity_dependencies('teacher', '${fx.teacher.id}');`,
  );
  const hrDep = deps.find((d) => d.source_table === "employees");
  check(
    "the HR file is reported as a blocking dependency for deletion",
    hrDep?.row_count === 1 && hrDep?.severity === "blocking",
    JSON.stringify(deps),
  );
  let deleteRefused = false;
  try {
    await sql(`delete from public.profiles where id = '${fx.teacher.id}';`);
  } catch {
    deleteRefused = true;
  }
  check("the database itself refuses to delete a person with an HR file", deleteRefused);
  const noHr = await sql(
    `select severity from private.entity_dependencies('teacher', '${fx.admin.id}') where source_table = 'employees';`,
  );
  check(
    "a staff member without an HR file is unaffected",
    noHr[0]?.severity === "blocking" &&
      (
        await one(
          `select count(*)::int c from public.employees where profile_id = '${fx.admin.id}';`,
        )
      ).c === 0,
    JSON.stringify(noHr),
  );
} finally {
  await cleanupFixtures();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
