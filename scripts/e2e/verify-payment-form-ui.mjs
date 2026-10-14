/**
 * The payment form: student first, then what the payment is for, with the amount proposed from
 * Fees & Installments (ADR-005) and left editable.
 *
 *   - a student is listed ONCE, however many enrollments they have
 *   - choosing a student offers only that student's approved enrollments, each with its next
 *     installment (or "no installment set up" / "fees paid")
 *   - choosing an enrollment proposes what is left on its next unpaid installment; no fee or
 *     fully paid proposes nothing (no invented price)
 *   - the administrator can change the amount; changing the student clears enrollment and amount
 *   - the payment is stored on exactly the chosen enrollment, audited, and fees are untouched
 *   - the sidebar no longer announces fees as « Bientôt »; Arabic is right to left on a phone
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API); needs the dev server (BASE_URL,
 * default http://localhost:8080). Optional SHOT_DIR saves screenshots.
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e/verify-payment-form-ui.mjs
 */

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
const NAME_A = `Amine Paiement ${RUN}`;
const NAME_B = `Sara Paiement ${RUN}`;
const G1 = `${TAG} PAY Physique ${RUN}`;
const G2 = `${TAG} PAY Anglais ${RUN}`;
const G3 = `${TAG} PAY Français ${RUN}`;
const FORMATION = `${TAG} PAY Soutien Bac ${RUN}`;

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
const amount = () => page.inputValue("#pay-amount");
const enrollment = (name) => page.locator('[data-testid="pay-enrollment"]', { hasText: name });

async function login(who) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

async function openForm() {
  await page.goto(`${BASE}/dashboard/payments`);
  await page.getByRole("button", { name: "Enregistrer un paiement" }).first().click();
  await dialog().waitFor();
}

async function chooseStudent(name) {
  await page.getByTestId("pay-student").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await page.waitForTimeout(300);
}

/** Fees through the real RPC, as the administrator (audited like the screen). */
const saveCharge = (reg, type, label, total, installments) =>
  sql(`select set_config('request.jwt.claims', '{"sub":"${fx.admin.id}","role":"authenticated"}', true),
              public.save_charge(null, '${reg}', '${type}', ${label ? `'${label}'` : "null"}, ${total}, null,
                                 '${JSON.stringify(installments)}');`);

try {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  // A second student, created like any account.
  const b = await one(`insert into auth.users (id, email, raw_user_meta_data)
      values (gen_random_uuid(), '${TAG}-pay-b-${RUN}@example.test', '{"full_name":"${NAME_B}"}')
      returning id::text id;`);
  await sql(`update public.profiles set full_name = '${NAME_A}' where id = '${fx.student.id}';`);

  const f = await one(`insert into public.programs (name, category, status)
      values ('${FORMATION}', 'academic_support', 'active') returning id::text id;`);
  const g = {};
  for (const [k, name] of [
    ["g1", G1],
    ["g2", G2],
    ["g3", G3],
  ]) {
    g[k] = (
      await one(`insert into public.groups (name, program_id, max_students)
        values ('${name}', '${f.id}', 10) returning id::text id;`)
    ).id;
  }
  const enroll = async (student, group) =>
    (
      await one(`insert into public.registrations (student_id, group_id, status, decided_at)
        values ('${student}', '${group}', 'approved', now()) returning id::text id;`)
    ).id;
  const a1 = await enroll(fx.student.id, g.g1);
  const a2 = await enroll(fx.student.id, g.g2);
  const a3 = await enroll(fx.student.id, g.g3);
  const b1 = await enroll(b.id, g.g1);

  // A/G1: 30 000 in three installments, the first one overdue, 4 000 already received.
  await saveCharge(a1, "tuition", "Trimestre 1", 30000, [
    { due_on: shift(-40), amount_dzd: 10000 },
    { due_on: shift(-10), amount_dzd: 10000 },
    { due_on: shift(20), amount_dzd: 10000 },
  ]);
  await sql(`insert into public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
             values ('${a1}', 4000, current_date - 20, 'cash', '${fx.admin.id}');`);
  // A/G2: no fee. A/G3: a registration fee, fully paid.
  await saveCharge(a3, "registration", null, 3000, [{ due_on: shift(-5), amount_dzd: 3000 }]);
  await sql(`insert into public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
             values ('${a3}', 3000, current_date - 5, 'cash', '${fx.admin.id}');`);
  // B/G1: one installment of 8 000, due in ten days.
  await saveCharge(b1, "tuition", null, 8000, [{ due_on: shift(10), amount_dzd: 8000 }]);
  const installmentsBefore = await one(`select count(*)::int n, sum(i.amount_dzd)::int s
      from public.charge_installments i join public.charges c on c.id = i.charge_id
     where c.registration_id in ('${a1}', '${a3}', '${b1}');`);

  await login(fx.admin);

  /* ------------------------------------------------------------------ 1. the student, once */
  console.log("\n--- 1. student first, listed once ---");
  await openForm();
  await page.getByTestId("pay-student").click();
  await page.getByPlaceholder("Rechercher un élève…").fill(NAME_A);
  await page.waitForTimeout(300);
  const optionsA = await page.getByRole("option", { name: new RegExp(NAME_A) }).count();
  const optionText =
    (await page
      .getByRole("option", { name: new RegExp(NAME_A) })
      .first()
      .textContent()) ?? "";
  check(
    "a student with three enrollments is listed once (with the count)",
    optionsA === 1 && optionText.includes("3 inscriptions"),
    `${optionsA} / ${optionText}`,
  );
  await page.getByRole("option", { name: new RegExp(NAME_A) }).click();
  await page.waitForTimeout(500);

  /* ------------------------------------------------------------------ 2. their enrollments */
  console.log("\n--- 2. what the payment is for ---");
  await page.getByTestId("pay-enrollment").first().waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[data-testid="pay-enrollment"]')].some((e) =>
        e.textContent?.includes("…"),
      ),
    null,
    { timeout: 15000 },
  );
  const names = await page.locator('[data-testid="pay-enrollment"]').allTextContents();
  check(
    "only this student's approved enrollments are offered, none preselected, amount empty",
    names.length === 3 &&
      (await page
        .locator('[data-testid="pay-enrollments"] [role="radio"][data-state="checked"]')
        .count()) === 0 &&
      (await amount()) === "",
    JSON.stringify(names),
  );
  check(
    "each enrollment says what is due: next installment / no installment / fees paid",
    ((await enrollment(G1).textContent()) ?? "").includes("Échéance suivante") &&
      ((await enrollment(G1).textContent()) ?? "").includes("6") &&
      ((await enrollment(G2).textContent()) ?? "").includes("Aucune échéance configurée") &&
      ((await enrollment(G3).textContent()) ?? "").includes("Frais réglés"),
    JSON.stringify(names),
  );

  /* ------------------------------------------------------------------ 3. proposed amount */
  console.log("\n--- 3. the proposed amount ---");
  await enrollment(G1).click();
  await page.waitForTimeout(400);
  const dueText = (await page.getByTestId("pay-due").textContent()) ?? "";
  check(
    "choosing an enrollment proposes what is left on its next unpaid installment",
    (await amount()) === "6000" &&
      (await page.getByTestId("pay-due").getAttribute("data-kind")) === "due" &&
      dueText.includes("Frais de formation · Trimestre 1") &&
      dueText.includes("en retard") &&
      ((await page.getByTestId("pay-amount-hint").textContent()) ?? "").includes("Montant proposé"),
    `${await amount()} / ${dueText}`,
  );
  await page.fill("#pay-amount", "5000");
  check(
    "the administrator can change the proposed amount (partial payment)",
    (await amount()) === "5000" &&
      ((await page.getByTestId("pay-amount-hint").textContent()) ?? "").includes("Montant modifié"),
  );
  await enrollment(G2).click();
  await page.waitForTimeout(300);
  check(
    "an enrollment without a fee proposes nothing and says so",
    (await amount()) === "" &&
      (await page.getByTestId("pay-due").getAttribute("data-kind")) === "none" &&
      ((await page.getByTestId("pay-due").textContent()) ?? "").includes(
        "Aucune échéance configurée",
      ),
  );
  await enrollment(G3).click();
  await page.waitForTimeout(300);
  check(
    "a fully paid enrollment proposes nothing and says so",
    (await amount()) === "" &&
      (await page.getByTestId("pay-due").getAttribute("data-kind")) === "settled",
  );
  if (SHOTS) await dialog().screenshot({ path: `${SHOTS}/pay-form-fr.png` });

  /* ------------------------------------------------------------------ 4. changing student */
  console.log("\n--- 4. changing the student ---");
  await enrollment(G1).click();
  await page.waitForTimeout(300);
  await chooseStudent(NAME_B);
  await page
    .waitForFunction(() => document.querySelector("#pay-amount")?.value === "8000", null, {
      timeout: 15000,
    })
    .catch(() => {});
  check(
    "a student with one enrollment gets it preselected, with its amount proposed",
    (await page.locator('[data-testid="pay-enrollment"]').count()) === 1 &&
      (await page
        .locator('[data-testid="pay-enrollments"] [role="radio"][data-state="checked"]')
        .count()) === 1 &&
      (await amount()) === "8000",
    await amount(),
  );
  await chooseStudent(NAME_A);
  check(
    "changing the student clears the enrollment and the amount",
    (await page
      .locator('[data-testid="pay-enrollments"] [role="radio"][data-state="checked"]')
      .count()) === 0 && (await amount()) === "",
  );

  /* ------------------------------------------------------------------ 5. refused, then saved */
  console.log("\n--- 5. recording ---");
  await page.fill("#pay-amount", "5000");
  await dialog().getByRole("button", { name: "Enregistrer un paiement" }).click();
  await page.waitForTimeout(400);
  const paysBefore = await one(`select count(*)::int n from public.payments
      where registration_id in ('${a1}', '${a2}', '${a3}', '${b1}');`);
  check(
    "without an enrollment the form does not submit",
    ((await dialog().textContent()) ?? "").includes(
      "Choisissez la formation ou le groupe concerné.",
    ) && paysBefore.n === 2,
  );
  await enrollment(G1).click();
  await page.waitForTimeout(300);
  await page.fill("#pay-amount", "5000");
  await dialog().getByRole("button", { name: "Enregistrer un paiement" }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  const stored = await sql(`select registration_id::text reg, amount_dzd, recorded_by::text by
      from public.payments where registration_id in ('${a1}', '${a2}', '${a3}', '${b1}')
      order by created_at desc limit 1;`);
  const audit = await one(`select count(*)::int n from public.audit_log
      where action = 'payment_recorded' and details ->> 'registration_id' = '${a1}';`);
  const installmentsAfter = await one(`select count(*)::int n, sum(i.amount_dzd)::int s
      from public.charge_installments i join public.charges c on c.id = i.charge_id
     where c.registration_id in ('${a1}', '${a3}', '${b1}');`);
  check(
    "the payment is stored on exactly the chosen enrollment, with the amount received",
    stored[0]?.reg === a1 && stored[0]?.amount_dzd === 5000 && stored[0]?.by === fx.admin.id,
    JSON.stringify(stored),
  );
  check("the payment is audited as before", audit.n === 2, JSON.stringify(audit));
  check(
    "recording a payment leaves the fees and installments untouched",
    JSON.stringify(installmentsAfter) === JSON.stringify(installmentsBefore),
    `${JSON.stringify(installmentsBefore)} -> ${JSON.stringify(installmentsAfter)}`,
  );

  /* ------------------------------------------------------------------ 6. sidebar */
  console.log("\n--- 6. sidebar ---");
  const sidebar = (await page.locator('[data-sidebar="sidebar"]').first().textContent()) ?? "";
  check(
    "the sidebar no longer announces fees and installments as « Bientôt »; future modules still are",
    !sidebar.includes("Frais & échéanciers") &&
      sidebar.includes("Factures") &&
      sidebar.includes("Soldes & impayés"),
  );

  /* ------------------------------------------------------------------ 7. Arabic, phone */
  console.log("\n--- 7. Arabic, right to left, on a phone ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard/payments`);
  await page.getByRole("button", { name: "تسجيل دفعة" }).first().click();
  await dialog().waitFor();
  await page.getByTestId("pay-student").click();
  await page.getByRole("option", { name: new RegExp(NAME_A) }).click();
  await page.getByTestId("pay-enrollment").first().waitFor();
  await page.waitForTimeout(800);
  await enrollment(G1).click();
  await page.waitForTimeout(400);
  const dir = await page.evaluate(() => document.documentElement.dir);
  const overflow = await dialog().evaluate((d) => d.scrollWidth - d.clientWidth);
  const arText = (await dialog().textContent()) ?? "";
  check(
    "the form reads right to left in Arabic and fits a phone",
    dir === "rtl" &&
      overflow <= 0 &&
      arText.includes("يخصّ هذا الدفع") &&
      // 10 000 - (4 000 + 5 000 received): 1 000 left on the first installment.
      (await amount()) === "1000",
    JSON.stringify({ dir, overflow, amount: await amount() }),
  );
  if (SHOTS) await dialog().screenshot({ path: `${SHOTS}/pay-form-ar-mobile.png` });

  check("no console or page errors", errors.length === 0, errors.join("\n").slice(0, 800));
} catch (e) {
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await browser.close();
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`).catch(
    () => {},
  );
  // Charges, payments, groups, formations and accounts, in RESTRICT-safe order.
  await cleanupFixtures();
  // The second student was inserted in SQL (no GoTrue identity): removed the same way.
  await sql(`delete from auth.users where email like '${TAG}-pay-b-%@example.test';`).catch(
    () => {},
  );
  const left = await one(`select
      (select count(*) from public.programs where name like '${TAG}%')::int programs,
      (select count(*) from public.groups where name like '${TAG}%')::int groups,
      (select count(*) from public.profiles where email like '${TAG}-%')::int accounts`);
  console.log(`\nleftovers: ${JSON.stringify(left)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
