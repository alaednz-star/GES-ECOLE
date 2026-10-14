/**
 * Formation fee templates end to end (20261006110100_fee_templates.sql, ADR-005).
 *
 *   formation page: add several default fees (monthly installments), the form refuses a schedule
 *     that does not add up, edit and remove (an unused fee is deleted)
 *   group page: a group inherits the formation's fees; "Personnaliser" starts its own set, which
 *     is then edited (override)
 *   enrollment: a new approved enrollment receives real charges from what applies (formation or
 *     group); a later template edit leaves them unchanged; the payment form proposes from them
 *   removing a fee that generated charges archives it; Arabic (phone) and English
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API); needs the dev server (BASE_URL,
 * default http://localhost:8080). Optional SHOT_DIR saves screenshots.
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e/verify-fee-templates-ui.mjs
 */

import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import {
  withFixtures,
  cleanupFixtures,
  sql,
  API,
  PUBLISHABLE_KEY,
  TEST_PASSWORD,
} from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = process.env.SHOT_DIR ?? null;
const TAG = "e2e-fixture";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const FORMATION = `${TAG} TPL Anglais A2 ${RUN}`;
const G1 = `${TAG} TPL Samedi ${RUN}`;
const G2 = `${TAG} TPL Intensif ${RUN}`;
const SOROBAN = `${TAG} TPL Soroban ${RUN}`;
const SUBJECT_GROUP = `${TAG} TPL Maths 3AS ${RUN}`;
const NAME_A = `Amine Modele ${RUN}`;
const NAME_B = `Sara Modele ${RUN}`;
const digits = (s) => Number((s ?? "").replace(/\D/g, "") || 0);

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
const pick = async (trigger, name) => {
  await page.click(trigger);
  await page.getByRole("option", { name, exact: true }).click();
};
const card = (id) => page.getByTestId(id);
const item = (cardId, text) => card(cardId).locator('[data-testid="tpl-item"]', { hasText: text });
const templates = (where = "true") =>
  sql(`select id::text id, group_id::text grp, fee_type, amount_dzd, status, schedule
         from public.fee_templates where program_id = '${PROGRAM}' and ${where} order by position, created_at;`);
const chargesOf = (reg) =>
  sql(`select c.fee_type, c.amount_dzd, c.template_id is not null from_template,
              (select json_agg(i.amount_dzd order by i.position) from public.charge_installments i where i.charge_id = c.id) inst
         from public.charges c where c.registration_id = '${reg}' order by c.fee_type;`);

async function login(who) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

/** An approved enrollment created by the administrator over the API, as the screens do. */
async function enroll(studentId, groupId) {
  const tok = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: fx.admin.email, password: TEST_PASSWORD }),
  }).then((r) => r.json());
  const res = await fetch(`${API}/rest/v1/registrations`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${tok.access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      student_id: studentId,
      group_id: groupId,
      status: "approved",
      decided_at: new Date().toISOString(),
    }),
  });
  const body = await res.json();
  return { status: res.status, id: body?.[0]?.id };
}

async function addFee({ type, amount, count = 1 }) {
  await page.getByTestId("tpl-add").first().click();
  await dialog().waitFor();
  if (type) await pick("#tpl-type", type);
  await page.fill("#tpl-amount", amount);
  if (count > 1) await pick("#tpl-count", String(count));
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
}

let PROGRAM = "";
try {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await sql(`update public.profiles set full_name = '${NAME_A}' where id = '${fx.student.id}';`);
  const b = await one(`insert into auth.users (id, email, raw_user_meta_data)
      values (gen_random_uuid(), '${TAG}-tpl-b-${RUN}@example.test', '{"full_name":"${NAME_B}"}')
      returning id::text id;`);
  PROGRAM = (
    await one(`insert into public.programs (name, category, status)
      values ('${FORMATION}', 'language', 'active') returning id::text id;`)
  ).id;
  const g1 = (
    await one(`insert into public.groups (name, program_id, max_students)
      values ('${G1}', '${PROGRAM}', 10) returning id::text id;`)
  ).id;
  const g2 = (
    await one(`insert into public.groups (name, program_id, max_students)
      values ('${G2}', '${PROGRAM}', 10) returning id::text id;`)
  ).id;
  // A formation created without any price, to be priced later from « Formations & tarifs ».
  const soroban = (
    await one(`insert into public.programs (name, category, status)
      values ('${SOROBAN}', 'workshop', 'active') returning id::text id;`)
  ).id;
  // A subject class without formation: it must be priceable too.
  const mathsGroup = (
    await one(`insert into public.groups (name, max_students)
      values ('${SUBJECT_GROUP}', 10) returning id::text id;`)
  ).id;
  const priceCell = (id) => page.locator(`[data-testid="pricing-price"][data-program="${id}"]`);

  await login(fx.admin);

  /* ------------------------------------------------------------------ 0. the catalogue page */
  console.log("\n--- 0. Formations & tarifs: formations exist without a price ---");
  await page.goto(`${BASE}/dashboard/pricing`);
  await page
    .getByPlaceholder(/Rechercher/)
    .first()
    .fill(`${RUN}`);
  await priceCell(soroban).waitFor({ timeout: 30000 });
  check(
    "the catalogue lists every formation; one without fees shows « Non configuré »",
    ((await priceCell(PROGRAM).textContent()) ?? "").includes("Non configuré") &&
      ((await priceCell(soroban).textContent()) ?? "").includes("Non configuré"),
  );
  check(
    "the sidebar offers « Formations & tarifs » as a live entry",
    (await page.locator('[data-sidebar="sidebar"] a[href="/dashboard/pricing"]').count()) === 1,
  );

  /* ------------------------------------------------------------------ 1. formation defaults */
  console.log("\n--- 1. the formation's default fees ---");
  await page.goto(`${BASE}/dashboard/programs/${PROGRAM}`);
  await card("tpl-card").waitFor({ timeout: 30000 });
  check(
    "a formation without fees says new enrollments receive none",
    await card("tpl-card")
      .getByText("Aucun frais configuré")
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false),
  );
  await addFee({ amount: "30000", count: 3 }); // the type defaults to « Frais de formation »
  await addFee({ type: "Frais d'inscription", amount: "2000" });
  await addFee({ type: "Fournitures et supports", amount: "1500" });
  let rows = await templates("group_id is null and status = 'active'");
  check(
    "several default fees are stored, the tuition split in 3 monthly installments",
    rows.length === 3 &&
      JSON.stringify(rows.find((r) => r.fee_type === "tuition")?.schedule) ===
        JSON.stringify([
          { months: 0, amount_dzd: 10000 },
          { months: 1, amount_dzd: 10000 },
          { months: 2, amount_dzd: 10000 },
        ]),
    JSON.stringify(rows),
  );
  check(
    "the formation shows the total of a new enrollment",
    digits(await card("tpl-card").getByTestId("tpl-total").textContent()) === 33500,
  );

  // A schedule that does not add up is refused in the form.
  await page.getByTestId("tpl-add").first().click();
  await dialog().waitFor();
  await pick("#tpl-type", "Frais d'examen");
  await page.fill("#tpl-amount", "5000");
  await pick("#tpl-count", "2");
  await dialog().getByLabel("Montant de l'échéance 1", { exact: true }).fill("4000");
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(400);
  check(
    "a template whose installments do not add up is refused",
    ((await dialog().textContent()) ?? "").includes(
      "Le total des échéances doit être égal au montant des frais.",
    ) && (await templates("fee_type = 'exam'")).length === 0,
  );
  await dialog().getByRole("button", { name: "Annuler", exact: true }).click();

  // Edit, then remove an unused fee: it is deleted.
  await item("tpl-card", "Fournitures").getByTestId("tpl-actions").click();
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  await dialog().waitFor();
  await page.fill("#tpl-amount", "1800");
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  check(
    "a default fee is edited",
    (await templates("fee_type = 'materials'"))[0]?.amount_dzd === 1800,
  );
  await item("tpl-card", "Fournitures").getByTestId("tpl-actions").click();
  await page.getByRole("menuitem", { name: "Retirer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retirer" }).click();
  await page.getByText("Frais retiré.").first().waitFor({ timeout: 15000 });
  check(
    "removing a fee that never generated charges deletes it",
    (await templates("fee_type = 'materials'")).length === 0,
  );
  if (SHOTS) await card("tpl-card").screenshot({ path: `${SHOTS}/tpl-formation-fr.png` });

  /* ------------------------------------------------------------------ 2. group override */
  console.log("\n--- 2. a group's own fees ---");
  await page.goto(`${BASE}/dashboard/groups/${g2}`);
  await card("tpl-group-card").waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const inheritText = (await card("tpl-group-card").textContent()) ?? "";
  check(
    "a group without its own fees shows the formation's, read-only",
    inheritText.includes("Frais de formation") &&
      (await card("tpl-group-card").getByTestId("tpl-actions").count()) === 0 &&
      (await card("tpl-group-card").getByTestId("tpl-customize").count()) === 1,
  );
  await card("tpl-group-card").getByTestId("tpl-customize").click();
  await card("tpl-group-card").getByTestId("tpl-actions").first().waitFor({ timeout: 15000 });
  await item("tpl-group-card", "Frais de formation").getByTestId("tpl-actions").click();
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  await dialog().waitFor();
  await page.fill("#tpl-amount", "35000");
  await pick("#tpl-count", "2");
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  rows = await templates(`group_id = '${g2}' and status = 'active'`);
  check(
    "customising copies the formation's fees into the group, which can then differ",
    rows.length === 2 && rows.find((r) => r.fee_type === "tuition")?.amount_dzd === 35000,
    JSON.stringify(rows),
  );
  check(
    "the formation's own defaults are unchanged",
    (await templates("group_id is null and fee_type = 'tuition'"))[0]?.amount_dzd === 30000,
  );
  if (SHOTS) await card("tpl-group-card").screenshot({ path: `${SHOTS}/tpl-group-fr.png` });

  /* ------------------------------------------------------------------ 3. enrollments */
  console.log("\n--- 3. new enrollments receive real charges ---");
  const regA = await enroll(fx.student.id, g1);
  const regB = await enroll(b.id, g2);
  const chA = await chargesOf(regA.id);
  const chB = await chargesOf(regB.id);
  check(
    "an enrollment in a group without override receives the formation's fees",
    regA.status === 201 &&
      JSON.stringify(chA) ===
        JSON.stringify([
          { fee_type: "registration", amount_dzd: 2000, from_template: true, inst: [2000] },
          {
            fee_type: "tuition",
            amount_dzd: 30000,
            from_template: true,
            inst: [10000, 10000, 10000],
          },
        ]),
    JSON.stringify(chA),
  );
  check(
    "an enrollment in the customised group receives the group's fees",
    JSON.stringify(chB.map((c) => [c.fee_type, c.amount_dzd, c.inst])) ===
      JSON.stringify([
        ["registration", 2000, [2000]],
        ["tuition", 35000, [17500, 17500]],
      ]),
    JSON.stringify(chB),
  );

  // A later change to the template never rewrites what a student already owes.
  await page.goto(`${BASE}/dashboard/programs/${PROGRAM}`);
  await card("tpl-card").waitFor();
  await item("tpl-card", "Frais de formation").getByTestId("tpl-actions").click();
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  await dialog().waitFor();
  await page.waitForTimeout(500);
  const openedRows = await dialog()
    .locator('[data-testid="tpl-schedule"] input')
    .evaluateAll((els) => els.map((e) => e.value));
  check(
    "editing opens the fee with its saved schedule, kept as entered",
    JSON.stringify(openedRows) === JSON.stringify(["0", "10000", "1", "10000", "2", "10000"]) &&
      (await dialog().getByRole("button", { name: "Répartir à nouveau" }).count()) === 1,
    JSON.stringify(openedRows),
  );
  await page.fill("#tpl-amount", "31000");
  // Several installments keep their edited rows: the administrator re-splits explicitly.
  await dialog().getByRole("button", { name: "Répartir à nouveau" }).click();
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  check(
    "editing the formation's fee leaves the enrolled student's charges unchanged",
    JSON.stringify(await chargesOf(regA.id)) === JSON.stringify(chA) &&
      (await templates("group_id is null and fee_type = 'tuition'"))[0]?.amount_dzd === 31000,
  );

  // Removing a fee that generated charges archives it; the charges stay.
  await item("tpl-card", "Frais d'inscription").getByTestId("tpl-actions").click();
  await page.getByRole("menuitem", { name: "Retirer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retirer" }).click();
  await page.getByText("Il reste lié").first().waitFor({ timeout: 15000 });
  check(
    "removing a fee that generated charges archives it and keeps the students' charges",
    (await templates("group_id is null and fee_type = 'registration'"))[0]?.status === "archived" &&
      (await chargesOf(regA.id)).length === 2,
  );

  /* ------------------------------------------------------------------ 4. student and payment */
  console.log("\n--- 4. the student page and the payment form see them ---");
  await page.goto(`${BASE}/dashboard/students/${fx.student.id}`);
  await page.getByTestId("fee-enrollment").first().waitFor({ timeout: 30000 });
  check(
    "the student page lists the generated charges",
    (await page.locator('[data-testid="fee-charge"]').count()) === 2 &&
      digits(await page.getByTestId("fees-total-due").textContent()) === 32000,
  );
  await page.goto(`${BASE}/dashboard/payments`);
  await page.getByRole("button", { name: "Enregistrer un paiement" }).first().click();
  await dialog().waitFor();
  await page.getByTestId("pay-student").click();
  await page.getByRole("option", { name: new RegExp(NAME_A) }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="pay-due"]')?.getAttribute("data-kind") === "due",
    null,
    { timeout: 15000 },
  );
  const proposed = await page.inputValue("#pay-amount");
  check(
    "the payment form proposes the next installment from the generated charges, still editable",
    ["2000", "10000"].includes(proposed),
    proposed,
  );
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 4b. pricing later, export */
  console.log("\n--- 4b. pricing a formation later, and the export ---");
  await page.goto(`${BASE}/dashboard/pricing`);
  await page
    .getByPlaceholder(/Rechercher/)
    .first()
    .fill(`${RUN}`);
  await priceCell(PROGRAM).waitFor({ timeout: 30000 });
  check(
    "the catalogue shows the formation's price (its default fees) and its customised group",
    digits(((await priceCell(PROGRAM).textContent()) ?? "").split("Groupes")[0]) === 31000 &&
      ((await priceCell(PROGRAM).textContent()) ?? "").includes(
        "Groupes avec leurs propres frais : 1",
      ),
    (await priceCell(PROGRAM).textContent()) ?? "",
  );
  await page
    .locator("tr", { has: priceCell(soroban) })
    .getByTestId("pricing-edit")
    .click();
  await dialog().waitFor();
  await page.getByTestId("tpl-add").first().click();
  await page.locator("#tpl-amount").waitFor();
  await page.fill("#tpl-amount", "15000");
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await page.locator("#tpl-amount").waitFor({ state: "detached", timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  check(
    "a formation created without a price is priced later from the catalogue",
    ((await priceCell(soroban).textContent()) ?? "").includes("15") &&
      (await templates("true")).length > 0 &&
      (
        await sql(
          `select amount_dzd from public.fee_templates where program_id = '${soroban}' and status = 'active';`,
        )
      )[0]?.amount_dzd === 15000,
  );
  check(
    "pricing the catalogue charged no existing enrollment retroactively",
    JSON.stringify(await chargesOf(regA.id)) === JSON.stringify(chA),
  );

  // A group without formation (subject class) is listed and priced the same way.
  await priceCell(mathsGroup).waitFor({ timeout: 15000 });
  const mathsRowText =
    (await page.locator("tr", { has: priceCell(mathsGroup) }).textContent()) ?? "";
  await page
    .locator("tr", { has: priceCell(mathsGroup) })
    .getByTestId("pricing-edit")
    .click();
  await dialog().waitFor();
  await page.getByTestId("tpl-add").first().click();
  await page.locator("#tpl-amount").waitFor();
  await page.fill("#tpl-amount", "9000");
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await page.locator("#tpl-amount").waitFor({ state: "detached", timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const regMaths = await enroll(fx.student.id, mathsGroup);
  const chMaths = await chargesOf(regMaths.id);
  check(
    "a subject group without formation is priced from the catalogue and charges new enrollments",
    mathsRowText.includes("Groupe (matière)") &&
      ((await priceCell(mathsGroup).textContent()) ?? "").includes("9") &&
      chMaths.length === 1 &&
      chMaths[0].amount_dzd === 9000 &&
      chMaths[0].from_template,
    `${mathsRowText} / ${JSON.stringify(chMaths)}`,
  );
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.getByTestId("pricing-export").click(),
  ]);
  const csv = readFileSync(await download.path(), "utf8");
  check(
    "the catalogue exports as CSV with names, types, levels, prices and pricing status",
    csv.includes("Formation") &&
      csv.includes("Prix (DZD)") &&
      csv.includes(FORMATION) &&
      csv.includes(SOROBAN) &&
      csv.includes('"31000"') &&
      csv.includes('"15000"') &&
      csv.includes("Configuré") &&
      download.suggestedFilename().startsWith("formations-tarifs"),
    csv.slice(0, 300),
  );
  if (SHOTS) await page.locator("main").screenshot({ path: `${SHOTS}/pricing-fr.png` });

  /* ------------------------------------------------------------------ 5. Arabic (phone), English */
  console.log("\n--- 5. Arabic on a phone, English ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard/programs/${PROGRAM}`);
  await card("tpl-card").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const dir = await page.evaluate(() => document.documentElement.dir);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const arText = (await page.locator("main").textContent()) ?? "";
  check(
    "the formation's fees read right to left in Arabic, without sideways scroll",
    dir === "rtl" && overflow <= 0 && arText.includes("رسوم التكوين"),
    JSON.stringify({ dir, overflow }),
  );
  if (SHOTS) await card("tpl-card").screenshot({ path: `${SHOTS}/tpl-formation-ar-mobile.png` });
  await page.goto(`${BASE}/dashboard/pricing`);
  await page.getByRole("heading", { name: "التكوينات والتسعيرة" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const pricingOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(
    "« Formations & tarifs » in Arabic on a phone: right to left, no sideways page scroll",
    pricingOverflow <= 0 && ((await page.locator("main").textContent()) ?? "").includes("السعر"),
    JSON.stringify({ pricingOverflow }),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pricing-ar-mobile.png` });
  await sql(`update public.profiles set locale = 'en' where id = '${fx.admin.id}';`);
  await page.goto(`${BASE}/dashboard/groups/${g2}`);
  await card("tpl-group-card").waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  check(
    "English: the group card names its own fees",
    await page
      .getByText("Fees of this group", { exact: true })
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false),
  );
  await page.goto(`${BASE}/dashboard/pricing`);
  check(
    "English: the catalogue is « Courses & pricing »",
    await page
      .getByRole("heading", { name: "Courses & pricing" })
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false),
  );

  // External resources (web fonts) may be unreachable when the machine's network changes.
  const unexpected = errors.filter(
    (e) => !/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(e),
  );
  check("no console or page errors", unexpected.length === 0, unexpected.join("\n").slice(0, 800));
} catch (e) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tpl-failure.png` }).catch(() => {});
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await browser.close();
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`).catch(
    () => {},
  );
  // Charges, payments, groups (and their overrides), formations (and their templates), accounts.
  await cleanupFixtures();
  await sql(`delete from auth.users where email like '${TAG}-tpl-b-%@example.test';`).catch(
    () => {},
  );
  const left = await one(`select
      (select count(*) from public.programs where name like '${TAG}%')::int programs,
      (select count(*) from public.fee_templates t join public.programs p on p.id = t.program_id
        where p.name like '${TAG}%')::int templates,
      (select count(*) from public.profiles where email like '${TAG}-%')::int accounts`);
  console.log(`\nleftovers: ${JSON.stringify(left)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
