/**
 * Finance management end to end (ADR-006): Remises & bourses, Soldes & impayés, Reçus, Factures,
 * Rapports, and their links from the student page and the Payments page.
 *
 *   - the five « Gestion financière » entries are live links
 *   - a catalogue discount is created, granted on a student's fee (preview, frozen amount) and
 *     cancelled -- the fee and the payments never change
 *   - balances: owed = fees - discounts - payments, overdue derived, CSV export
 *   - receipts: issued automatically for a payment, printable; editing the payment voids it and
 *     issues a new number
 *   - invoices: billing identity, issue for an enrollment (frozen snapshot), print, void
 *   - reports: the period aggregates include the fixture's money; Arabic on a phone
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API); needs the dev server (BASE_URL, default
 * http://localhost:8080). The school's billing identity is restored afterwards.
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e/verify-finance-ui.mjs
 */

import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, sql } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = process.env.SHOT_DIR ?? null;
const TAG = "e2e-fixture";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const NAME_A = `Amine Finance ${RUN}`;
const NAME_B = `Sara Finance ${RUN}`;
const FORMATION = `${TAG} FIN Anglais ${RUN}`;
const GROUP = `${TAG} FIN Samedi ${RUN}`;
const DISCOUNT = `${TAG} Fratrie ${RUN}`;
const digits = (s) => Number((s ?? "").replace(/\D/g, "") || 0);
const shift = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
  timezoneId: "UTC",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true, student: true });
const one = async (q) => (await sql(q))[0];
const dialog = () => page.getByRole("dialog");
const search = async (text) => {
  await page
    .getByPlaceholder(/Rechercher/)
    .first()
    .fill(text);
  await page.waitForTimeout(400);
};
const saveCharge = (reg, type, total, installments) =>
  sql(`select set_config('request.jwt.claims', '{"sub":"${fx.admin.id}","role":"authenticated"}', true),
              public.save_charge(null, '${reg}', '${type}', null, ${total}, null, '${JSON.stringify(installments)}');`);

async function login(who) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

let original = null;
try {
  original = await one(
    `select legal_name, nif, nis, rc, tax_article from public.center_settings limit 1;`,
  );
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await sql(`update public.profiles set full_name = '${NAME_A}' where id = '${fx.student.id}';`);
  const b = await one(`insert into auth.users (id, email, raw_user_meta_data)
      values (gen_random_uuid(), '${TAG}-fin-b-${RUN}@example.test', '{"full_name":"${NAME_B}"}')
      returning id::text id;`);
  const p = await one(`insert into public.programs (name, category, status)
      values ('${FORMATION}', 'language', 'active') returning id::text id;`);
  const g = await one(`insert into public.groups (name, program_id, max_students)
      values ('${GROUP}', '${p.id}', 10) returning id::text id;`);
  const regA = (
    await one(`insert into public.registrations (student_id, group_id, status, decided_at)
      values ('${fx.student.id}', '${g.id}', 'approved', now()) returning id::text id;`)
  ).id;
  const regB = (
    await one(`insert into public.registrations (student_id, group_id, status, decided_at)
      values ('${b.id}', '${g.id}', 'approved', now()) returning id::text id;`)
  ).id;
  await saveCharge(regA, "tuition", 30000, [
    { due_on: shift(-40), amount_dzd: 15000 },
    { due_on: shift(20), amount_dzd: 15000 },
  ]);
  await saveCharge(regA, "registration", 2000, [{ due_on: shift(-10), amount_dzd: 2000 }]);
  await saveCharge(regB, "tuition", 10000, [{ due_on: shift(30), amount_dzd: 10000 }]);
  const pay =
    await one(`insert into public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
      values ('${regA}', 5000, current_date, 'cash', '${fx.admin.id}') returning id::text id;`);

  await login(fx.admin);

  /* ------------------------------------------------------------------ 1. sidebar */
  console.log("\n--- 1. Gestion financière is live ---");
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await sidebar.locator('a[href="/dashboard/payments"]').waitFor({ timeout: 30000 });
  const live = [];
  for (const href of [
    "/dashboard/invoices",
    "/dashboard/receipts",
    "/dashboard/balances",
    "/dashboard/discounts",
    "/dashboard/reports",
  ]) {
    live.push(await sidebar.locator(`a[href="${href}"]`).count());
  }
  check(
    "the five finance entries are live links, not « Bientôt »",
    live.every((n) => n === 1),
    JSON.stringify(live),
  );

  /* ------------------------------------------------------------------ 2. discounts */
  console.log("\n--- 2. Remises & bourses ---");
  await page.goto(`${BASE}/dashboard/discounts`);
  await page.getByTestId("discount-add").click();
  await dialog().waitFor();
  await page.fill("#discount-name", DISCOUNT);
  await page.fill("#discount-value", "10");
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  check(
    "a catalogue discount is created",
    (await page
      .locator('[data-testid="discount-item"]', { hasText: DISCOUNT })
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false)) &&
      (await one(`select kind, value from public.discounts where name = '${DISCOUNT}';`))?.value ===
        10,
  );

  await page.goto(`${BASE}/dashboard/students/${fx.student.id}`);
  await page.getByTestId("fee-enrollment").first().waitFor({ timeout: 30000 });
  const tuitionCard = page.locator('[data-testid="fee-charge"]', { hasText: "Frais de formation" });
  await tuitionCard.getByTestId("fee-actions").click();
  await page.getByRole("menuitem", { name: "Appliquer une remise" }).click();
  await dialog().waitFor();
  await page.click("#grant-discount");
  await page.getByRole("option", { name: new RegExp(DISCOUNT) }).click();
  const preview = (await page.getByTestId("grant-preview").textContent()) ?? "";
  await dialog().getByRole("button", { name: "Appliquer une remise" }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForTimeout(600);
  const grant =
    await one(`select d.amount_dzd, d.status, c.amount_dzd charge from public.charge_discounts d
      join public.charges c on c.id = d.charge_id where c.registration_id = '${regA}';`);
  check(
    "granting on the student page previews and freezes 10 % of the fee; the fee is unchanged",
    preview.includes("3") &&
      grant?.amount_dzd === 3000 &&
      grant.charge === 30000 &&
      (await tuitionCard.getByTestId("fee-discount").count()) === 1 &&
      ((await page.getByTestId("fee-enrollment-summary").first().textContent()) ?? "").includes(
        "Remises",
      ),
    `${preview} / ${JSON.stringify(grant)}`,
  );

  /* ------------------------------------------------------------------ 3. balances */
  console.log("\n--- 3. Soldes & impayés ---");
  await page.goto(`${BASE}/dashboard/balances`);
  await page.getByTestId("balances-kpis").waitFor({ timeout: 30000 });
  await search(RUN);
  const cellA = page.locator(`[data-testid="balance-remaining"][data-registration="${regA}"]`);
  await cellA.waitFor({ timeout: 15000 });
  const textA = (await cellA.textContent()) ?? "";
  // 32 000 owed - 3 000 discount - 5 000 paid = 24 000; credit 8 000 covers the oldest first:
  // tuition #1 (15 000, late) -> 7 000 left late; registration (2 000, late) -> 9 000 overdue.
  check(
    "an enrollment's balance is fees minus discounts minus payments, with its overdue part",
    digits(textA.split("En retard")[0]) === 24000 && digits(textA.split("En retard")[1]) === 9000,
    textA,
  );
  check(
    "the other student's enrollment is listed as left to pay",
    (await page
      .locator(`[data-testid="balance-remaining"][data-registration="${regB}"]`)
      .count()) === 1,
  );
  const [csvDl] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.getByTestId("balances-export").click(),
  ]);
  const csv = readFileSync(await csvDl.path(), "utf8");
  check(
    "balances export as CSV",
    csv.includes(NAME_A) && csv.includes('"24000"'),
    csv.slice(0, 200),
  );
  if (SHOTS) await page.locator("main").screenshot({ path: `${SHOTS}/fin-balances-fr.png` });

  /* ------------------------------------------------------------------ 4. receipts */
  console.log("\n--- 4. Reçus ---");
  const rec = await one(
    `select id::text id, number from public.receipts where payment_id = '${pay.id}' and status = 'issued';`,
  );
  await page.goto(`${BASE}/dashboard/receipts`);
  await search(rec.number);
  await page.getByTestId("receipt-open").first().waitFor({ timeout: 15000 });
  check(
    "the payment's receipt is listed with its number",
    (await page.getByText(rec.number).count()) >= 1,
  );
  await page.getByTestId("receipt-open").first().click();
  await page.getByTestId("document").waitFor({ timeout: 15000 });
  check(
    "the printable receipt shows its number, the student and the amount",
    (await page.getByTestId("doc-number").textContent())?.trim() === rec.number &&
      digits(await page.getByTestId("doc-amount").textContent()) === 5000 &&
      ((await page.getByTestId("document").textContent()) ?? "").includes(NAME_A),
  );
  if (SHOTS) await page.getByTestId("document").screenshot({ path: `${SHOTS}/fin-receipt-fr.png` });
  await sql(`update public.payments set amount_dzd = 6000 where id = '${pay.id}';`);
  const recs = await sql(
    `select number, status, amount_dzd from public.receipts where payment_id = '${pay.id}' order by issued_at;`,
  );
  await page.goto(`${BASE}/dashboard/receipts`);
  await search(RUN);
  await page.waitForTimeout(800);
  check(
    "correcting the payment voids its receipt and issues a new number",
    recs.length === 2 &&
      recs[0].status === "voided" &&
      recs[1].status === "issued" &&
      recs[1].amount_dzd === 6000 &&
      recs[1].number !== recs[0].number &&
      (await page.getByText("Annulé : Paiement modifié").count()) >= 1,
    JSON.stringify(recs),
  );

  /* ------------------------------------------------------------------ 5. invoices */
  console.log("\n--- 5. Factures ---");
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.getByTestId("billing-open").click();
  await dialog().waitFor();
  await page.fill("#billing-nif", "000116009999999");
  await page.fill("#billing-legalName", "SARL e2e-fixture");
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  check(
    "the billing identity is saved",
    (await one(`select nif from public.center_settings limit 1;`))?.nif === "000116009999999",
  );
  await page.getByTestId("invoice-issue").click();
  await dialog().waitFor();
  await page.getByTestId("inv-student").click();
  await page.getByRole("option", { name: new RegExp(NAME_A) }).click();
  await page.getByTestId("inv-confirm").click();
  await page.getByTestId("document").waitFor({ timeout: 20000 });
  const inv =
    await one(`select id::text id, number, total_dzd, discount_dzd, paid_dzd, balance_dzd, issuer ->> 'nif' nif
      from public.invoices where registration_id = '${regA}' order by issued_at desc limit 1;`);
  check(
    "an invoice is issued for the enrollment: fees, discount, paid and balance frozen, NIF printed",
    inv?.total_dzd === 32000 &&
      inv.discount_dzd === 3000 &&
      inv.paid_dzd === 6000 &&
      inv.balance_dzd === 23000 &&
      inv.nif === "000116009999999" &&
      (await page.getByTestId("doc-number").textContent())?.trim() === inv.number &&
      digits(await page.getByTestId("doc-balance").textContent()) === 23000 &&
      (await page.getByTestId("doc-line").count()) === 2 &&
      ((await page.getByTestId("document").textContent()) ?? "").includes("000116009999999"),
    JSON.stringify(inv),
  );
  if (SHOTS) await page.getByTestId("document").screenshot({ path: `${SHOTS}/fin-invoice-fr.png` });
  await page.goto(`${BASE}/dashboard/invoices`);
  await search(inv.number);
  await page.getByTestId("invoice-void").first().click();
  const alert = page.getByRole("alertdialog");
  await alert.waitFor();
  await page.fill("#invoice-void-reason", "Erreur de saisie");
  await alert.getByRole("button", { name: "Annuler la facture" }).click();
  await alert.waitFor({ state: "hidden", timeout: 15000 });
  check(
    "voiding keeps the invoice, marked voided with its reason",
    (await one(`select status, void_reason from public.invoices where id = '${inv.id}';`))
      ?.status === "voided",
  );

  /* ------------------------------------------------------------------ 6. student page links, cancel discount */
  console.log("\n--- 6. the student page ---");
  await page.goto(`${BASE}/dashboard/students/${fx.student.id}`);
  await page.getByTestId("fee-enrollment").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  check(
    "the student page offers an invoice and links each payment to its receipt",
    (await page.getByTestId("fee-invoice").count()) === 1 &&
      (await page.getByTestId("fee-payment-receipt").count()) === 1,
  );
  await page.getByTestId("fee-discount-cancel").first().click();
  const alert2 = page.getByRole("alertdialog");
  await alert2.waitFor();
  await page.fill("#discount-cancel-reason", "Plus de frère inscrit");
  await alert2.getByRole("button", { name: "Annuler la remise" }).click();
  await alert2.waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForTimeout(500);
  check(
    "a discount is cancelled from the student page and stays listed, struck through",
    (
      await one(`select d.status from public.charge_discounts d join public.charges c on c.id = d.charge_id
                 where c.registration_id = '${regA}';`)
    )?.status === "cancelled" &&
      (await page.locator('[data-testid="fee-discount"][data-status="cancelled"]').count()) === 1,
  );
  const payments = await one(
    `select count(*)::int n, sum(amount_dzd)::int s from public.payments where registration_id = '${regA}';`,
  );
  const charges = await one(
    `select sum(amount_dzd)::int s from public.charges where registration_id = '${regA}';`,
  );
  check(
    "discounts, receipts and invoices never changed a fee or a payment",
    payments.n === 1 && payments.s === 6000 && charges.s === 32000,
    JSON.stringify({ payments, charges }),
  );

  /* ------------------------------------------------------------------ 7. reports */
  console.log("\n--- 7. Rapports financiers ---");
  await page.goto(`${BASE}/dashboard/reports`);
  await page.getByTestId("reports-kpis").waitFor({ timeout: 30000 });
  await page.click("#reports-preset");
  await page.getByRole("option", { name: "Ce mois-ci" }).click();
  await page.waitForTimeout(600);
  // Amounts use narrow no-break spaces (formatDzd): normalise before matching.
  const byProgram = ((await page.getByTestId("report-by-program").textContent()) ?? "").replace(
    /[\u202f\u00a0]/g,
    " ",
  );
  check(
    "the period report lists the formation with what it collected and charged",
    byProgram.includes(FORMATION) && byProgram.includes("6 000") && byProgram.includes("42 000"),
    byProgram.slice(0, 300),
  );
  if (SHOTS) await page.locator("main").screenshot({ path: `${SHOTS}/fin-reports-fr.png` });

  /* ------------------------------------------------------------------ 8. Arabic on a phone */
  console.log("\n--- 8. Arabic on a phone ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflows = {};
  for (const path of ["balances", "discounts", "receipts", "invoices", "reports"]) {
    await page.goto(`${BASE}/dashboard/${path}`);
    await page.locator("main h1").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(700);
    overflows[path] = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (SHOTS && path === "balances")
      await page.screenshot({ path: `${SHOTS}/fin-balances-ar-mobile.png` });
  }
  check(
    "every finance page reads right to left in Arabic and fits a phone",
    (await page.evaluate(() => document.documentElement.dir)) === "rtl" &&
      Object.values(overflows).every((o) => o <= 0) &&
      ((await page.locator("main").textContent()) ?? "").includes("التقارير المالية"),
    JSON.stringify(overflows),
  );

  // The deliberate 409s none; external resources (fonts) may be unreachable offline.
  const unexpected = errors.filter(
    (e) => !/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(e),
  );
  check("no console or page errors", unexpected.length === 0, unexpected.join("\n").slice(0, 800));
} catch (e) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/fin-failure.png` }).catch(() => {});
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await browser.close();
  if (original) {
    const q = (v) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
    await sql(`update public.center_settings set legal_name = ${q(original.legal_name)}, nif = ${q(original.nif)},
               nis = ${q(original.nis)}, rc = ${q(original.rc)}, tax_article = ${q(original.tax_article)};`).catch(
      () => {},
    );
  }
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`).catch(
    () => {},
  );
  await cleanupFixtures();
  await sql(`delete from auth.users where email like '${TAG}-fin-b-%@example.test';`).catch(
    () => {},
  );
  const left = await one(`select
      (select count(*) from public.programs where name like '${TAG}%')::int programs,
      (select count(*) from public.discounts where name like '${TAG}%')::int discounts,
      (select count(*) from public.profiles where email like '${TAG}-%')::int accounts`);
  console.log(`\nleftovers: ${JSON.stringify(left)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
