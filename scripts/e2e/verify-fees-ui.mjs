/**
 * Fees and installments end to end (20261006100100_fees_installments.sql, ADR-005).
 *
 *   student page (administrator): the « Frais et échéances » section keeps what the student OWES
 *     apart from what they have PAID; a one-installment fee and a fee split in monthly
 *     installments are added; the form refuses a schedule that does not add up and an "Autre"
 *     fee without a label; a duplicate is refused by the database; a fee is rescheduled and
 *     cancelled (with a reason, kept and struck through); payments are never created or changed
 *   teacher: sees the student page without any money
 *   Arabic: right to left, and no sideways page scroll on a phone
 *
 * Every outcome is checked in the database too. LOCAL ONLY (fixtures.mjs refuses any non-loopback
 * API); needs the dev server (BASE_URL, default http://localhost:8080).
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e/verify-fees-ui.mjs
 */

import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, sql } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const TAG = "e2e-fixture";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const FORMATION = `${TAG} FEE Anglais ${RUN}`;
const GROUP = `${TAG} FEE Samedi ${RUN}`;

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => iso(new Date(Date.now() + days * 86400000));
const digits = (s) => Number((s ?? "").replace(/\D/g, "") || 0);

const browser = await chromium.launch();
const adminCtx = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
  timezoneId: "UTC",
});
const page = await adminCtx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const one = async (q) => (await sql(q))[0];
const text = async (p, selector) =>
  ((await p.locator(selector).first().textContent()) ?? "").trim();
const pick = async (p, triggerSelector, optionName) => {
  await p.click(triggerSelector);
  await p.getByRole("option", { name: optionName, exact: true }).click();
};

async function login(p, who) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForTimeout(1000);
  await p.fill('input[type="email"]', who.email);
  await p.fill('input[type="password"]', who.password);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/dashboard/, { timeout: 60000 });
}

const dialog = () => page.getByRole("dialog");
const rowAmount = (n) => dialog().getByLabel(`Montant de l'échéance ${n}`, { exact: true });
const save = () => dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
const studentUrl = () => `${BASE}/dashboard/students/${fx.student.id}`;
const openStudent = async (p = page) => {
  await p.goto(studentUrl());
  await p.getByTestId("fees-section").waitFor({ timeout: 30000 });
  await p.getByTestId("fee-enrollment").first().waitFor({ timeout: 30000 });
};
const charges = (where = "true") =>
  sql(`select c.id::text id, c.fee_type, c.label, c.amount_dzd, c.status, c.cancel_reason,
              (select json_agg(json_build_object('p', i.position, 'a', i.amount_dzd, 'd', i.due_on) order by i.position)
                 from public.charge_installments i where i.charge_id = c.id) inst
         from public.charges c where c.registration_id = '${REG}' and ${where} order by c.created_at;`);

let REG = "";
let teacherCtx;
try {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  const formation = await one(`insert into public.programs (name, category, status)
      values ('${FORMATION}', 'language', 'active') returning id::text id;`);
  const group = await one(`insert into public.groups (name, program_id, max_students, teacher_id)
      values ('${GROUP}', '${formation.id}', 10, '${fx.teacher.id}') returning id::text id;`);
  REG = (
    await one(`insert into public.registrations (student_id, group_id, status, decided_at)
      values ('${fx.student.id}', '${group.id}', 'approved', now()) returning id::text id;`)
  ).id;
  // Money already received before any fee exists: 15 000 DZD, today.
  await sql(`insert into public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
             values ('${REG}', 15000, current_date, 'cash', '${fx.admin.id}');`);

  await login(page, fx.admin);

  /* ------------------------------------------------------------------ 1. empty state */
  console.log("\n--- 1. the section before any fee ---");
  await openStudent();
  const enrollmentText = await text(page, '[data-testid="fee-enrollment"]');
  check(
    "the enrollment is listed with no fee yet, and the payment already received",
    enrollmentText.includes(GROUP) &&
      enrollmentText.includes("Aucuns frais pour cette inscription.") &&
      enrollmentText.includes("Espèces"),
    enrollmentText.slice(0, 200),
  );
  check(
    "owed and paid are separate figures: 0 due, 15 000 paid, shown as paid beyond the fees",
    digits(await text(page, '[data-testid="fees-total-due"]')) === 0 &&
      digits(await text(page, '[data-testid="fees-total-paid"]')) === 15000 &&
      enrollmentText.includes("Payé en plus des frais"),
  );

  /* ------------------------------------------------------------------ 2. a single due date */
  console.log("\n--- 2. a one-installment fee ---");
  const regDue = shift(10);
  await page.getByTestId("fee-add").click();
  await dialog().waitFor();
  await pick(page, "#fee-type", "Frais d'inscription");
  await page.fill("#fee-amount", "3000");
  await page.fill("#fee-first-due", regDue);
  await save();
  // The dialog closes only once the save succeeded (a toast from an earlier save may linger).
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  let rows = await charges();
  check(
    "the fee is stored on the enrollment with one installment",
    rows.length === 1 &&
      rows[0].fee_type === "registration" &&
      rows[0].amount_dzd === 3000 &&
      rows[0].inst?.length === 1 &&
      rows[0].inst[0].d === regDue,
    JSON.stringify(rows),
  );

  /* ------------------------------------------------------------------ 3. monthly installments */
  console.log("\n--- 3. a fee split in three monthly installments ---");
  // About 40 days ago: installment 1 and 2 are past (2 about 10 days ago), installment 3 ahead.
  const first = shift(-40);
  await page.getByTestId("fee-add").click();
  await dialog().waitFor();
  await page.fill("#fee-amount", "30000"); // the type defaults to « Frais de formation »
  await pick(page, "#fee-count", "3");
  await page.fill("#fee-first-due", first);
  const split = [
    await rowAmount(1).inputValue(),
    await rowAmount(2).inputValue(),
    await rowAmount(3).inputValue(),
  ];
  const totalLine = await text(page, '[data-testid="fee-schedule-total"]');
  check(
    "the form splits the amount evenly into monthly rows that add up",
    split.join(",") === "10000,10000,10000" &&
      totalLine.includes("30") &&
      !/text-destructive/.test(
        (await page.getByTestId("fee-schedule-total").getAttribute("class")) ?? "",
      ),
    `${split} / ${totalLine}`,
  );
  await page.fill("#fee-label", "Trimestre 1");
  await save();
  // The dialog closes only once the save succeeded (a toast from an earlier save may linger).
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  rows = await charges("c.fee_type = 'tuition'");
  check(
    "three installments are stored in due-date order, summing to the fee",
    rows.length === 1 &&
      rows[0].label === "Trimestre 1" &&
      rows[0].inst?.map((i) => `${i.p}:${i.a}`).join(",") === "1:10000,2:10000,3:10000" &&
      rows[0].inst[0].d === first,
    JSON.stringify(rows),
  );

  // 15 000 paid, oldest due first: installment 1 paid, installment 2 half covered and late.
  await page.waitForTimeout(500);
  const statuses = await page
    .locator('[data-testid="fee-installment"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(
    "installment status is derived from the payments, oldest due date first",
    JSON.stringify(statuses) === JSON.stringify(["upcoming", "paid", "overdue", "upcoming"]),
    JSON.stringify(statuses),
  );
  check(
    "totals: 33 000 due, 15 000 paid, 18 000 left, 5 000 overdue",
    digits(await text(page, '[data-testid="fees-total-due"]')) === 33000 &&
      digits(await text(page, '[data-testid="fees-total-paid"]')) === 15000 &&
      digits(await text(page, '[data-testid="fees-total-remaining"]')) === 18000 &&
      digits(await text(page, '[data-testid="fees-total-overdue"]')) === 5000,
  );

  /* ------------------------------------------------------------------ 4. refused drafts */
  console.log("\n--- 4. what the form refuses ---");
  await page.getByTestId("fee-add").click();
  await dialog().waitFor();
  await pick(page, "#fee-type", "Autre");
  await page.fill("#fee-amount", "1000");
  await pick(page, "#fee-count", "2");
  await rowAmount(1).fill("900");
  await save();
  await page.waitForTimeout(400);
  const dialogText = (await dialog().textContent()) ?? "";
  check(
    "a schedule that does not add up and an « Autre » fee without a label are refused in the form",
    dialogText.includes("Indiquez à quoi correspondent ces frais.") && (await dialog().isVisible()),
    dialogText.slice(0, 300),
  );
  await page.fill("#fee-label", "Sortie");
  await save();
  await page.waitForTimeout(400);
  check(
    "with a label, the mismatched schedule is still refused",
    ((await dialog().textContent()) ?? "").includes(
      "Le total des échéances doit être égal au montant des frais.",
    ),
  );
  check("nothing was stored", (await charges()).length === 2);
  await dialog().getByRole("button", { name: "Annuler", exact: true }).click();

  // The database refuses a second identical active fee (the form cannot know it).
  await page.getByTestId("fee-add").click();
  await dialog().waitFor();
  await pick(page, "#fee-type", "Frais d'inscription");
  await page.fill("#fee-amount", "3000");
  await save();
  const dupToast = await page
    .getByText("Cet élément existe déjà.")
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(
    "a duplicate fee is refused by the database, said so, and the form stays open",
    dupToast && (await charges()).length === 2 && (await dialog().isVisible()),
  );
  await dialog().getByRole("button", { name: "Annuler", exact: true }).click();

  /* ------------------------------------------------------------------ 5. reschedule */
  console.log("\n--- 5. rescheduling a fee ---");
  const tuitionCard = page.locator('[data-testid="fee-charge"]', { hasText: "Trimestre 1" });
  await tuitionCard.getByTestId("fee-actions").click();
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  await dialog().waitFor();
  check(
    "editing opens the fee with its schedule",
    (await page.inputValue("#fee-amount")) === "30000" &&
      (await rowAmount(3).inputValue()) === "10000",
  );
  await page.fill("#fee-amount", "24000");
  await pick(page, "#fee-count", "2");
  await save();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  rows = await charges("c.fee_type = 'tuition'");
  const audited = await one(`select count(*)::int n from public.audit_log
     where action = 'charge_updated' and details ->> 'charge_id' = '${rows[0]?.id}';`);
  check(
    "the fee and its schedule are replaced together, and the change is audited",
    rows[0]?.amount_dzd === 24000 &&
      rows[0]?.inst?.map((i) => i.a).join(",") === "12000,12000" &&
      audited.n === 1,
    JSON.stringify({ rows, audited }),
  );

  /* ------------------------------------------------------------------ 6. cancel */
  console.log("\n--- 6. cancelling a fee ---");
  const regCard = page.locator('[data-testid="fee-charge"]', { hasText: "Frais d'inscription" });
  await regCard.getByTestId("fee-actions").click();
  await page.getByRole("menuitem", { name: "Annuler les frais" }).click();
  const alert = page.getByRole("alertdialog");
  await alert.waitFor();
  await alert.getByRole("button", { name: "Annuler les frais" }).click();
  await page.waitForTimeout(300);
  check(
    "cancelling without a reason is refused",
    ((await alert.textContent()) ?? "").includes("Indiquez le motif") &&
      (await charges("c.status = 'cancelled'")).length === 0,
  );
  await page.fill("#fee-cancel-reason", "Inscription offerte");
  await alert.getByRole("button", { name: "Annuler les frais" }).click();
  await page.getByText("Frais annulés.").waitFor({ timeout: 15000 });
  rows = await charges("c.fee_type = 'registration'");
  await page.waitForTimeout(500);
  check(
    "the fee is cancelled, not deleted: kept with its reason and shown struck through",
    rows.length === 1 &&
      rows[0].status === "cancelled" &&
      rows[0].cancel_reason === "Inscription offerte" &&
      (await page.locator('[data-testid="fee-charge"][data-status="cancelled"]').count()) === 1 &&
      ((await regCard.textContent()) ?? "").includes("Inscription offerte"),
    JSON.stringify(rows),
  );
  check(
    "a cancelled fee no longer counts: 24 000 due, 9 000 left",
    digits(await text(page, '[data-testid="fees-total-due"]')) === 24000 &&
      digits(await text(page, '[data-testid="fees-total-remaining"]')) === 9000,
  );

  /* ------------------------------------------------------------------ 7. payments untouched */
  const pays = await one(`select count(*)::int n, sum(amount_dzd)::int s from public.payments
     where registration_id = '${REG}';`);
  check(
    "no fee action created or changed a payment",
    pays.n === 1 && pays.s === 15000,
    JSON.stringify(pays),
  );

  /* ------------------------------------------------------------------ 8. teacher */
  console.log("\n--- 8. the group's teacher ---");
  teacherCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const tp = await teacherCtx.newPage();
  tp.on("pageerror", (e) => errors.push(e.stack || e.message));
  await login(tp, fx.teacher);
  await tp.goto(studentUrl());
  // Teachers cannot read other users' roles (user_roles RLS), so this page currently answers
  // « Élève introuvable » for them -- pre-existing behaviour, outside fees. Either way: no money.
  await tp
    .getByText(new RegExp(`${fx.student.fullName}|Élève introuvable`))
    .first()
    .waitFor({ timeout: 30000 });
  await tp.waitForTimeout(1500);
  check(
    "the teacher sees the student page without any fee or payment",
    (await tp.getByTestId("fees-section").count()) === 0 &&
      !((await tp.textContent("main")) ?? "").includes("Frais et échéances"),
  );

  /* ------------------------------------------------------------------ 9. Arabic, phone */
  console.log("\n--- 9. Arabic, right to left, on a phone ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudent();
  await page.waitForTimeout(800);
  const dir = await page.evaluate(() => document.documentElement.dir);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const arText = (await page.getByTestId("fees-section").textContent()) ?? "";
  check(
    "the section reads right to left in Arabic, without sideways page scroll",
    dir === "rtl" && overflow <= 0 && arText.includes("إجمالي المستحق") && arText.includes("ملغاة"),
    JSON.stringify({ dir, overflow }),
  );

  // The refused duplicate (step 4) is a deliberate 409; the browser logs it as a failed resource.
  // External resources (Google Fonts) fail when the machine is offline; that is not the app.
  const unexpected = errors.filter(
    (e) =>
      !/status of 409|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(e),
  );
  check("no console or page errors", unexpected.length === 0, unexpected.join("\n").slice(0, 800));
} catch (e) {
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await teacherCtx?.close();
  await browser.close();
  // Charges, payments, groups, formations and accounts, in RESTRICT-safe order.
  await cleanupFixtures();
  const left = await one(`select
      (select count(*) from public.programs where name like '${TAG}%')::int programs,
      (select count(*) from public.groups where name like '${TAG}%')::int groups,
      (select count(*) from public.profiles where email like '${TAG}-%')::int accounts`);
  console.log(`\nleftovers: ${JSON.stringify(left)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
