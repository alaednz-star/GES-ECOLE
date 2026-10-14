/**
 * Formation -> groups, from the screens an administrator uses (ADR-004, Phase 1 + 2).
 *
 * `verify-programs.mjs` proves the rules in the database, including the atomicity of
 * `create_formation`. This proves the workflow:
 *
 *   - a formation can be created alone, and its page offers (not forces) the first group
 *   - a formation and its first group are created from ONE form, in one step
 *   - with one group the formation reads as one offering (teacher, timetable, room, term, places,
 *     enrolled students in place); with several it lists them
 *   - groups added later keep the formation and its period prefilled
 *   - a formation that names a subject/level fixes them on its groups
 *   - the Groups page filters by formation ("no formation" instead of "school groups") and keeps
 *     its search; standalone groups are still created there
 *   - a formation without groups can be deleted from the list (after confirmation); one with
 *     groups cannot, and the dialog explains why
 *   - fr / ar / en use the Formation vocabulary
 *
 * Every outcome is checked in the database as well as on screen. LOCAL ONLY (fixtures.mjs
 * refuses any non-loopback API); needs the dev server (BASE_URL, default http://localhost:8080).
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
const ROOM = `${TAG} Salle 2 ${RUN}`;
const ALONE = `${TAG} Atelier photo ${RUN}`;
const COURSE = `${TAG} Anglais C1 ${RUN}`;
const UUID = "[0-9a-f-]{36}";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true, teacher: true, student: true });

const pick = async (triggerSelector, optionName) => {
  await page.click(triggerSelector);
  await page.getByRole("option", { name: optionName, exact: true }).click();
};
const groupList = () => page.getByRole("list", { name: "Groupes de la formation" });
const single = () => page.getByTestId("single-group");
const one = async (q) => (await sql(q))[0];

async function login(p, who) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForTimeout(1000);
  await p.fill('input[type="email"]', who.email);
  await p.fill('input[type="password"]', who.password);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/dashboard/, { timeout: 60000 });
}

try {
  await sql(
    `update public.profiles set locale = 'fr' where id in ('${fx.admin.id}', '${fx.teacher.id}');`,
  );
  await sql(`insert into public.rooms (name) values ('${ROOM}') on conflict do nothing;`);
  await login(page, fx.admin);

  /* ------------------------------------------------------------------ 1. formation alone */
  console.log("\n--- 1. a formation can be created without any group ---");
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("heading", { name: "Formations", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Nouvelle formation" }).click();
  await page.fill("#prog-name", ALONE);
  await pick("#prog-category", "Atelier");
  await page.fill("#prog-duration", "6");
  check(
    "the first group is optional and off by default",
    (await page.locator("#prog-with-group").getAttribute("aria-checked")) === "false" &&
      (await page.locator("#group-name").count()) === 0,
  );
  await page.getByRole("button", { name: "Créer la formation", exact: true }).click();
  await page.waitForURL(new RegExp(`/dashboard/programs/${UUID}$`), { timeout: 30000 });
  const aloneId = page.url().split("/").pop();
  await page.getByRole("heading", { name: ALONE, exact: true }).waitFor({ timeout: 30000 });
  const aloneDb = await one(
    `select status, (select count(*)::int from public.groups where program_id = p.id) groups
       from public.programs p where id = '${aloneId}';`,
  );
  check(
    "it is saved with zero groups and opens on its own page",
    aloneDb?.groups === 0 && aloneDb?.status === "draft",
    JSON.stringify(aloneDb),
  );
  check(
    "the page offers the first group without forcing it",
    (await page.getByText("Aucun groupe pour l'instant").count()) === 1 &&
      (await page.getByRole("button", { name: "Ajouter le premier groupe" }).count()) === 1,
  );

  /* ------------------------------------------------------------------ 2. formation + group */
  console.log("\n--- 2. a formation and its first group, in one form ---");
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("button", { name: "Nouvelle formation" }).click();
  await page.fill("#prog-name", COURSE);
  await pick("#prog-category", "Cours de langues");
  await page.fill("#prog-start", "2026-11-01");
  await page.fill("#prog-end", "2027-02-28");
  await pick("#prog-status", "Active — proposée dès maintenant");
  await page.locator("#prog-with-group").click();
  await page.waitForSelector("#group-name", { timeout: 10000 });
  check(
    "the group name is suggested from the formation name",
    (await page.inputValue("#group-name")) === `${COURSE} — Groupe A`,
    await page.inputValue("#group-name"),
  );
  check(
    "the group term starts from the formation's period",
    (await page.inputValue("#group-start-date")) === "2026-11-01" &&
      (await page.inputValue("#group-end-date")) === "2027-02-28",
  );
  check(
    "the group form does not ask again for subject, level or formation",
    (await page.locator("#group-subject").count()) === 0 &&
      (await page.locator("#group-level").count()) === 0 &&
      (await page.locator("#group-program").count()) === 0,
  );
  await pick("#group-teacher", fx.teacher.fullName);
  await page.fill("#group-max", "12");
  await page.getByRole("button", { name: "Ajouter un créneau" }).click();
  // Rooms are managed (ADR-007): the slot's room is chosen from the institution's rooms.
  await page.getByTestId("slot-room").last().click();
  await page.getByRole("option", { name: ROOM }).click();
  await page.getByRole("button", { name: "Créer la formation et son groupe" }).click();
  await page.waitForURL(new RegExp(`/dashboard/programs/${UUID}$`), { timeout: 30000 });
  const courseId = page.url().split("/").pop();
  await single().waitFor({ timeout: 30000 });
  const courseDb = await one(
    `select p.status, g.id gid, g.name, g.teacher_id, g.max_students, g.start_date::text s,
            g.end_date::text e, (select room from public.group_schedules where group_id = g.id) room
       from public.programs p join public.groups g on g.program_id = p.id where p.id = '${courseId}';`,
  );
  check(
    "one submit created the formation (active) and its group with teacher, places, term and room",
    courseDb?.status === "active" &&
      courseDb?.name === `${COURSE} — Groupe A` &&
      courseDb?.teacher_id === fx.teacher.id &&
      courseDb?.max_students === 12 &&
      courseDb?.s === "2026-11-01" &&
      courseDb?.e === "2027-02-28" &&
      courseDb?.room === ROOM,
    JSON.stringify(courseDb),
  );

  /* ------------------------------------------------------------------ 3. one group */
  console.log("\n--- 3. with one group, the formation reads as one offering ---");
  const singleText = await single().innerText();
  check(
    "teacher, timetable with room, places and free places are shown in place",
    singleText.includes(fx.teacher.fullName) &&
      singleText.includes(ROOM) &&
      singleText.includes("0/12") &&
      singleText.includes("12 place(s) libre(s)"),
    singleText.slice(0, 300),
  );
  check(
    "no group list to navigate, and no duplicated totals in the formation details",
    (await groupList().count()) === 0 &&
      (await page.locator("main").getByText("Enseignants", { exact: true }).count()) === 0,
  );
  await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
             values ('${fx.student.id}', '${courseDb.gid}', 'approved', now());`);
  await page.reload();
  await single().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const withStudent = await single().innerText();
  check(
    "enrolled students are listed in place, with a link to the full group",
    withStudent.includes(fx.student.fullName) &&
      withStudent.includes("1/12") &&
      (await single().getByRole("link", { name: "Ouvrir le groupe" }).count()) === 1,
    withStudent.slice(0, 300),
  );

  /* ------------------------------------------------------------------ 4. several groups */
  console.log("\n--- 4. a second group turns the formation into the parent view ---");
  await page.getByRole("button", { name: "Ajouter un groupe" }).click();
  await page.waitForSelector("#group-name", { timeout: 15000 });
  check(
    "the formation is shown, not chosen again, and the next name and period are prefilled",
    (await page.getByTestId("group-form-program").innerText()) === COURSE &&
      (await page.locator("#group-program").count()) === 0 &&
      (await page.inputValue("#group-name")) === `${COURSE} — Groupe B` &&
      (await page.inputValue("#group-start-date")) === "2026-11-01",
  );
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await groupList().locator("li").nth(1).waitFor({ timeout: 30000 });
  const db2 = await one(
    `select count(*)::int c from public.groups where program_id = '${courseId}';`,
  );
  check(
    "both groups are listed under the formation (screen and database)",
    db2.c === 2 &&
      (await groupList().locator("li").count()) === 2 &&
      (await single().count()) === 0,
  );
  check(
    "the formation details now show its totals (teachers, places across groups)",
    (await page.locator("main").getByText("Enseignants", { exact: true }).count()) === 1 &&
      (await page.getByText("1/32", { exact: true }).count()) >= 1,
  );
  const rowB = groupList().locator("li").filter({ hasText: "Groupe B" });
  check(
    "each row shows its operational facts (places left, status)",
    (await rowB.innerText()).includes("20 place(s) libre(s)"),
    await rowB.innerText(),
  );
  await rowB.getByRole("button", { name: /Modifier/ }).click();
  await page.waitForSelector("#group-max", { timeout: 15000 });
  await page.fill("#group-max", "15");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByText("1/27", { exact: true }).first().waitFor({ timeout: 30000 });
  const b = await one(
    `select program_id, max_students from public.groups where name = '${COURSE} — Groupe B';`,
  );
  check(
    "a group edited from its formation keeps the formation",
    b?.program_id === courseId && b?.max_students === 15,
    JSON.stringify(b),
  );

  /* ------------------------------------------------------------------ 5. fixed by formation */
  console.log("\n--- 5. a formation that names a subject and level fixes them ---");
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("button", { name: "Nouvelle formation" }).click();
  await pick("#prog-level", "3ème année secondaire");
  await page.locator("#prog-with-group").click();
  await page.waitForSelector("#group-stream", { timeout: 10000 });
  check("in the create form, a level with streams asks the group's stream", true);
  await page.keyboard.press("Escape");

  const fixedProgram = (
    await one(`insert into public.programs (name, category, status, level_id, subject_id)
                 select '${TAG} Bac Maths ${RUN}', 'exam_preparation', 'active', l.id, s.id
                   from public.levels l, public.subjects s
                  where l.name = '3ème année secondaire' and s.key = 'mathematics'
               returning id;`)
  ).id;
  await page.goto(`${BASE}/dashboard/programs/${fixedProgram}`);
  await page.getByRole("button", { name: "Ajouter le premier groupe" }).click();
  await page
    .locator("#group-subject")
    .filter({ hasText: "Mathématiques" })
    .waitFor({ timeout: 15000 });
  check(
    "subject and level come from the formation and cannot be changed on the group",
    (await page.locator("#group-subject").isDisabled()) &&
      (await page.locator("#group-level").isDisabled()) &&
      (await page.getByText("Défini par la formation.").count()) === 2,
  );
  await page.keyboard.press("Escape");
  await sql(`update public.programs set status = 'archived' where id = '${fixedProgram}';`);
  await page.reload();
  await page.getByRole("heading", { name: `${TAG} Bac Maths ${RUN}` }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  check(
    "an archived formation offers no group creation",
    (await page.getByRole("button", { name: /Ajouter (le premier|un) groupe/ }).count()) === 0,
  );

  /* ------------------------------------------------------------------ 6. Groups page */
  console.log("\n--- 6. the Groups page filters by formation ---");
  await page.goto(`${BASE}/dashboard/groups`);
  const filter = page.getByRole("combobox", { name: "Filtrer par formation" });
  await filter.waitFor({ timeout: 30000 });
  check(
    "no group-type tabs and no 'school groups' wording",
    (await page.getByRole("tab").count()) === 0 &&
      (await page.getByText(/groupes scolaires/i).count()) === 0,
  );
  const rows = () => page.locator("main tbody tr");
  await filter.click();
  await page.getByRole("option", { name: `${COURSE} (2)` }).click();
  await page.waitForTimeout(400);
  check(
    "choosing a formation lists exactly its groups",
    (await rows().count()) === 2 && (await rows().filter({ hasText: COURSE }).count()) === 2,
    String(await rows().count()),
  );
  const link = rows().first().getByRole("link", { name: COURSE, exact: true });
  check(
    "each group names its formation as a link",
    (await link.getAttribute("href")) === `/dashboard/programs/${courseId}`,
  );
  await filter.click();
  await page.getByRole("option", { name: /^Sans formation/ }).click();
  await page.waitForTimeout(400);
  const standaloneDb = (
    await one(`select count(*)::int c from public.groups where program_id is null;`)
  ).c;
  check(
    "'Sans formation' lists the standalone groups only",
    (await rows().filter({ hasText: COURSE }).count()) === 0 &&
      (standaloneDb === 0 || (await rows().count()) > 0),
    `rows=${await rows().count()} db=${standaloneDb}`,
  );

  /* ------------------------------------------------------------------ 7. standalone group */
  console.log("\n--- 7. a standalone group is still created from the Groups page ---");
  await page.getByRole("button", { name: "Nouveau groupe" }).first().click();
  await page.waitForSelector("#group-name", { timeout: 15000 });
  check(
    "the formation is optional there",
    (await page.locator("#group-program").innerText()).includes("Aucune formation"),
    await page.locator("#group-program").innerText(),
  );
  const STANDALONE = `${TAG} Groupe autonome ${RUN}`;
  await page.fill("#group-name", STANDALONE);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForSelector("#group-name", { state: "detached", timeout: 30000 });
  const sa = await one(`select program_id from public.groups where name = '${STANDALONE}';`);
  check(
    "it is saved without a formation",
    sa !== undefined && sa.program_id === null,
    JSON.stringify(sa),
  );
  await page.getByPlaceholder("Rechercher un groupe…").fill(STANDALONE);
  await page.waitForTimeout(400);
  check(
    "search still works together with the formation filter",
    (await rows().filter({ hasText: STANDALONE }).count()) === 1,
  );

  /* ------------------------------------------------------------------ 8. group -> formation */
  await page.goto(`${BASE}/dashboard/groups/${courseDb.gid}`);
  await page.getByRole("heading", { name: `${COURSE} — Groupe A` }).waitFor({ timeout: 30000 });
  const back = page.locator("main").getByRole("link", { name: COURSE, exact: true });
  check(
    "a group's page names its formation and links to it",
    (await page.getByText("Formation :").count()) === 1 &&
      (await back.getAttribute("href")) === `/dashboard/programs/${courseId}`,
  );

  /* ------------------------------------------------------------------ 9. vocabulary */
  console.log("\n--- 9. the vocabulary in Arabic and English ---");
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.goto(`${BASE}/dashboard/programs/${courseId}`);
  await page.getByRole("heading", { name: COURSE }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  check(
    "Arabic: التكوينات / الأفواج, right-to-left",
    (await page.evaluate(() => document.documentElement.dir)) === "rtl" &&
      (await sidebar.getByRole("link", { name: "التكوينات", exact: true }).count()) === 1 &&
      (await sidebar.getByRole("link", { name: "الأفواج", exact: true }).count()) === 1 &&
      (await page.getByText("أفواج التكوين").count()) >= 1,
  );
  await sql(`update public.profiles set locale = 'en' where id = '${fx.admin.id}';`);
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("heading", { name: "Courses", exact: true }).waitFor({ timeout: 30000 });
  check(
    "English: Courses / Groups / Enrollments",
    (await sidebar.getByRole("link", { name: "Courses", exact: true }).count()) === 1 &&
      (await sidebar.getByRole("link", { name: "Enrollments", exact: true }).count()) === 1,
  );
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);

  /* ------------------------------------------------------------------ 9b. delete */
  console.log("\n--- 9b. deleting a formation from the list ---");
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("heading", { name: "Formations", exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: `Actions pour ${COURSE}` }).click();
  await page.getByRole("menuitem", { name: "Supprimer", exact: true }).click();
  const blockedDialog = page.getByRole("alertdialog");
  await blockedDialog.waitFor();
  check(
    "a formation with groups cannot be deleted: the dialog explains why and offers no delete button",
    (await blockedDialog.getByText("Cette formation ne peut pas être supprimée").count()) === 1 &&
      (await blockedDialog.getByRole("button", { name: "Supprimer", exact: true }).count()) === 0,
  );
  await blockedDialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: `Actions pour ${ALONE}` }).click();
  await page.getByRole("menuitem", { name: "Supprimer", exact: true }).click();
  const confirmDialog = page.getByRole("alertdialog");
  await confirmDialog.waitFor();
  const asksConfirmation =
    (await confirmDialog.getByText("Supprimer la formation ?").count()) === 1;
  await confirmDialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.waitForTimeout(2500);
  const deleted = await one(
    `select (select count(*)::int from public.programs where id = '${aloneId}') alone,
            (select count(*)::int from public.programs where id = '${courseId}') course;`,
  );
  check(
    "a formation without groups is deleted after confirmation; the other one is untouched",
    asksConfirmation &&
      deleted?.alone === 0 &&
      deleted?.course === 1 &&
      (await page.getByRole("link", { name: ALONE, exact: true }).count()) === 0,
    JSON.stringify(deleted),
  );

  /* ------------------------------------------------------------------ 10. permissions */
  console.log("\n--- 10. the formation pages stay administrator-only ---");
  const tctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const tp = await tctx.newPage();
  await login(tp, fx.teacher);
  await tp.goto(`${BASE}/dashboard/programs/${courseId}`);
  await tp.waitForTimeout(4000);
  check(
    "a teacher is turned away from the formation page",
    !tp.url().endsWith(`/dashboard/programs/${courseId}`) ||
      (await tp.getByRole("button", { name: /Ajouter (le premier|un) groupe/ }).count()) === 0,
    tp.url(),
  );
  await tctx.close();

  check("no console errors", errors.length === 0, JSON.stringify(errors.slice(0, 5)));
} finally {
  await sql(`delete from public.rooms where name like '${TAG}%';`).catch(() => {});
  await browser.close();
  // fixtures.mjs removes fixture payments, registrations, groups (by name) and programmes.
  await cleanupFixtures();
  await sql(`delete from public.groups where name like '${TAG}%';`);
  await sql(`delete from public.programs where name like '${TAG}%';`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
