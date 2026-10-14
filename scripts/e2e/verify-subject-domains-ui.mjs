/**
 * Subject domains in the screens an administrator uses (20261004130000_subject_domains.sql).
 *
 * `verify-subject-domains.mjs` proves the data and the permissions. This proves the workflow:
 *
 *   - a subject is classified on the Subjects page (create and edit), and the list shows it
 *   - the formation form offers only the subjects that suit its type:
 *       language -> languages; academic support / exam preparation -> school subjects +
 *       languages; professional training -> professional + computing + languages;
 *       workshop / other -> every subject
 *   - changing the type keeps a subject that still fits, clears one that does not and says why;
 *     the cleared subject is never saved
 *   - an existing formation loads with the subject it was saved with, even one the filter would
 *     not offer today
 *   - the level systems follow the subject (or, without a subject, the type): no CEFR or training
 *     levels for Mathematics, no training levels for English, no school years or CEFR for a
 *     professional subject; a chosen system that stops fitting is cleared with the reason; an
 *     existing Mathematics + CEFR formation opens unchanged, with a notice
 *   - French and Arabic (right-to-left) wording
 *
 * Expected lists are computed from the subjects in the database, so the suite does not depend on
 * which custom subjects an installation has. LOCAL ONLY (fixtures.mjs refuses any non-loopback
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
const KEY = "e2e_sdui";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const ROBOTICS = `${TAG} Robotique ${RUN}`;
const COURSE = `${TAG} SD Anglais ${RUN}`;
const CLEARED = `${TAG} SD Cleared ${RUN}`;
const LEGACY = `${TAG} SD Legacy ${RUN}`;
const LEGACY_CEFR = `${TAG} SD Maths CECRL ${RUN}`;
const ACCOUNTING = `${TAG} Comptabilité ${RUN}`;
const UUID = "[0-9a-f-]{36}";

/** The filter, written independently of the app's code. */
const DOMAINS = {
  academic_support: ["school_subjects", "languages"],
  exam_preparation: ["school_subjects", "languages"],
  formal_education: ["school_subjects", "languages"],
  language: ["languages"],
  general_course: null, // every domain
  extracurricular: null,
  professional_training: ["professional", "computing", "languages"],
  workshop: null, // every domain
  other: null,
};
const TYPE_LABEL = {
  formal_education: "Enseignement scolaire",
  general_course: "Formation générale",
  extracurricular: "Activités parascolaires",
  academic_support: "Soutien scolaire",
  language: "Cours de langues",
  exam_preparation: "Préparation aux examens",
  professional_training: "Formation professionnelle",
  workshop: "Atelier",
  other: "Autre",
};

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
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const newFormation = async () => {
  await page.goto(`${BASE}/dashboard/programs`);
  await page.getByRole("heading", { name: "Formations", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Nouvelle formation" }).click();
  await page.locator("#prog-subject").waitFor();
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
  // Two classified fixture subjects so every domain has at least one subject.
  await sql(`insert into public.subjects (key, name, domain) values
               ('${KEY}_it', '${TAG} Informatique ${RUN}', 'computing'),
               ('${KEY}_acc', '${TAG} Comptabilité ${RUN}', 'professional');`);
  await login(page, fx.admin);

  /* ------------------------------------------------------------------ 1. Subjects page */
  console.log("\n--- 1. a subject is classified on the Subjects page ---");
  await page.goto(`${BASE}/dashboard/subjects`);
  await page.getByRole("heading", { name: "Matières", exact: true }).waitFor({ timeout: 30000 });
  await page
    .getByRole("button", { name: /Nouvelle matière|Ajouter une matière/ })
    .first()
    .click();
  await page.locator("#subject-domain").waitFor();
  check(
    "the form asks the domain, with the five domains in plain words",
    sameSet(await options("#subject-domain"), [
      "Langues",
      "Matières scolaires",
      "Informatique et technologie",
      "Professionnel et technique",
      "Autre / non classée",
    ]),
  );
  await page.fill("#subject-name", ROBOTICS);
  await pick("#subject-domain", "Informatique et technologie");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2000);
  const robot = await one(
    `select id::text id, domain from public.subjects where name = '${ROBOTICS}';`,
  );
  check("it is saved in that domain", robot?.domain === "computing", JSON.stringify(robot));
  const row = page.locator("main tbody tr").filter({ hasText: ROBOTICS });
  check(
    "the list shows the domain",
    (await row.getByText("Informatique et technologie").count()) === 1,
  );
  await row.getByRole("button", { name: new RegExp(`Modifier`) }).click();
  await page.locator("#subject-domain").waitFor();
  await page.waitForTimeout(400);
  check(
    "editing shows the current domain",
    (await text("#subject-domain")) === "Informatique et technologie",
  );
  await pick("#subject-domain", "Professionnel et technique");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2000);
  check(
    "and saves a new one",
    (await one(`select domain from public.subjects where id = '${robot?.id}';`))?.domain ===
      "professional",
  );

  /* ------------------------------------------------------------------ 2. the filter */
  console.log("\n--- 2. the formation type filters the subjects ---");
  const all = await sql(`select name, domain from public.subjects;`);
  const expected = (category) => [
    "Non précisé",
    ...all
      .filter((s) => DOMAINS[category] === null || DOMAINS[category].includes(s.domain))
      .map((s) => s.name),
  ];
  await newFormation();
  const seen = {};
  for (const category of Object.keys(TYPE_LABEL)) {
    await pick("#prog-category", TYPE_LABEL[category]);
    seen[category] = sameSet(await options("#prog-subject"), expected(category));
  }
  check(
    "each type offers exactly the subjects of its domains (workshop and other: all)",
    Object.values(seen).every(Boolean),
    JSON.stringify(seen),
  );
  await pick("#prog-category", "Cours de langues");
  check(
    "a filtered list says which domains it offers",
    (await text('[data-testid="subject-hint"]')) === "Matières proposées pour ce type : Langues.",
    await text('[data-testid="subject-hint"]'),
  );
  await pick("#prog-category", "Atelier");
  check(
    "an unfiltered list needs no explanation",
    (await page.locator('[data-testid="subject-hint"]').count()) === 0,
  );

  /* ------------------------------------------------------------------ 3. type changes */
  console.log("\n--- 3. changing the type ---");
  await pick("#prog-category", "Soutien scolaire");
  await pick("#prog-subject", "Anglais");
  await pick("#prog-category", "Cours de langues");
  check(
    "a subject that still fits is kept, silently",
    (await text("#prog-subject")) === "Anglais" &&
      (await page.locator('[data-testid="subject-notice"]').count()) === 0,
  );
  await page.fill("#prog-name", COURSE);
  await page.getByRole("button", { name: "Créer la formation", exact: true }).click();
  await page.waitForURL(new RegExp(`/dashboard/programs/${UUID}$`), { timeout: 30000 });
  const course = await one(`select p.category, s.key from public.programs p
                             join public.subjects s on s.id = p.subject_id where p.name = '${COURSE}';`);
  check(
    "saved as a language formation in English",
    course?.category === "language" && course?.key === "english",
    JSON.stringify(course),
  );

  await newFormation();
  await page.fill("#prog-name", CLEARED);
  await pick("#prog-category", "Soutien scolaire");
  await pick("#prog-subject", "Mathématiques");
  await pick("#prog-category", "Cours de langues");
  const notice = await text('[data-testid="subject-notice"]');
  check(
    "a subject that no longer fits is cleared, and the form says why",
    (await text("#prog-subject")) === "Non précisé" &&
      notice ===
        "« Mathématiques » (Matières scolaires) a été retirée : elle ne correspond pas au type « Cours de langues ».",
    notice,
  );
  await page.getByRole("button", { name: "Créer la formation", exact: true }).click();
  await page.waitForURL(new RegExp(`/dashboard/programs/${UUID}$`), { timeout: 30000 });
  const cleared = await one(
    `select category, subject_id from public.programs where name = '${CLEARED}';`,
  );
  check(
    "the cleared subject is not saved",
    cleared?.category === "language" && cleared?.subject_id === null,
    JSON.stringify(cleared),
  );

  /* ------------------------------------------------------------------ 4. existing data */
  console.log("\n--- 4. existing formations load as they are ---");
  const legacy = await one(`insert into public.programs (name, category, subject_id)
                              select '${LEGACY}', 'language', id from public.subjects where key = 'mathematics'
                            returning id::text id;`);
  await page.goto(`${BASE}/dashboard/programs/${legacy.id}`);
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator("#prog-subject").waitFor();
  await page.waitForTimeout(600);
  check(
    "a combination the filter would not offer today still loads with its subject",
    (await text("#prog-subject")) === "Mathématiques" &&
      (await options("#prog-subject")).includes("Mathématiques"),
  );
  await page.fill("#prog-duration", "12");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2000);
  const kept = await one(`select p.duration_hours, s.key from public.programs p
                           join public.subjects s on s.id = p.subject_id where p.id = '${legacy.id}';`);
  check(
    "saving it without changing the type keeps its subject",
    kept?.duration_hours === 12 && kept?.key === "mathematics",
    JSON.stringify(kept),
  );
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator("#prog-subject").waitFor();
  await page.waitForTimeout(600);
  await pick("#prog-category", "Formation professionnelle");
  check(
    "changing its type applies the filter: the subject is cleared with an explanation",
    (await text("#prog-subject")) === "Non précisé" &&
      (await page.locator('[data-testid="subject-notice"]').count()) === 1,
  );
  await page.keyboard.press("Escape");
  const unchanged = await one(`select category, subject_id is not null has_subject
                                 from public.programs where id = '${legacy.id}';`);
  check(
    "closing without saving changes nothing",
    unchanged?.category === "language" && unchanged?.has_subject === true,
    JSON.stringify(unchanged),
  );

  /* ------------------------------------------------------------------ 4b. level systems */
  console.log("\n--- 4b. the level systems follow the subject ---");
  const SCHOOL = "Système scolaire algérien";
  const CEFR = "CECRL (langues)";
  const TRAINING = "Niveaux de formation";
  const NONE = "Aucun niveau précis";
  await newFormation();
  await pick("#prog-category", "Soutien scolaire");
  await pick("#prog-subject", "Mathématiques");
  const mathsSystems = await options("#prog-level-system");
  check(
    "Mathematics: school years offered; CEFR (A1..C2) and training levels are not",
    mathsSystems.includes(SCHOOL) &&
      !mathsSystems.includes(CEFR) &&
      !mathsSystems.includes(TRAINING),
    JSON.stringify(mathsSystems),
  );
  await newFormation();
  await pick("#prog-category", "Cours de langues");
  await pick("#prog-subject", "Anglais");
  const englishSystems = await options("#prog-level-system");
  check(
    "English: CEFR proposed, school years offered, training levels not",
    (await text("#prog-level-system")) === CEFR &&
      englishSystems.includes(SCHOOL) &&
      !englishSystems.includes(TRAINING),
    JSON.stringify(englishSystems),
  );
  await newFormation();
  await pick("#prog-category", "Formation professionnelle");
  await pick("#prog-subject", ACCOUNTING);
  const proSystems = await options("#prog-level-system");
  check(
    "a professional subject: training levels proposed; school years and CEFR not offered",
    (await text("#prog-level-system")) === TRAINING &&
      !proSystems.includes(SCHOOL) &&
      !proSystems.includes(CEFR),
    JSON.stringify(proSystems),
  );

  await newFormation();
  await pick("#prog-category", "Soutien scolaire");
  await pick("#prog-subject", "Anglais");
  await pick("#prog-level-system", CEFR);
  await pick("#prog-subject", "Mathématiques");
  const subjectNotice = await text('[data-testid="level-notice"]');
  check(
    "English -> Mathematics with CEFR chosen: system cleared, with the reason",
    (await text("#prog-level-system")) === NONE &&
      subjectNotice ===
        "« CECRL (langues) » a été retiré : ce système de niveaux ne convient pas à la matière « Mathématiques ».",
    subjectNotice,
  );

  await newFormation();
  await pick("#prog-category", "Formation professionnelle");
  await pick("#prog-level", "Débutant");
  await pick("#prog-category", "Cours de langues");
  const typeNotice = await text('[data-testid="level-notice"]');
  check(
    "no subject, training levels chosen, type -> Cours de langues: system cleared, with the reason",
    (await text("#prog-level-system")) === NONE &&
      typeNotice ===
        "« Niveaux de formation » a été retiré : ce système de niveaux ne convient pas au type « Cours de langues ».",
    typeNotice,
  );
  await page.keyboard.press("Escape");

  const legacyCefr =
    await one(`insert into public.programs (name, category, subject_id, level_system_id, level_id)
      select '${LEGACY_CEFR}', 'language',
             (select id from public.subjects where key = 'mathematics'), s.id, l.id
        from public.level_systems s join public.levels l on l.system_id = s.id
       where s.code = 'cefr' and l.code = 'B1'
      returning id::text id;`);
  await page.goto(`${BASE}/dashboard/programs/${legacyCefr.id}`);
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator("#prog-level-system").waitFor();
  await page.waitForTimeout(800);
  const legacyNotice = await text('[data-testid="level-notice"]');
  check(
    "an existing Mathematics + CEFR formation opens exactly as stored, with a notice",
    (await text("#prog-subject")) === "Mathématiques" &&
      (await text("#prog-level-system")) === CEFR &&
      (await text("#prog-level")) === "B1" &&
      legacyNotice.startsWith("Combinaison existante conservée : « CECRL (langues) »"),
    legacyNotice,
  );
  await page.fill("#prog-duration", "20");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForTimeout(2000);
  const keptCefr = await one(`select p.duration_hours, sub.key subject, s.code system, l.code level
                                from public.programs p
                                join public.subjects sub on sub.id = p.subject_id
                                join public.level_systems s on s.id = p.level_system_id
                                join public.levels l on l.id = p.level_id
                               where p.id = '${legacyCefr.id}';`);
  check(
    "saving another field keeps that combination untouched",
    JSON.stringify(keptCefr) ===
      JSON.stringify({ duration_hours: 20, subject: "mathematics", system: "cefr", level: "B1" }),
    JSON.stringify(keptCefr),
  );

  /* ------------------------------------------------------------------ 5. Arabic */
  console.log("\n--- 5. Arabic, right to left ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.goto(`${BASE}/dashboard/programs`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "تكوين جديد" }).first().click();
  await page.locator("#prog-subject").waitFor();
  await page.waitForTimeout(800);
  await pick("#prog-category", "دروس اللغات");
  check(
    "the filter explains itself in Arabic, right to left",
    (await text('[data-testid="subject-hint"]')) === "المواد المقترحة لهذا النوع: اللغات." &&
      (await page.locator("html").getAttribute("dir")) === "rtl",
    await text('[data-testid="subject-hint"]'),
  );
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/dashboard/subjects`);
  await page.waitForTimeout(2500);
  check(
    "the Subjects page names the domain in Arabic",
    (await page.getByText("المجال", { exact: true }).count()) >= 1 &&
      (await page.getByText("اللغات", { exact: true }).count()) >= 1,
  );

  check("no console errors", errors.length === 0, JSON.stringify(errors.slice(0, 5)));
} finally {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await browser.close();
  await cleanupFixtures();
  await sql(`delete from public.groups where name like '${TAG}%';`);
  await sql(`delete from public.programs where name like '${TAG}%';`);
  await sql(`delete from public.subjects where key like '${KEY}%' or name like '${TAG}%';`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
