/**
 * Payments -- persistence, authorization, integrity and audit, against the LOCAL stack.
 *
 * The arithmetic and form validation are unit tested (payment-model.test.ts). What only a
 * database can answer is whether the rules hold for real sessions:
 *
 *   - administrators manage money; teachers see and touch nothing; students read their own
 *   - a payment's identity (registration, recorder) cannot be edited by anyone
 *   - money is only recorded against an approved place, never dated in the future
 *   - a registration or group carrying payments cannot be deleted (RESTRICT, not CASCADE)
 *   - every insert, edit and delete lands in audit_log
 *   - the ledger query the screen uses returns the student's name (from `profiles`)
 *
 *   node scripts/e2e/verify-payments.mjs
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

const asUser = async (token, path, init = {}) => {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
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

const post = (token, rows) =>
  asUser(token, "payments", { method: "POST", body: JSON.stringify(rows) });
const patch = (token, id, fields) =>
  asUser(token, `payments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(fields) });
const del = (token, path) => asUser(token, path, { method: "DELETE" });

const one = async (query) => (await sql(query))[0];
const isoDaysFromNow = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/*
  The SAME embed the Payments screen sends (src/features/school/payments.ts, LEDGER_SELECT).
  Duplicated on purpose: this file cannot import TypeScript behind an `@/` alias, and the
  point of the check is that this exact shape works against the real schema.
*/
const LEDGER_SELECT =
  "id,amount_dzd,paid_on,method,note,reference,created_at,updated_at,recorded_by," +
  "registration:registrations!inner(id,student_id,group_id," +
  "student:students(profile:profiles(full_name,email)),group:groups(id,name))";

// A distinctive past day so the totals assertions are not disturbed by other local data.
const TOTALS_DAY = "2021-03-17";

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const other = await withFixtures({ teacher: true, student: true });
// A third student for the pending request: the one-place-per-subject rule (a real product
// rule) refuses a second request from a student already placed in this subject and level.
const third = await withFixtures({ student: true });

try {
  const group = await createGroupFixture({ teacherId: fx.teacher.id, studentCount: 0 });
  const reg = (
    await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
               values ('${fx.student.id}', '${group.id}', 'approved', now()) returning id;`)
  )[0].id;
  const otherGroup = await createGroupFixture({ teacherId: other.teacher.id, studentCount: 0 });
  const otherReg = (
    await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
               values ('${other.student.id}', '${otherGroup.id}', 'approved', now()) returning id;`)
  )[0].id;
  const pendingReg = (
    await sql(`insert into public.registrations (student_id, group_id, status)
               values ('${third.student.id}', '${group.id}', 'pending') returning id;`)
  )[0].id;

  const admin = await signIn(fx.admin.email);
  const teacher = await signIn(fx.teacher.email);
  const student = await signIn(fx.student.email);
  const foreignTeacher = await signIn(other.teacher.email);
  const otherStudent = await signIn(other.student.email);

  /* ------------------------------------------------------------------ create */
  console.log("\n--- 2. an administrator records money ---");
  const created = await post(admin, [
    {
      registration_id: reg,
      amount_dzd: 2000,
      method: "cheque",
      paid_on: TOTALS_DAY,
      note: "Premier versement",
      reference: "CHQ-0042",
      recorded_by: fx.admin.id,
    },
  ]);
  check(
    "admin can record a payment",
    created.status === 201,
    `HTTP ${created.status} ${JSON.stringify(created.body)}`,
  );
  const paymentId = created.body?.[0]?.id;
  const stored = await one(`select amount_dzd, method, reference, recorded_by
                              from public.payments where id = '${paymentId}';`);
  check(
    "it persisted with the values given",
    stored?.amount_dzd === 2000 && stored?.reference === "CHQ-0042",
    JSON.stringify(stored),
  );
  check(
    "it is attributed to the recorder",
    stored?.recorded_by === fx.admin.id,
    JSON.stringify(stored),
  );

  const defaulted = await post(admin, [
    { registration_id: reg, amount_dzd: 500, paid_on: TOTALS_DAY },
  ]);
  check(
    "omitting recorded_by still attributes the payment to the caller",
    defaulted.status === 201 && defaulted.body?.[0]?.recorded_by === fx.admin.id,
    `HTTP ${defaulted.status} ${JSON.stringify(defaulted.body)}`,
  );
  const secondId = defaulted.body?.[0]?.id;

  /* ------------------------------------------------------------------ list */
  console.log("\n--- 1 / 16. the ledger query the screen uses ---");
  const ledger = await asUser(
    admin,
    `payments?select=${LEDGER_SELECT}&paid_on=gte.${TOTALS_DAY}&paid_on=lte.${TOTALS_DAY}&order=paid_on.desc`,
  );
  check(
    "the ledger query succeeds (no 42703)",
    ledger.status === 200,
    `HTTP ${ledger.status} ${JSON.stringify(ledger.body)}`,
  );
  const row = (ledger.body ?? []).find?.((r) => r.id === paymentId);
  check(
    "it returns the student's name from profiles",
    row?.registration?.student?.profile?.full_name === fx.student.fullName,
    JSON.stringify(row?.registration),
  );
  check(
    "it returns the group's name",
    row?.registration?.group?.name === group.name,
    JSON.stringify(row?.registration?.group),
  );

  const byGroup = await asUser(
    admin,
    `payments?select=${LEDGER_SELECT}&registration.group_id=eq.${otherGroup.id}&paid_on=eq.${TOTALS_DAY}`,
  );
  check(
    "filtering by another group excludes this group's payments",
    byGroup.status === 200 && !(byGroup.body ?? []).some((r) => r.id === paymentId),
    `HTTP ${byGroup.status}`,
  );
  const byMethod = await asUser(
    admin,
    `payments?select=id&method=eq.cash&paid_on=eq.${TOTALS_DAY}`,
  );
  check(
    "filtering by method excludes a cheque payment",
    byMethod.status === 200 && !(byMethod.body ?? []).some((r) => r.id === paymentId),
    `HTTP ${byMethod.status}`,
  );

  /* ------------------------------------------------------------------ invalid values */
  console.log("\n--- 5 / 6 / 7. the database refuses invalid values ---");
  for (const [label, rowIn] of [
    ["a zero amount", { amount_dzd: 0 }],
    ["a negative amount", { amount_dzd: -500 }],
    ["a fractional amount", { amount_dzd: 1.5 }],
    ["an unknown method", { amount_dzd: 100, method: "bitcoin" }],
    ["a 501-character note", { amount_dzd: 100, note: "x".repeat(501) }],
    ["a 101-character reference", { amount_dzd: 100, reference: "r".repeat(101) }],
    ["a future date", { amount_dzd: 100, paid_on: isoDaysFromNow(3) }],
  ]) {
    const r = await post(admin, [{ registration_id: reg, ...rowIn }]);
    check(`${label} is refused`, r.status >= 400, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }

  /* ------------------------------------------------------------------ relationships */
  console.log("\n--- 13. relationships stay valid ---");
  const onMissing = await post(admin, [
    { registration_id: "00000000-0000-4000-8000-000000000000", amount_dzd: 100 },
  ]);
  check(
    "a payment against a registration that does not exist is refused",
    onMissing.status >= 400,
    `HTTP ${onMissing.status}`,
  );
  const onPending = await post(admin, [{ registration_id: pendingReg, amount_dzd: 100 }]);
  check(
    "a payment against a PENDING registration is refused",
    onPending.status >= 400,
    `HTTP ${onPending.status}`,
  );
  const impersonate = await post(admin, [
    { registration_id: reg, amount_dzd: 300, recorded_by: fx.teacher.id },
  ]);
  check(
    "a payment cannot be attributed to someone else",
    impersonate.status >= 400,
    `HTTP ${impersonate.status}`,
  );
  const moveReg = await patch(admin, paymentId, { registration_id: otherReg });
  const afterMove = await one(
    `select registration_id from public.payments where id = '${paymentId}';`,
  );
  check(
    "a payment cannot be moved to another registration",
    moveReg.status >= 400 && afterMove?.registration_id === reg,
    `HTTP ${moveReg.status} now=${afterMove?.registration_id}`,
  );
  const reattribute = await patch(admin, paymentId, { recorded_by: fx.teacher.id });
  const afterAttr = await one(`select recorded_by from public.payments where id = '${paymentId}';`);
  check(
    "a payment's recorder cannot be changed",
    reattribute.status >= 400 && afterAttr?.recorded_by === fx.admin.id,
    `HTTP ${reattribute.status}`,
  );

  /* ------------------------------------------------------------------ edit */
  console.log("\n--- 3. an administrator corrects a payment ---");
  const before = await one(`select updated_at from public.payments where id = '${paymentId}';`);
  const auditBeforeEdit = await one(`select count(*)::int c from public.audit_log
                                      where action = 'payment_updated' and details->>'payment_id' = '${paymentId}';`);
  const edit = await patch(admin, paymentId, {
    amount_dzd: 2500,
    method: "transfer",
    paid_on: "2021-03-16",
    note: "Corrigé",
    reference: "VIR-77",
  });
  const edited = await one(`select amount_dzd, method, paid_on::text, note, reference, updated_at
                              from public.payments where id = '${paymentId}';`);
  check(
    "admin can edit a payment",
    edit.status === 200 && edit.body?.length === 1,
    `HTTP ${edit.status}`,
  );
  check(
    "every editable field persisted",
    edited?.amount_dzd === 2500 &&
      edited?.method === "transfer" &&
      edited?.paid_on === "2021-03-16" &&
      edited?.note === "Corrigé" &&
      edited?.reference === "VIR-77",
    JSON.stringify(edited),
  );
  check(
    "updated_at moved",
    String(edited?.updated_at) !== String(before?.updated_at),
    `${before?.updated_at} -> ${edited?.updated_at}`,
  );
  const badEdit = await patch(admin, paymentId, { amount_dzd: -1 });
  check("an invalid edit is refused", badEdit.status >= 400, `HTTP ${badEdit.status}`);

  /* ------------------------------------------------------------------ audit */
  console.log("\n--- audit trail ---");
  const recAudit = await one(`select actor_id, target_id, details from public.audit_log
                               where action = 'payment_recorded' and details->>'payment_id' = '${paymentId}';`);
  check(
    "recording writes payment_recorded (actor admin, target student)",
    recAudit?.actor_id === fx.admin.id && recAudit?.target_id === fx.student.id,
    JSON.stringify(recAudit),
  );
  const updAudit = await sql(`select details from public.audit_log
                               where action = 'payment_updated' and details->>'payment_id' = '${paymentId}'
                               order by created_at desc;`);
  const b = updAudit[0]?.details?.before ?? {};
  const a = updAudit[0]?.details?.after ?? {};
  check(
    "editing writes exactly one payment_updated",
    updAudit.length === auditBeforeEdit.c + 1,
    `${updAudit.length} vs ${auditBeforeEdit.c + 1}`,
  );
  check(
    "the update's BEFORE holds all five original values",
    b.amount_dzd === 2000 &&
      b.paid_on === TOTALS_DAY &&
      b.method === "cheque" &&
      b.note === "Premier versement" &&
      b.reference === "CHQ-0042",
    JSON.stringify(b),
  );
  check(
    "the update's AFTER holds all five new values",
    a.amount_dzd === 2500 &&
      a.paid_on === "2021-03-16" &&
      a.method === "transfer" &&
      a.note === "Corrigé" &&
      a.reference === "VIR-77",
    JSON.stringify(a),
  );
  await patch(admin, paymentId, { amount_dzd: 2500 });
  const afterNoop = await one(`select count(*)::int c from public.audit_log
                                where action = 'payment_updated' and details->>'payment_id' = '${paymentId}';`);
  check(
    "an edit that changes nothing is not logged",
    afterNoop?.c === updAudit.length,
    `${afterNoop?.c} vs ${updAudit.length}`,
  );

  /* ------------------------------------------------------------------ audit is tamper-proof */
  console.log("\n--- nobody can alter the audit trail through the API ---");
  const auditId = (
    await one(`select id from public.audit_log
                where action = 'payment_recorded' and details->>'payment_id' = '${paymentId}';`)
  )?.id;
  const adminReadsAudit = await asUser(admin, `audit_log?select=id&id=eq.${auditId}`);
  check(
    "an administrator can read the audit entry",
    adminReadsAudit.body?.length === 1,
    JSON.stringify(adminReadsAudit.body),
  );
  for (const [who, tok] of [
    ["a student", student],
    ["a teacher", teacher],
    ["an administrator", admin],
  ]) {
    const read = await asUser(tok, `audit_log?select=id&id=eq.${auditId}`);
    if (tok !== admin) {
      check(
        `${who} cannot read the audit trail`,
        Array.isArray(read.body) && read.body.length === 0,
        JSON.stringify(read.body),
      );
    }
    const forge = await asUser(tok, "audit_log", {
      method: "POST",
      body: JSON.stringify([{ action: "payment_deleted", details: { forged: true } }]),
    });
    await asUser(tok, `audit_log?id=eq.${auditId}`, {
      method: "PATCH",
      body: JSON.stringify({ details: { tampered: true } }),
    });
    await asUser(tok, `audit_log?id=eq.${auditId}`, { method: "DELETE" });
    const intact = await one(`select details->>'payment_id' pid from public.audit_log
                               where id = '${auditId}';`);
    const forged = await one(`select count(*)::int c from public.audit_log
                               where details ? 'forged';`);
    check(
      `${who} cannot insert, edit or delete audit entries`,
      forge.status >= 400 && intact?.pid === paymentId && forged?.c === 0,
      `insert HTTP ${forge.status}; entry=${JSON.stringify(intact)}; forged=${forged?.c}`,
    );
  }
  // The trigger belongs to the table owner; `authenticated` owns nothing, so it cannot
  // `ALTER TABLE ... DISABLE TRIGGER`. Asserted on the catalogue, since PostgREST exposes no DDL.
  const triggerState = await one(`select tgenabled from pg_trigger
                                   where tgname = 't_payments_audit'
                                     and tgrelid = 'public.payments'::regclass;`);
  const owner = await one(`select pg_get_userbyid(relowner) o from pg_class
                            where oid = 'public.payments'::regclass;`);
  check(
    "the audit trigger is enabled and not owned by an API role",
    triggerState?.tgenabled === "O" && !["authenticated", "anon"].includes(owner?.o),
    `tgenabled=${triggerState?.tgenabled} owner=${owner?.o}`,
  );

  /* ------------------------------------------------------------------ teachers */
  console.log("\n--- 8 / 9. money is not a teacher's business ---");
  for (const [who, tok] of [
    ["the group's own teacher", teacher],
    ["another teacher", foreignTeacher],
  ]) {
    const read = await asUser(tok, "payments?select=id");
    check(
      `${who} reads no payments`,
      Array.isArray(read.body) && read.body.length === 0,
      JSON.stringify(read.body),
    );
    const totals = await asUser(tok, "payment_daily_totals?select=*");
    check(
      `${who} sees no totals`,
      Array.isArray(totals.body) && totals.body.length === 0,
      JSON.stringify(totals.body),
    );
  }
  const tInsert = await post(teacher, [{ registration_id: reg, amount_dzd: 100 }]);
  check("a teacher cannot record a payment", tInsert.status >= 400, `HTTP ${tInsert.status}`);
  await patch(teacher, paymentId, { amount_dzd: 1 });
  await del(teacher, `payments?id=eq.${paymentId}`);
  const afterTeacher = await one(
    `select amount_dzd from public.payments where id = '${paymentId}';`,
  );
  check(
    "a teacher cannot edit or delete a payment",
    afterTeacher?.amount_dzd === 2500,
    JSON.stringify(afterTeacher),
  );

  /* ------------------------------------------------------------------ students */
  console.log("\n--- 10 / 11 / 12. a student reads their own, and nothing else ---");
  const sInsert = await post(student, [
    { registration_id: reg, amount_dzd: 100, recorded_by: fx.student.id },
  ]);
  check("a student cannot record a payment", sInsert.status >= 400, `HTTP ${sInsert.status}`);
  await patch(student, paymentId, { amount_dzd: 1 });
  await del(student, `payments?id=eq.${paymentId}`);
  const afterStudent = await one(
    `select amount_dzd from public.payments where id = '${paymentId}';`,
  );
  check(
    "a student cannot edit or delete a payment",
    afterStudent?.amount_dzd === 2500,
    JSON.stringify(afterStudent),
  );

  const foreignPay = await post(admin, [
    { registration_id: otherReg, amount_dzd: 7777, paid_on: TOTALS_DAY },
  ]);
  const foreignPayId = foreignPay.body?.[0]?.id;
  const mine = await asUser(student, "payments?select=id,amount_dzd");
  const mineIds = (mine.body ?? []).map((p) => p.id);
  check(
    "a student reads their own payments",
    mineIds.includes(paymentId),
    JSON.stringify(mine.body),
  );
  check(
    "a student never reads another family's payment",
    !mineIds.includes(foreignPayId),
    JSON.stringify(mine.body),
  );
  const otherMine = await asUser(otherStudent, "payments?select=id");
  check(
    "the other family reads only theirs",
    (otherMine.body ?? []).length === 1 && otherMine.body[0].id === foreignPayId,
    JSON.stringify(otherMine.body),
  );

  /* ------------------------------------------------------------------ totals */
  console.log("\n--- 15. totals ---");
  const adminDay = await asUser(admin, `payment_daily_totals?select=*&paid_on=eq.${TOTALS_DAY}`);
  check(
    "admin totals for the day sum every payment on it",
    adminDay.body?.[0]?.total_dzd === 500 + 7777 && adminDay.body?.[0]?.payment_count === 2,
    JSON.stringify(adminDay.body),
  );
  const studentDays = await asUser(student, "payment_daily_totals?select=*");
  const studentSum = (studentDays.body ?? []).reduce((s, d) => s + Number(d.total_dzd), 0);
  check(
    "a student's totals cover only their own payments",
    studentSum === 2500 + 500,
    JSON.stringify(studentDays.body),
  );

  /* ------------------------------------------------------------------ integrity */
  console.log("\n--- 14. financial history survives deletions ---");
  const studentWithdraw = await del(student, `registrations?id=eq.${reg}`);
  const regStill = await one(
    `select count(*)::int c from public.registrations where id = '${reg}';`,
  );
  // Two layers now refuse this: the delete policy (students may delete PENDING rows only,
  // 20260930110000) matches zero rows, and RESTRICT would refuse it anyway.
  check(
    "a student cannot delete an approved registration that carries payments",
    regStill?.c === 1,
    `HTTP ${studentWithdraw.status} rows=${regStill?.c}`,
  );
  const adminRegDelete = await del(admin, `registrations?id=eq.${reg}`);
  const regStillAdmin = await one(
    `select count(*)::int c from public.registrations where id = '${reg}';`,
  );
  check(
    "an administrator cannot delete a registration that carries payments (23503)",
    adminRegDelete.status >= 400 && adminRegDelete.body?.code === "23503" && regStillAdmin?.c === 1,
    `HTTP ${adminRegDelete.status} ${JSON.stringify(adminRegDelete.body)}`,
  );
  const groupDelete = await del(admin, `groups?id=eq.${group.id}`);
  const groupStill = await one(
    `select count(*)::int c from public.groups where id = '${group.id}';`,
  );
  check(
    "an administrator cannot delete a group whose registrations carry payments (23503)",
    groupDelete.status >= 400 && groupDelete.body?.code === "23503" && groupStill?.c === 1,
    `HTTP ${groupDelete.status} ${JSON.stringify(groupDelete.body)}`,
  );
  const paymentsStill = await one(
    `select count(*)::int c from public.payments where registration_id = '${reg}';`,
  );
  check("no payment was lost", paymentsStill?.c === 2, JSON.stringify(paymentsStill));

  /* ------------------------------------------------------------------ delete */
  console.log("\n--- 4. an administrator deletes a payment recorded in error ---");
  const d1 = await del(admin, `payments?id=eq.${secondId}`);
  const gone = await one(`select count(*)::int c from public.payments where id = '${secondId}';`);
  check("admin can delete a payment", d1.status === 200 && gone?.c === 0, `HTTP ${d1.status}`);
  const delAudit = await one(`select actor_id, target_id, details from public.audit_log
                               where action = 'payment_deleted' and details->>'payment_id' = '${secondId}';`);
  check(
    "deleting writes payment_deleted with the amount",
    delAudit?.actor_id === fx.admin.id && delAudit?.details?.payment?.amount_dzd === 500,
    JSON.stringify(delAudit),
  );
  const recordedSurvives = await one(`select count(*)::int c from public.audit_log
                                       where action = 'payment_recorded'
                                         and details->>'payment_id' = '${secondId}';`);
  check(
    "the payment's audit history survives its deletion",
    recordedSurvives?.c === 1,
    JSON.stringify(recordedSurvives),
  );
  await del(admin, `payments?id=eq.${paymentId}`);
  const regDelete = await del(admin, `registrations?id=eq.${reg}`);
  check(
    "once its payments are removed, the registration can be deleted",
    regDelete.status === 200 && regDelete.body?.length === 1,
    `HTTP ${regDelete.status}`,
  );
} finally {
  await cleanupFixtures();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
