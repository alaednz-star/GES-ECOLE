/**
 * A formation's level system and level, from the screens an administrator uses (ADR-004
 * section 3, Phase 3B).
 *
 * `verify-level-systems.mjs` proves the rules in the database. This proves the workflow:
 *
 *   - the formation type PROPOSES a level system (academic support / exam preparation -> Algerian
 *     school, language -> CEFR, professional training -> Training, workshop / other -> none)
 *     until the administrator chooses one; the choice then wins over the type
 *   - levels are scoped to the chosen system: school goes stage -> year, CEFR lists A1..C2,
 *     Training and custom systems their own levels
 *   - "no specific level" (no system, no level) and "a system, every level" are two different
 *     saved states, and both survive an edit
 *   - a group of a formation offers only that system's levels; a formation at one level (CEFR
 *     B1) fixes its groups at that level
 *   - fr / ar wording
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
const ENGLISH = `${TAG} LP Anglais ${RUN}`;
const BAC = `${TAG} LP BAC ${RUN}`;
const ATELIER = `${TAG} LP Atelier ${RUN}`;
const TRAINING = `${TAG} LP Bureautique ${RUN}`;
const B1COURSE = `${TAG} LP Anglais B1 ${RUN}`;
const QURAN = `${TAG} LP Coran ${RUN}`;
const CUSTOM_CODE = "e2e_lp_custom";
const CUSTOM_NAME = `${TAG} Hizb`;
const UUID = "[0-9a-f-]{36}";
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true });
const one = async (q) => (await sql(q))[0];

const pick = async (triggerSelector, optionName) => {
  await page.click(triggerSelector);
  await page.getByRole("option", { name: optionName, exact: true }).click();
};
/** The option labels of a select, read by opening it (then closed with Escape). */
const options = async (triggerSelector) => {
  await page.click(triggerSelector);
  const labels = await page.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  return labels.map((l) => l.trim());
};
const text = async (selector) => ((await page.locator(selector).textContent()) ?? "").trim();
const summary = () => text('[data-testid="level-summary"]');
const formation = (name) =>
  one(`select s.code system, l.code level from public.programs p
         left join public.level_systems s on s.id = p.level_system_id
         left join public.levels l on l.id = p.level_id
        where p.name = '${name.replace(/'/g, "''")}';`);
const newFormation = async () => {
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("heading", { name: "Formations", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Nouvelle formation" }).click();
  await page.locator("#prog-level-system").waitFor();
  await page.waitForTimeout(800); // systems and levels loaded
};
const create = async () => {
  await page.getByRole("button", { name: "Créer la formation", exact: true }).click();
  await page.waitForURL(new RegExp(`/dashboard/programs/${UUID}$`), { timeout: 30000 });
  await page.waitForTimeout(800);
};

async function login(p, who) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForTimeout(1000);
  await p.fill('input[type="email"]', who.email);
  await p.fill('input[type="password"]', who.password);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/dashboard/, { timeout: 60000 });
}

let expected400 = 0;

try {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await login(page, fx.admin);

  /* ------------------------------------------------------------------ 1. the proposal */
  console.log("\n--- 1. the formation type proposes a level system ---");
  await newFormation();
  const proposals = {};
  for (const [category, label] of [
    ["academic_support", "Soutien scolaire"],
    ["language", "Cours de langues"],
    ["exam_preparation", "Préparation aux examens"],
    ["professional_training", "Formation professionnelle"],
    ["workshop", "Atelier"],
    ["other", "Autre"],
  ]) {
    await pick("#prog-category", label);
    proposals[category] = await text("#prog-level-system");
  }
  check(
    "each type proposes its system (school, CEFR, school, training, none, none)",
    proposals.academic_support === "Système scolaire algérien" &&
      proposals.language === "CECRL (langues)" &&
      proposals.exam_preparation === "Système scolaire algérien" &&
      proposals.professional_training === "Niveaux de formation" &&
      proposals.workshop === "Aucun niveau précis" &&
      proposals.other === "Aucun niveau précis",
    JSON.stringify(proposals),
  );
  check(
    "no level field without a system, and no fake 'none' level",
    (await page.locator("#prog-level").count()) === 0 &&
      (await page.locator("#prog-stage").count()) === 0 &&
      (await summary()).startsWith("Aucun niveau précis"),
    await summary(),
  );
  await pick("#prog-category", "Cours de langues");
  check(
    "the proposal is announced as a suggestion that can be changed",
    (await summary()).includes("proposé d'après le type"),
    await summary(),
  );
  // Workshop / Other offer every subject domain, so every system fits.
  await pick("#prog-category", "Autre");
  const systemOptions = await options("#prog-level-system");
  check(
    "without a subject, a Workshop / Other formation can use every system",
    [
      "Aucun niveau précis",
      "Système scolaire algérien",
      "CECRL (langues)",
      "Niveaux de formation",
      "Personnalisé",
    ].every((o) => systemOptions.includes(o)),
    JSON.stringify(systemOptions),
  );

  /* ------------------------------------------------------------------ 2. CEFR, every level */
  console.log("\n--- 2. a language formation: CEFR, every level ---");
  await page.fill("#prog-name", ENGLISH);
  await pick("#prog-category", "Cours de langues");
  const cefrLevels = await options("#prog-level");
  check(
    "CEFR lists 'Tous les niveaux' then A1..C2 only, no stage and no school year",
    JSON.stringify(cefrLevels) === JSON.stringify(["Tous les niveaux", ...CEFR]) &&
      (await page.locator("#prog-stage").count()) === 0,
    JSON.stringify(cefrLevels),
  );
  await create();
  const englishId = page.url().split("/").pop();
  check(
    "saved as CEFR with no specific level (a system, every level)",
    JSON.stringify(await formation(ENGLISH)) === JSON.stringify({ system: "cefr", level: null }),
    JSON.stringify(await formation(ENGLISH)),
  );
  const englishInfo = (await page.locator("main").textContent()) ?? "";
  check(
    "its page shows the system and 'Tous les niveaux'",
    englishInfo.includes("Système de niveaux") &&
      englishInfo.includes("CECRL (langues)") &&
      englishInfo.includes("Tous les niveaux"),
  );

  /* ------------------------------------------------------------------ 3. school: stage -> year */
  console.log("\n--- 3. a school formation: stage, then year ---");
  await newFormation();
  await page.fill("#prog-name", BAC);
  await pick("#prog-category", "Préparation aux examens");
  check(
    "the school system asks a stage, then a year",
    (await page.locator("#prog-stage").count()) === 1 &&
      JSON.stringify(await options("#prog-stage")) ===
        JSON.stringify(["Tous les cycles", "Primaire", "Moyen", "Secondaire"]),
  );
  await pick("#prog-stage", "Secondaire");
  const years = await options("#prog-level");
  check(
    "a stage narrows the years to its own",
    years[0] === "Tous les niveaux" &&
      years.length === 4 &&
      years.slice(1).every((y) => y.includes("secondaire")),
    JSON.stringify(years),
  );
  await pick("#prog-level", "3ème année secondaire");
  await pick("#prog-stage", "Moyen");
  check(
    "changing the stage drops a year of another stage",
    (await text("#prog-level")) === "Tous les niveaux",
    await text("#prog-level"),
  );
  await pick("#prog-stage", "Secondaire");
  await pick("#prog-level", "3ème année secondaire");
  check(
    "the summary says what will be saved",
    (await summary()).includes("3ème année secondaire"),
    await summary(),
  );
  await create();
  check(
    "saved with the school system and the 3AS level",
    JSON.stringify(await formation(BAC)) ===
      JSON.stringify({ system: "algerian_school", level: "3AS" }),
    JSON.stringify(await formation(BAC)),
  );

  /* ------------------------------------------------------------------ 4. no specific level */
  console.log("\n--- 4. a workshop: no specific level ---");
  await newFormation();
  await page.fill("#prog-name", ATELIER);
  await pick("#prog-category", "Atelier");
  await create();
  check(
    "saved with no system and no level",
    JSON.stringify(await formation(ATELIER)) === JSON.stringify({ system: null, level: null }),
    JSON.stringify(await formation(ATELIER)),
  );
  const atelierInfo = (await page.locator("main").textContent()) ?? "";
  check(
    "its page says 'Aucun niveau précis', distinct from 'Tous les niveaux'",
    atelierInfo.includes("Aucun niveau précis") && !atelierInfo.includes("Tous les niveaux"),
  );

  /* ------------------------------------------------------------------ 5. override */
  console.log("\n--- 5. the administrator's choice wins over the type ---");
  await newFormation();
  await page.fill("#prog-name", TRAINING);
  // Workshop and Other offer every domain, so Training fits both; only the proposal differs.
  await pick("#prog-category", "Atelier");
  await pick("#prog-level-system", "Niveaux de formation");
  await pick("#prog-category", "Autre");
  check(
    "after a manual choice, changing the type no longer changes the system",
    (await text("#prog-level-system")) === "Niveaux de formation" &&
      !(await summary()).includes("proposé"),
    `${await text("#prog-level-system")} / ${await summary()}`,
  );
  const trainingLevels = await options("#prog-level");
  check(
    "Training lists its own levels",
    JSON.stringify(trainingLevels) ===
      JSON.stringify(["Tous les niveaux", "Débutant", "Intermédiaire", "Avancé"]),
    JSON.stringify(trainingLevels),
  );
  await pick("#prog-level", "Débutant");
  await create();
  check(
    "saved with the chosen system and level, not the type's",
    JSON.stringify(await formation(TRAINING)) ===
      JSON.stringify({ system: "training", level: "beginner" }),
    JSON.stringify(await formation(TRAINING)),
  );

  /* ------------------------------------------------------- 5b. a custom system */
  console.log("\n--- 5b. a custom system uses its own levels ---");
  // A custom system with its own levels, created directly (the Levels page per system is 3C).
  await sql(`insert into public.level_systems (code, kind, name, position)
             values ('${CUSTOM_CODE}', 'custom', '${CUSTOM_NAME}', 90);
             insert into public.levels (system_id, code, name, position)
             select s.id, v.code, v.name, v.pos from public.level_systems s,
               (values ('h2', 'Hizb 2', 2), ('h1', 'Hizb 1', 1), ('h3', 'Hizb 3', 3)) v(code, name, pos)
              where s.code = '${CUSTOM_CODE}';`);
  await newFormation();
  await page.fill("#prog-name", QURAN);
  await pick("#prog-category", "Autre");
  await pick("#prog-level-system", CUSTOM_NAME);
  const customLevels = await options("#prog-level");
  check(
    "a custom system is offered by its name and lists only its own levels, in order, no stage",
    JSON.stringify(customLevels) ===
      JSON.stringify(["Tous les niveaux", "Hizb 1", "Hizb 2", "Hizb 3"]) &&
      (await page.locator("#prog-stage").count()) === 0,
    JSON.stringify(customLevels),
  );
  await create();
  const quranId = page.url().split("/").pop();
  check(
    "saved with the custom system and no specific level",
    JSON.stringify(await formation(QURAN)) === JSON.stringify({ system: CUSTOM_CODE, level: null }),
    JSON.stringify(await formation(QURAN)),
  );
  await page.getByRole("button", { name: "Ajouter le premier groupe" }).click();
  await page.locator("#group-level").waitFor();
  await page.waitForTimeout(500);
  const customGroupLevels = await options("#group-level");
  check(
    "its groups offer only the custom levels",
    JSON.stringify(customGroupLevels) ===
      JSON.stringify(["Non affecté", "Hizb 1", "Hizb 2", "Hizb 3"]),
    JSON.stringify(customGroupLevels),
  );
  await pick("#group-level", "Hizb 2");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2500);
  const qg =
    await one(`select l.code from public.groups gr join public.levels l on l.id = gr.level_id
                         where gr.program_id = '${quranId}';`);
  check("the group is saved at its custom level", qg?.code === "h2", JSON.stringify(qg));

  /* ------------------------------------------------------------------ 6. groups */
  console.log("\n--- 6. a group offers only its formation's levels ---");
  await page.goto(`${BASE}/dashboard/programs/${englishId}`);
  await page.getByRole("button", { name: "Ajouter le premier groupe" }).click();
  await page.locator("#group-level").waitFor();
  await page.waitForTimeout(500);
  const groupLevels = await options("#group-level");
  check(
    "the group's level lists the CEFR levels only",
    JSON.stringify(groupLevels) === JSON.stringify(["Non affecté", ...CEFR]),
    JSON.stringify(groupLevels),
  );
  check(
    "the form says the levels come from the formation's system",
    (await page.getByText("Niveaux du système « CECRL (langues) »", { exact: false }).count()) ===
      1,
  );
  await pick("#group-level", "B1");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2500);
  const g =
    await one(`select l.code from public.groups gr join public.levels l on l.id = gr.level_id
                        where gr.program_id = '${englishId}';`);
  check("the group is saved at B1", g?.code === "B1", JSON.stringify(g));

  /* ------------------------------------------------------- 6b. a formation at one level */
  console.log("\n--- 6b. a CEFR B1 formation fixes its groups at B1 ---");
  await newFormation();
  await page.fill("#prog-name", B1COURSE);
  await pick("#prog-category", "Cours de langues");
  await pick("#prog-level", "B1");
  await page.click("#prog-with-group");
  await page.locator("#group-name").waitFor();
  await page.getByRole("button", { name: "Créer la formation et son groupe", exact: true }).click();
  await page.waitForURL(new RegExp(`/dashboard/programs/${UUID}$`), { timeout: 30000 });
  await page.waitForTimeout(800);
  const b1Id = page.url().split("/").pop();
  await page.getByRole("button", { name: "Ajouter un groupe" }).first().click();
  await page.locator("#group-level").waitFor();
  await page.waitForTimeout(500);
  check(
    "the second group's level is B1, shown but not editable",
    (await page.locator("#group-level").isDisabled()) && (await text("#group-level")) === "B1",
    await text("#group-level"),
  );
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2500);
  const b1Groups =
    await sql(`select l.code from public.groups gr left join public.levels l on l.id = gr.level_id
                               where gr.program_id = '${b1Id}' order by gr.created_at;`);
  check(
    "both groups (first group and the one added later) are saved at B1",
    b1Groups.length === 2 && b1Groups.every((r) => r.code === "B1"),
    JSON.stringify(b1Groups),
  );

  /* ------------------------------------------------------------------ 7. editing */
  console.log("\n--- 7. editing keeps each state ---");
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("link", { name: ATELIER, exact: true }).click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator("#prog-level-system").waitFor();
  await page.waitForTimeout(500);
  check(
    "an existing formation with no specific level opens as such, with no proposal",
    (await text("#prog-level-system")) === "Aucun niveau précis" &&
      !(await summary()).includes("proposé"),
  );
  await page.fill("#prog-duration", "8");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2000);
  check(
    "saving it keeps no system and no level",
    JSON.stringify(await formation(ATELIER)) === JSON.stringify({ system: null, level: null }),
    JSON.stringify(await formation(ATELIER)),
  );

  await page.goto(`${BASE}/dashboard/programs/${englishId}`);
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator("#prog-level-system").waitFor();
  await page.waitForTimeout(500);
  check(
    "a CEFR formation opens on CEFR, every level",
    (await text("#prog-level-system")) === "CECRL (langues)" &&
      (await text("#prog-level")) === "Tous les niveaux",
  );
  // Training is not offered for a language formation; a custom system is offered for any.
  await pick("#prog-level-system", "Personnalisé");
  expected400 = 1;
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2500);
  check(
    "moving it to a system its B1 group is not part of is refused, and nothing changes",
    (await page.locator("#prog-level-system").count()) === 1 &&
      JSON.stringify(await formation(ENGLISH)) === JSON.stringify({ system: "cefr", level: null }),
    JSON.stringify(await formation(ENGLISH)),
  );
  check(
    "the refusal is explained in the interface language",
    (await page
      .getByText("Certains groupes de cette formation ont un niveau d'un autre système", {
        exact: false,
      })
      .count()) >= 1,
  );
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 8. Arabic */
  console.log("\n--- 8. Arabic wording ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.goto(`${BASE}/dashboard/programs`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "تكوين جديد" }).first().click();
  await page.locator("#prog-level-system").waitFor();
  await page.waitForTimeout(800);
  check(
    "the picker reads in Arabic",
    (await page.getByText("نظام المستويات (اختياري)").count()) === 1 &&
      (await text("#prog-level-system")) === "النظام المدرسي الجزائري",
    await text("#prog-level-system"),
  );

  const unexpected = errors.filter((e) => !e.includes("status of 400")).length;
  const http400 = errors.length - unexpected;
  check(
    "no console errors (besides the one refused save above)",
    unexpected === 0 && http400 <= expected400,
    JSON.stringify(errors.slice(0, 5)),
  );
} finally {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await browser.close();
  await cleanupFixtures();
  await sql(`delete from public.groups where name like '${TAG}%';`);
  await sql(`delete from public.programs where name like '${TAG}%';`);
  await sql(`delete from public.levels where system_id in
               (select id from public.level_systems where code = '${CUSTOM_CODE}');
             delete from public.level_systems where code = '${CUSTOM_CODE}';`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
