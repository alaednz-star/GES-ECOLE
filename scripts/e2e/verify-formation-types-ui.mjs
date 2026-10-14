/**
 * Formation types in the screens an administrator uses (20261005100000_formation_types.sql).
 *
 * `verify-formation-types.sql` proves the data, the lifecycle and the permissions in the
 * database. This proves the workflow:
 *
 *   - the Types page lists the 9 built-in types (translated), with their use count
 *   - a custom type is created, renamed, refused when its name is taken, deactivated
 *   - a formation is created with a custom type; once the type is deactivated, it is no longer
 *     offered to a new formation, while the existing formation keeps it, explains it and saves
 *   - a used type cannot be deleted (the dialog names the formations); an unused one can
 *   - built-in types cannot be edited or deleted, but can be deactivated
 *   - the type only SUGGESTS a level system: general course + Soroban -> Training proposed;
 *     general course + Mathematics -> none; extracurricular + mental arithmetic -> Training;
 *     workshop + Robotics -> none; school education -> school years
 *   - Arabic labels, right to left; no console errors
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API); needs the dev server (BASE_URL,
 * default http://localhost:8080).
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
const KEY = "e2e_ftui";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const CUSTOM = `${TAG} Stage ${RUN}`;
const CUSTOM_RENAMED = `${TAG} Stage intensif ${RUN}`;
const SPARE = `${TAG} Type libre ${RUN}`;
const ON_CUSTOM = `${TAG} FT Stage ${RUN}`;
const SOROBAN = `${TAG} Soroban ${RUN}`;
const MENTAL = `${TAG} Calcul mental ${RUN}`;
const ROBOTICS = `${TAG} Robotique ${RUN}`;
const UUID = "[0-9a-f-]{36}";

const SCHOOL = "Système scolaire algérien";
const TRAINING = "Niveaux de formation";
const NONE = "Aucun niveau précis";

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
const options = async (triggerSelector) => {
  await page.click(triggerSelector);
  const labels = await page.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  return labels.map((l) => l.trim());
};
const text = async (selector) => ((await page.locator(selector).textContent()) ?? "").trim();
const typesPage = async () => {
  await page.goto(`${BASE}/dashboard/programs/types`);
  await page
    .getByRole("heading", { name: "Types de formation", exact: true })
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
};
const rowOf = (label) => page.locator("main tbody tr").filter({ hasText: label });
const menuOf = async (label) => {
  await page.getByRole("button", { name: `Actions pour ${label}`, exact: true }).click();
};
const newFormation = async () => {
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("heading", { name: "Formations", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Nouvelle formation" }).click();
  await page.locator("#prog-category").waitFor();
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

try {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await sql(`insert into public.subjects (key, name, domain) values
               ('${KEY}_sor', '${SOROBAN}', 'other'),
               ('${KEY}_men', '${MENTAL}', 'other'),
               ('${KEY}_rob', '${ROBOTICS}', 'computing');`);
  await login(page, fx.admin);

  /* ------------------------------------------------------------------ 1. the Types page */
  console.log("\n--- 1. the Types page ---");
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("link", { name: "Types de formation" }).click();
  await page
    .getByRole("heading", { name: "Types de formation", exact: true })
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const builtIns = [
    "Enseignement scolaire",
    "Soutien scolaire",
    "Préparation aux examens",
    "Cours de langues",
    "Formation générale",
    "Activités parascolaires",
    "Formation professionnelle",
    "Atelier",
    "Autre",
  ];
  const listed = [];
  for (const b of builtIns) listed.push((await rowOf(b).count()) >= 1);
  check(
    "the Formations page leads to the Types page, which lists the 9 built-in types, translated",
    listed.every(Boolean),
    JSON.stringify(listed),
  );
  await menuOf("Atelier");
  check(
    "a built-in type can be deactivated but not edited or deleted",
    (await page.getByRole("menuitem", { name: "Désactiver" }).count()) === 1 &&
      (await page.getByRole("menuitem", { name: "Modifier" }).count()) === 0 &&
      (await page.getByRole("menuitem", { name: "Supprimer" }).count()) === 0,
  );
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 2. custom type */
  console.log("\n--- 2. a custom type: create, rename, duplicate name ---");
  await page.getByRole("button", { name: "Nouveau type" }).click();
  await page.fill("#type-name", CUSTOM);
  await page.fill("#type-description", "Sessions intensives pendant les vacances.");
  await page.getByRole("button", { name: "Créer le type", exact: true }).click();
  await page.waitForTimeout(2000);
  const created = await one(`select code, built_in, status from public.formation_types
                              where name = '${CUSTOM}';`);
  check(
    "a custom type is created, active, with a generated code",
    created?.built_in === false && created?.status === "active" && /^custom_/.test(created?.code),
    JSON.stringify(created),
  );
  check(
    "the list shows it as the institution's own type",
    (await rowOf(CUSTOM).getByText("Propre à l'établissement").count()) === 1,
  );
  await menuOf(CUSTOM);
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  await page.fill("#type-name", CUSTOM_RENAMED);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2000);
  const renamed = await one(
    `select name, code from public.formation_types where code = '${created?.code}';`,
  );
  check(
    "it is renamed; its code (identity) is unchanged",
    renamed?.name === CUSTOM_RENAMED && renamed?.code === created?.code,
    JSON.stringify(renamed),
  );
  await page.getByRole("button", { name: "Nouveau type" }).click();
  await page.fill("#type-name", "Soutien scolaire");
  await page.getByRole("button", { name: "Créer le type", exact: true }).click();
  check(
    "a name already used (here a built-in type's) is refused with an explanation",
    (await page.getByText("Un type porte déjà ce nom.").count()) >= 1,
  );
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 3. use it, deactivate it */
  console.log("\n--- 3. a formation on a custom type, then the type deactivated ---");
  await newFormation();
  await page.fill("#prog-name", ON_CUSTOM);
  await pick("#prog-category", CUSTOM_RENAMED);
  await page.getByRole("button", { name: "Créer la formation", exact: true }).click();
  await page.waitForURL(new RegExp(`/dashboard/programs/${UUID}$`), { timeout: 30000 });
  const onCustomId = page.url().split("/").pop();
  check(
    "a formation is created with the custom type",
    (await one(`select category from public.programs where id = '${onCustomId}';`))?.category ===
      created?.code,
  );
  await typesPage();
  await menuOf(CUSTOM_RENAMED);
  await page.getByRole("menuitem", { name: "Désactiver" }).click();
  await page.waitForTimeout(1500);
  check(
    "the type is deactivated; its use count shows the formation",
    (await one(`select status from public.formation_types where code = '${created?.code}';`))
      ?.status === "inactive" && (await rowOf(CUSTOM_RENAMED).getByText("1").count()) >= 1,
  );
  await newFormation();
  check(
    "an inactive type is no longer offered to a new formation",
    !(await options("#prog-category")).includes(CUSTOM_RENAMED),
  );
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/dashboard/programs/${onCustomId}`);
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator("#prog-category").waitFor();
  await page.waitForTimeout(600);
  check(
    "the existing formation keeps its inactive type, with an explanation",
    (await text("#prog-category")) === CUSTOM_RENAMED &&
      (await text('[data-testid="type-description"]')).startsWith("Ce type est désactivé"),
  );
  await page.fill("#prog-duration", "30");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2000);
  const kept = await one(
    `select category, duration_hours from public.programs where id = '${onCustomId}';`,
  );
  check(
    "it still saves, with its type unchanged",
    kept?.category === created?.code && kept?.duration_hours === 30,
    JSON.stringify(kept),
  );

  /* ------------------------------------------------------------------ 4. delete */
  console.log("\n--- 4. deleting types ---");
  await typesPage();
  await menuOf(CUSTOM_RENAMED);
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  const blocked = page.getByRole("alertdialog");
  await blocked.waitFor();
  check(
    "a used type cannot be deleted: the dialog names the formation and offers no delete button",
    (await blocked.getByText("Ce type ne peut pas être supprimé").count()) === 1 &&
      (await blocked.getByText(ON_CUSTOM, { exact: false }).count()) === 1 &&
      (await blocked.getByRole("button", { name: "Supprimer", exact: true }).count()) === 0,
  );
  await blocked.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Nouveau type" }).click();
  await page.fill("#type-name", SPARE);
  await page.getByRole("button", { name: "Créer le type", exact: true }).click();
  await page.waitForTimeout(1500);
  await menuOf(SPARE);
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Supprimer", exact: true })
    .click();
  await page.waitForTimeout(1500);
  check(
    "an unused custom type is deleted after confirmation",
    (await one(`select count(*)::int c from public.formation_types where name = '${SPARE}';`))
      ?.c === 0,
  );

  /* ------------------------------------------------------------------ 5. suggestions */
  console.log("\n--- 5. the type suggests, it does not force ---");
  const proposal = async (type, subject) => {
    await newFormation();
    await pick("#prog-category", type);
    if (subject) await pick("#prog-subject", subject);
    return text("#prog-level-system");
  };
  check(
    "general course + Soroban: Training proposed",
    (await proposal("Formation générale", SOROBAN)) === TRAINING,
  );
  const customOffered = (await options("#prog-level-system")).includes("Personnalisé");
  check("... and a custom progression stays available", customOffered);
  check(
    "general course + Mathematics: nothing proposed (Training does not fit a school subject)",
    (await proposal("Formation générale", "Mathématiques")) === NONE,
  );
  check(
    "extracurricular + mental arithmetic: Training proposed",
    (await proposal("Activités parascolaires", MENTAL)) === TRAINING,
  );
  check("workshop + Robotics: no level proposed", (await proposal("Atelier", ROBOTICS)) === NONE);
  check(
    "school education: school years proposed",
    (await proposal("Enseignement scolaire", null)) === SCHOOL,
  );
  check(
    "English + language course: CEFR proposed",
    (await proposal("Cours de langues", "Anglais")) === "CECRL (langues)",
  );
  check(
    "English + professional training: Training is not forced (not offered for a language)",
    (await proposal("Formation professionnelle", "Anglais")) === NONE &&
      (await options("#prog-level-system")).includes("CECRL (langues)"),
  );

  /* ------------------------------------------------------------------ 6. built-in deactivated */
  console.log("\n--- 6. a deactivated built-in type ---");
  await typesPage();
  await menuOf("Atelier");
  await page.getByRole("menuitem", { name: "Désactiver" }).click();
  await page.waitForTimeout(1500);
  await newFormation();
  const withoutWorkshop = await options("#prog-category");
  await page.keyboard.press("Escape");
  await typesPage();
  await menuOf("Atelier");
  await page.getByRole("menuitem", { name: "Activer" }).click();
  await page.waitForTimeout(1500);
  check(
    "a deactivated built-in type disappears from new formations, and comes back once reactivated",
    !withoutWorkshop.includes("Atelier") &&
      (await one(`select status from public.formation_types where code = 'workshop';`))?.status ===
        "active",
  );

  /* ------------------------------------------------------------------ 7. Arabic */
  console.log("\n--- 7. Arabic, right to left ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.goto(`${BASE}/dashboard/programs/types`);
  await page.waitForTimeout(2500);
  check(
    "the Types page and the built-in labels read in Arabic, right to left",
    (await page.getByRole("heading", { name: "أنواع التكوين", exact: true }).count()) === 1 &&
      (await rowOf("أنشطة لاصفية").count()) === 1 &&
      (await rowOf("دروس اللغات").count()) === 1 &&
      (await page.locator("html").getAttribute("dir")) === "rtl",
  );

  // External resources (Google Fonts) fail when the machine is offline; that is not the app.
  const appErrors = errors.filter(
    (e) => !/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(e),
  );
  check("no console errors", appErrors.length === 0, JSON.stringify(appErrors.slice(0, 5)));
} finally {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await sql(`update public.formation_types set status = 'active' where built_in;`);
  await browser.close();
  await cleanupFixtures();
  await sql(`delete from public.groups where name like '${TAG}%';`);
  await sql(`delete from public.programs where name like '${TAG}%';`);
  await sql(`delete from public.formation_types where name like '${TAG}%';`);
  await sql(`delete from public.subjects where key like '${KEY}%';`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
