/**
 * Pre-registrations end to end (20261005110000_applications.sql, ADR-004 section 7).
 *
 *   formation page: the public link and QR code, open only while the formation accepts them
 *   public page (no account): the formation, its groups, the form; a child needs a guardian;
 *     the request is stored, a bot (honeypot) is not, a closed or unknown formation says so,
 *     and repeated requests for the same phone are rate-limited
 *   administration: the request appears, a possible duplicate is flagged, accepting creates the
 *     student (no portal access) and an approved enrollment in the chosen group; declining and
 *     reopening work; the sidebar entry is live; Arabic is right to left
 *
 * Every outcome is checked in the database too. LOCAL ONLY (fixtures.mjs refuses any non-loopback
 * API); needs the dev server (BASE_URL, default http://localhost:8080).
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
const FORMATION = `${TAG} ADM Calcul mental ${RUN}`;
const CLOSED = `${TAG} ADM Fermée ${RUN}`;
const GROUP = `${TAG} ADM Samedi ${RUN}`;
const GROUP_NO_SLOTS = `${TAG} ADM Mardi ${RUN}`;
const GUARDIAN_PHONE = "0550 12 34 56";
const GUARDIAN_PHONE_NORM = "0550123456";

const browser = await chromium.launch();
const adminCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await adminCtx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true, student: true });
const one = async (q) => (await sql(q))[0];
const text = async (p, selector) => ((await p.locator(selector).textContent()) ?? "").trim();
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

/** Fills the public form for a child (guardian block) and sends it after the minimum delay. */
async function submitChild(
  p,
  { first, last, guardian = "Karim Ben Ali", phone = GUARDIAN_PHONE, group = true, bot = false },
) {
  await p.fill("#app-last-name", last);
  await p.fill("#app-first-name", first);
  await p.fill("#app-dob", "2016-03-14");
  await p.fill("#app-guardian-name", guardian);
  await p.fill("#app-guardian-phone", phone);
  await pick(p, "#app-guardian-relation", "Père");
  if (group) await p.getByRole("radio", { name: new RegExp(`^${GROUP}`) }).check();
  await p.locator("#app-consent").click();
  if (bot) await p.locator("#app-website").fill("http://spam.example", { force: true });
  await p.waitForTimeout(3300);
  await p.getByRole("button", { name: "Envoyer la pré-inscription" }).click();
}

let publicCtx;
try {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  const formation =
    await one(`insert into public.programs (name, category, status, registration_open, description, duration_hours)
      values ('${FORMATION}', 'extracurricular', 'active', true, 'Méthode Soroban pour les 6-12 ans.', 40)
      returning id::text id;`);
  const closed = await one(`insert into public.programs (name, category, status, registration_open)
      values ('${CLOSED}', 'workshop', 'draft', false) returning id::text id;`);
  const group = await one(`insert into public.groups (name, program_id, max_students)
      values ('${GROUP}', '${formation.id}', 10) returning id::text id;`);
  await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time)
             values ('${group.id}', 6, '10:00', '11:30');`);
  // A group whose weekly times are not set yet.
  await sql(`insert into public.groups (name, program_id, max_students, start_date)
             values ('${GROUP_NO_SLOTS}', '${formation.id}', 8, '2026-11-03');`);
  // An existing student whose guardian has the same phone: a duplicate to flag.
  await sql(
    `update public.students set guardian_phone = '${GUARDIAN_PHONE_NORM}' where id = '${fx.student.id}';`,
  );

  await login(page, fx.admin);

  /* ------------------------------------------------------------------ 1. formation page */
  console.log("\n--- 1. the formation's public link and QR code ---");
  await page.goto(`${BASE}/dashboard/programs/${formation.id}`);
  await page.getByTestId("public-link-url").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await page
    .getByRole("img", { name: /QR code de pré-inscription/ })
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  const linkUrl = await text(page, '[data-testid="public-link-url"]');
  const linkState = await text(page, '[data-testid="public-link-state"]');
  const qrShown =
    (await page.getByRole("img", { name: /QR code de pré-inscription/ }).count()) === 1;
  check(
    "an open formation shows its public link and QR code",
    linkUrl.endsWith(`/preinscription/${formation.id}`) &&
      linkState.startsWith("Ouverte") &&
      qrShown,
    JSON.stringify({ linkUrl, linkState, qrShown }),
  );

  /* ------------------------------------------------------------------ 2. public page */
  console.log("\n--- 2. the public page, without an account ---");
  publicCtx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const pub = await publicCtx.newPage();
  pub.on("pageerror", (e) => errors.push(e.stack || e.message));
  await pub.goto(`${BASE}/preinscription/${formation.id}`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await pub.getByTestId("public-formation-name").waitFor({ timeout: 30000 });
  check(
    "the visitor sees the formation, its group, schedule and places, with no login",
    (await text(pub, '[data-testid="public-formation-name"]')) === FORMATION &&
      (await pub.getByText("Samedi 10:00–11:30").count()) >= 1 &&
      (await pub.getByText("Places disponibles : 10").count()) >= 1 &&
      !pub.url().includes("/login"),
  );
  const whens = await pub.getByTestId("group-when").allTextContents();
  check(
    "each group says when it meets: its times, or its start date when times are not set yet",
    whens.some((w) => w.includes("Samedi 10:00–11:30")) &&
      whens.some(
        (w) =>
          w.includes("Début : 03/11/2026") &&
          w.includes("Horaires communiqués par l'établissement"),
      ),
    JSON.stringify(whens),
  );
  check(
    "the group choice shows the times too",
    (await pub
      .getByRole("radio", { name: new RegExp(`^${GROUP}.*Samedi 10:00–11:30`) })
      .count()) === 1,
  );
  await pub.getByRole("button", { name: "Envoyer la pré-inscription" }).click();
  check(
    "an empty form is refused with explanations",
    (await pub.getByTestId("public-form-invalid").count()) === 1,
  );
  await pub.fill("#app-dob", "2016-03-14");
  await pub.waitForTimeout(300);
  check(
    "a child's birth date shows the guardian block",
    (await pub.getByTestId("guardian-block").count()) === 1,
  );
  await submitChild(pub, { first: "Ahmed", last: `${TAG} Ben Ali ${RUN}` });
  await pub.getByTestId("public-success").waitFor({ timeout: 30000 });
  check(
    "after sending, only the confirmation is shown (no formation details, no groups again)",
    (await pub.getByTestId("public-formation-name").count()) === 0 &&
      (await pub.getByTestId("group-when").count()) === 0 &&
      (await pub.getByText(FORMATION).count()) === 1,
  );
  const stored =
    await one(`select status, guardian_phone, preferred_group_id::text g, consent_at is not null consent,
                                   source_hash is not null hashed, phone
                              from public.applications where program_id = '${formation.id}' and first_name = 'Ahmed';`);
  check(
    "the request is stored: new, guardian phone normalised, preferred group, consent, no raw address",
    stored?.status === "new" &&
      stored?.guardian_phone === GUARDIAN_PHONE_NORM &&
      stored?.g === group.id &&
      stored?.consent === true &&
      stored?.hashed === true,
    JSON.stringify(stored),
  );

  await pub.goto(`${BASE}/preinscription/${formation.id}`, { waitUntil: "networkidle" });
  await pub.getByTestId("public-formation-name").waitFor({ timeout: 30000 });
  await submitChild(pub, { first: "Robot", last: `${TAG} Bot ${RUN}`, bot: true, group: false });
  await pub.getByTestId("public-success").waitFor({ timeout: 30000 });
  check(
    "a bot (honeypot filled) gets the same answer, and nothing is stored",
    (
      await one(
        `select count(*)::int c from public.applications where first_name = 'Robot' and program_id = '${formation.id}';`,
      )
    )?.c === 0,
  );

  await pub.goto(`${BASE}/preinscription/${closed.id}`, { waitUntil: "networkidle" });
  await pub.getByTestId("public-closed").waitFor({ timeout: 30000 });
  check("a closed formation says pre-registration is closed", true);
  await pub.goto(`${BASE}/preinscription/00000000-0000-0000-0000-000000000000`, {
    waitUntil: "networkidle",
  });
  await pub.waitForTimeout(1500);
  check(
    "an unknown formation says it does not exist",
    (await pub.getByText("Formation introuvable").count()) === 1,
  );

  /* ------------------------------------------------------------------ 3. administration */
  console.log("\n--- 3. the administration reviews and accepts ---");
  check(
    "the administrator is notified",
    (
      await one(`select count(*)::int c from public.notifications
                 where user_id = '${fx.admin.id}' and kind = 'application_received'
                   and params ->> 'formation' = '${FORMATION}';`)
    )?.c === 1,
  );
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1500);
  const sideLink = page
    .locator('[data-sidebar="sidebar"]')
    .getByRole("link", { name: "Pré-inscriptions" });
  check("the sidebar entry is live (no longer « Bientôt »)", (await sideLink.count()) === 1);
  await sideLink.click();
  await page
    .getByRole("heading", { name: "Pré-inscriptions", exact: true })
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const row = page.locator("main tbody tr").filter({ hasText: `${TAG} Ben Ali ${RUN}` });
  check(
    "the request is listed as new, with the formation and the guardian's phone",
    (await row.count()) === 1 &&
      (await row.getByText("Nouvelle").count()) === 1 &&
      (await row.getByText(FORMATION).count()) === 1 &&
      (await row.getByText(GUARDIAN_PHONE_NORM).count()) === 1,
  );
  await row.getByRole("button").first().click();
  await page.getByTestId("application-name").waitFor();
  // The duplicate search runs once the dialog is open.
  await page
    .getByTestId("duplicates")
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  check(
    "a student with the same guardian phone is flagged as a possible duplicate",
    (await page.getByTestId("duplicates").getByText("même téléphone").count()) >= 1,
  );
  await page.getByRole("button", { name: "Commencer le traitement" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Accepter", exact: true }).click();
  await page.getByLabel("Créer un nouvel élève à partir de la demande").check();
  check(
    "the preferred group is pre-selected for the placement",
    (await text(page, "#accept-group")).startsWith(GROUP),
  );
  await page.getByRole("button", { name: "Inscrire dans le groupe" }).click();
  await page.waitForTimeout(4000);
  const accepted =
    await one(`select a.status, a.student_id::text sid, r.status reg, r.group_id::text gid,
                                     p.full_name, p.email, u.banned_until is not null banned, s.guardian_phone, s.date_of_birth::text dob
                                from public.applications a
                                join public.registrations r on r.id = a.registration_id
                                join public.profiles p on p.id = a.student_id
                                join public.students s on s.id = a.student_id
                                join auth.users u on u.id = a.student_id
                               where a.program_id = '${formation.id}' and a.first_name = 'Ahmed';`);
  check(
    "accepting creates the student (login disabled) and an approved enrollment in the group",
    accepted?.status === "accepted" &&
      accepted?.reg === "approved" &&
      accepted?.gid === group.id &&
      accepted?.full_name === `Ahmed ${TAG} Ben Ali ${RUN}` &&
      accepted?.banned === true &&
      accepted?.guardian_phone === GUARDIAN_PHONE_NORM &&
      accepted?.dob === "2016-03-14",
    JSON.stringify(accepted),
  );

  /* ------------------------------------------------------------------ 4. decline, reopen */
  console.log("\n--- 4. declining and reopening ---");
  await pub.goto(`${BASE}/preinscription/${formation.id}`, { waitUntil: "networkidle" });
  await pub.getByTestId("public-formation-name").waitFor({ timeout: 30000 });
  await submitChild(pub, { first: "Sara", last: `${TAG} K ${RUN}`, guardian: "Leila K" });
  await pub.getByTestId("public-success").waitFor({ timeout: 30000 });
  await page.reload();
  await page.waitForTimeout(1500);
  const saraRow = page.locator("main tbody tr").filter({ hasText: `${TAG} K ${RUN}` });
  await saraRow.getByRole("button").first().click();
  await page.getByTestId("application-name").waitFor();
  await page.getByRole("button", { name: "Refuser", exact: true }).click();
  await page.fill("#decision-note", "Groupe complet pour cette période.");
  await page.getByRole("button", { name: "Refuser", exact: true }).click();
  await page.waitForTimeout(1500);
  const rejected = await one(`select status, decision_note from public.applications
                               where program_id = '${formation.id}' and first_name = 'Sara';`);
  check(
    "a request is declined with its reason",
    rejected?.status === "rejected" &&
      rejected?.decision_note === "Groupe complet pour cette période.",
    JSON.stringify(rejected),
  );
  await pick(page, '[aria-label="Statut"]', "Toutes");
  await page.waitForTimeout(500);
  await saraRow.getByRole("button").first().click();
  await page.getByRole("button", { name: "Rouvrir" }).click();
  await page.waitForTimeout(1500);
  check(
    "a declined request can be reopened",
    (
      await one(
        `select status from public.applications where program_id = '${formation.id}' and first_name = 'Sara';`,
      )
    )?.status === "reviewing",
  );
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 5. rate limit */
  console.log("\n--- 5. repeated requests are limited ---");
  await pub.goto(`${BASE}/preinscription/${formation.id}`, { waitUntil: "networkidle" });
  await pub.getByTestId("public-formation-name").waitFor({ timeout: 30000 });
  await submitChild(pub, { first: "Third", last: `${TAG} T ${RUN}`, group: false });
  await pub.getByTestId("public-success").waitFor({ timeout: 30000 });
  await pub.goto(`${BASE}/preinscription/${formation.id}`, { waitUntil: "networkidle" });
  await pub.getByTestId("public-formation-name").waitFor({ timeout: 30000 });
  await submitChild(pub, { first: "Fourth", last: `${TAG} F ${RUN}`, group: false });
  await pub.waitForTimeout(2500);
  check(
    "a fourth request for the same phone the same day is refused politely",
    (await pub.getByText("Trop de demandes ont été envoyées").count()) === 1 &&
      (await one(`select count(*)::int c from public.applications where first_name = 'Fourth';`))
        ?.c === 0,
  );

  /* ------------------------------------------------------------------ 6. Arabic */
  console.log("\n--- 6. Arabic, right to left, on a phone ---");
  await pub.goto(`${BASE}/preinscription/${formation.id}`, { waitUntil: "networkidle" });
  await pub.getByRole("button", { name: "Changer de langue" }).click();
  await pub.getByRole("menuitem", { name: "العربية" }).click();
  await pub.waitForTimeout(800);
  check(
    "the public form reads in Arabic, right to left",
    (await pub.getByText("استمارة التسجيل المسبق").count()) === 1 &&
      (await pub.locator("html").getAttribute("dir")) === "rtl",
  );

  check("no console errors", errors.length === 0, JSON.stringify(errors.slice(0, 5)));
} finally {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  if (publicCtx) await publicCtx.close();
  await browser.close();
  // Students created by acceptance have an internal e-mail, not an e2e-fixture one.
  await sql(`delete from auth.users where id in (select student_id from public.applications
               where program_name like '${TAG}%' and student_id is not null);`);
  await sql(`delete from public.applications where program_name like '${TAG}%';`);
  await sql(
    `delete from public.notifications where kind = 'application_received' and params ->> 'formation' like '${TAG}%';`,
  );
  await cleanupFixtures();
  await sql(`delete from public.groups where name like '${TAG}%';`);
  await sql(`delete from public.programs where name like '${TAG}%';`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
