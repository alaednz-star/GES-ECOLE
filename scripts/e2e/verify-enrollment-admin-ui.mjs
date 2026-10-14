/**
 * Administration enrollment, from the screens (ADR-004 section 4; Phase 4).
 *
 * `verify-enrollment-lifecycle.mjs` proves the rules in the database. This proves the workflow:
 *
 *   formation page -> "Inscrire un élève" -> search -> enroll (one group, then a row of several)
 *   group page     -> roster -> "Retirer" (reason) -> history keeps the row -> enroll again
 *                  -> a pending request approved in place; a full group cannot be over-filled
 *   Inscriptions   -> the "Retirées" tab
 *   student        -> a withdrawn place reads "Vous avez quitté ce groupe" and can be requested
 *                     again; "Mes inscriptions" shows it with the reason
 *   teacher        -> sees the roster, not the enrollment controls
 *
 * Every outcome is checked in the database as well as on screen. LOCAL ONLY; needs the dev
 * server (BASE_URL, default http://localhost:8080).
 */

import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, createGroupFixture, sql } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const TAG = "e2e-fixture";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const one = async (q) => (await sql(q))[0];

const browser = await chromium.launch();
const errors = [];
const track = (p) => {
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(e.stack || e.message));
};

const fx = await withFixtures({ admin: true, teacher: true, student: true });

async function login(p, who) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForTimeout(1000);
  await p.fill('input[type="email"]', who.email);
  await p.fill('input[type="password"]', who.password);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/dashboard|onboarding/, { timeout: 60000 });
}

const STUDENT = `E2E Élève ${RUN}`;

try {
  // A formation with ONE group (3AS sciences, so the fixture student is eligible), capacity 2.
  const group = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: `${TAG} Maths ${RUN} — Groupe A`,
    studentCount: 0,
  });
  const formation = (
    await one(`insert into public.programs (name, category, status)
               values ('${TAG} Maths ${RUN}', 'academic_support', 'active') returning id;`)
  ).id;
  await sql(`update public.groups set program_id = '${formation}', max_students = 2
              where id = '${group.id}';`);
  const g = await one(`select level_id, stream_id from public.groups where id = '${group.id}';`);
  await sql(`update public.profiles set full_name = '${STUDENT}', locale = 'fr'
              where id = '${fx.student.id}';
             update public.profiles set locale = 'fr' where id in ('${fx.admin.id}', '${fx.teacher.id}');
             update public.students set level_id = '${g.level_id}', stream_id = '${g.stream_id}',
               gender = 'female', date_of_birth = '2008-03-14', guardian_name = 'Parent E2E',
               guardian_phone = '0550000000', onboarded_at = now()
              where id = '${fx.student.id}';`);
  const status = async () =>
    (
      await sql(`select status from public.registrations
                  where student_id = '${fx.student.id}' and group_id = '${group.id}'
                  order by created_at;`)
    ).map((r) => r.status);

  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  track(page);
  await login(page, fx.admin);

  /* ------------------------------------------------------------------ 1. from the formation */
  console.log("\n--- 1. enroll an existing student from the formation page ---");
  await page.goto(`${BASE}/dashboard/programs/${formation}`);
  await page.getByTestId("single-group").waitFor({ timeout: 30000 });
  await page.getByTestId("single-group").getByRole("button", { name: "Inscrire un élève" }).click();
  await page.waitForSelector("#enroll-search", { timeout: 15000 });
  check(
    "the dialog shows the group's free places before anything is chosen",
    (await page.getByTestId("enroll-capacity").innerText()).includes("2 place(s) libre(s) sur 2"),
    await page.getByTestId("enroll-capacity").innerText(),
  );
  await page.fill("#enroll-search", "E2E Élève");
  const result = page.getByRole("list", { name: "Élèves trouvés" }).getByRole("button", {
    name: new RegExp(STUDENT),
  });
  await result.waitFor({ timeout: 15000 });
  await result.click();
  check(
    "choosing a student explains what will happen",
    (await page.getByTestId("enroll-summary").innerText()).includes("Sera inscrit"),
  );
  await page.getByRole("button", { name: "Inscrire", exact: true }).click();
  await page.waitForSelector("#enroll-search", { state: "detached", timeout: 15000 });
  await page.getByTestId("single-group").getByText(STUDENT).waitFor({ timeout: 15000 });
  check(
    "the student is enrolled (database) and listed on the formation page",
    (await status()).join(",") === "approved",
    (await status()).join(","),
  );

  /* ------------------------------------------------------------------ 2. withdraw */
  console.log("\n--- 2. withdraw from the group page; history is kept ---");
  await page.goto(`${BASE}/dashboard/groups/${group.id}`);
  await page.getByText(`Formation :`).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: `Retirer ${STUDENT} du groupe` }).click();
  await page.fill("#withdraw-reason", "Déménagement");
  await page.getByRole("button", { name: "Retirer du groupe" }).click();
  const history = page.getByRole("list", { name: "Historique des inscriptions" });
  await history.waitFor({ timeout: 15000 });
  const historyText = await history.innerText();
  check(
    "the withdrawal is stored and shown in the group's history with its reason",
    (await status()).join(",") === "withdrawn" &&
      historyText.includes(STUDENT) &&
      historyText.includes("Déménagement") &&
      historyText.includes("Retirée"),
    historyText.slice(0, 200),
  );

  /* ------------------------------------------------------------------ 3. student side */
  console.log("\n--- 3. the student sees the withdrawal and can ask again ---");
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await sctx.newPage();
  track(sp);
  await login(sp, fx.student);
  await sp.goto(`${BASE}/dashboard/my-registrations`);
  await sp.getByRole("tab", { name: /Retirées/ }).click({ timeout: 30000 });
  await sp.getByText("Vous avez quitté ce groupe").first().waitFor({ timeout: 15000 });
  check(
    "'Mes inscriptions' lists the withdrawn place with the administration's reason",
    (await sp.getByText("Déménagement").count()) >= 1,
  );
  await sp.goto(`${BASE}/dashboard/registration`);
  const card = sp
    .locator("article, li, [data-slot='card'], div")
    .filter({ hasText: group.name })
    .filter({ has: sp.getByText("Vous avez quitté ce groupe") })
    .last();
  await card.waitFor({ timeout: 30000 });
  await card.getByRole("button", { name: "Envoyer une nouvelle demande" }).click();
  // The same confirmation step as a first request.
  await sp.getByRole("button", { name: "Envoyer la demande" }).click({ timeout: 15000 });
  await sp.waitForURL(/registration\/success|registration$/, { timeout: 30000 }).catch(() => {});
  await sp.waitForTimeout(1500);
  check(
    "the catalogue lets a withdrawn student request the group again (new pending row)",
    (await status()).join(",") === "withdrawn,pending",
    (await status()).join(","),
  );
  await sctx.close();

  /* ------------------------------------------------------------------ 4. approve in place */
  console.log("\n--- 4. a pending request is approved from the group page ---");
  await page.reload();
  await page
    .getByRole("button", { name: "Approuver", exact: true })
    .first()
    .click({ timeout: 30000 });
  await page.waitForTimeout(1500);
  check(
    "approving in place enrolls the student again; the old withdrawal stays in history",
    (await status()).join(",") === "withdrawn,approved",
    (await status()).join(","),
  );

  /* ------------------------------------------------------------------ 5. full group */
  console.log("\n--- 5. a full group cannot be over-filled ---");
  await sql(`update public.groups set max_students = 1 where id = '${group.id}';`);
  await page.reload();
  await page.getByRole("button", { name: "Inscrire un élève" }).click({ timeout: 30000 });
  await page.waitForSelector("#enroll-search", { timeout: 15000 });
  check(
    "the dialog says the group is full and does not offer the enrollment",
    (await page.getByTestId("enroll-capacity").innerText()).includes("Groupe complet") &&
      (await page.getByRole("button", { name: "Inscrire", exact: true }).isDisabled()),
  );
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 6. several groups */
  console.log("\n--- 6. with several groups, each row can enroll ---");
  const groupB = await createGroupFixture({
    teacherId: fx.teacher.id,
    name: `${TAG} Maths ${RUN} — Groupe B`,
    studentCount: 0,
  });
  await sql(`update public.groups set program_id = '${formation}' where id = '${groupB.id}';`);
  await page.goto(`${BASE}/dashboard/programs/${formation}`);
  await page
    .getByRole("button", { name: `Inscrire un élève dans ${TAG} Maths ${RUN} — Groupe B` })
    .click({ timeout: 30000 });
  await page.waitForSelector("#enroll-search", { timeout: 15000 });
  check(
    "the dialog opens for that row's group",
    (await page.getByRole("dialog").innerText()).includes(`${TAG} Maths ${RUN} — Groupe B`),
  );
  await page.fill("#enroll-search", "E2E Élève");
  await page
    .getByRole("list", { name: "Élèves trouvés" })
    .getByRole("button", { name: new RegExp(STUDENT) })
    .click({ timeout: 15000 });
  await page.getByRole("button", { name: "Inscrire", exact: true }).click();
  await page.waitForTimeout(1500);
  const inB = await one(`select count(*)::int c from public.registrations
                          where student_id = '${fx.student.id}' and group_id = '${groupB.id}';`);
  check(
    "a student already holding the subject elsewhere is refused with a clear reason",
    inB.c === 0 &&
      (await page.getByText(/déjà inscrit dans « .* » pour cette matière/).count()) >= 1,
    `rows=${inB.c}`,
  );
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 7. Inscriptions page */
  console.log("\n--- 7. the Inscriptions page shows withdrawals ---");
  await page.goto(`${BASE}/dashboard/registrations`);
  await page.getByRole("button", { name: /^Retirées/ }).click({ timeout: 30000 });
  await page.waitForTimeout(800);
  check(
    "the 'Retirées' tab lists the withdrawal with its date",
    (await page.locator("main tbody tr").filter({ hasText: STUDENT }).count()) === 1 &&
      (await page.locator("main tbody tr").filter({ hasText: "Retirée le" }).count()) >= 1,
  );

  /* ------------------------------------------------------------------ 8. teacher */
  console.log("\n--- 8. a teacher sees the roster, not the enrollment controls ---");
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tp = await tctx.newPage();
  track(tp);
  await login(tp, fx.teacher);
  await tp.goto(`${BASE}/dashboard/groups/${group.id}`);
  // The roster link (the name also appears in the hidden print-only roster document).
  await tp.getByRole("link", { name: STUDENT }).first().waitFor({ timeout: 30000 });
  check(
    "no enroll, withdraw or approve control for a teacher",
    (await tp.getByRole("button", { name: /Inscrire un élève|Retirer|Approuver/ }).count()) === 0,
  );
  await tctx.close();

  // Step 6 is refused on purpose (HTTP 409 from the subject rule); the browser logs that
  // response as a failed resource. Anything else is an application error.
  const unexpected = errors.filter((e) => !/status of 409 \(Conflict\)/.test(e));
  check("no console errors", unexpected.length === 0, JSON.stringify(unexpected.slice(0, 5)));
} catch (e) {
  fail++;
  console.log("  HARNESS ERROR:", e.message.slice(0, 400));
} finally {
  await browser.close();
  await cleanupFixtures();
  await sql(`delete from public.groups where name like '${TAG}%';`);
  await sql(`delete from public.programs where name like '${TAG}%';`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
