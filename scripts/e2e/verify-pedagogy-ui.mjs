/**
 * Pédagogie end to end (ADR-008): Cahier de textes, Évaluations, Notes & bulletins, Progression.
 *
 *   - the four entries are live for a teacher, hidden from a student
 *   - the teacher fills the lesson log of a session (chapter, homework); a non-session date is
 *     refused; the missing-sessions filter works
 *   - the teacher creates an assessment, enters scores (a score above the maximum is refused,
 *     an absence is not counted) and publishes it
 *   - the administrator creates a period, reads the group's averages and ranks, writes the
 *     remarks and opens the printable report card (general average, mention, remarks)
 *   - progression shows the chapter covered and marks it done; Arabic on a phone
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API); needs the dev server (BASE_URL,
 * default http://localhost:8080).
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e/verify-pedagogy-ui.mjs
 */

import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, sql, API, SERVICE_ROLE_KEY, TEST_PASSWORD } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = process.env.SHOT_DIR ?? null;
const TAG = "e2e-fixture";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const GROUP = `${TAG} PED Maths ${RUN}`;
const CHAPTER = `${TAG} Les suites ${RUN}`;
const PERIOD = `${TAG} Trimestre ${RUN}`;
const ST_A = `Amina Ped ${RUN}`;
const ST_B = `Bilal Ped ${RUN}`;
const NNBSP = /[  ]/g;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
  timezoneId: "UTC",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const one = async (q) => (await sql(q))[0];
const dialog = () => page.getByRole("dialog");
const text = async (loc) => ((await loc.textContent()) ?? "").replace(NNBSP, " ").trim();

async function login(who) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

async function waitClosed() {
  await dialog().waitFor({ state: "detached", timeout: 30000 });
}

try {
  for (const u of [fx.admin, fx.teacher]) {
    await sql(`update public.profiles set locale = 'fr' where id = '${u.id}';`);
  }
  await sql(`update public.profiles set full_name = '${ST_A}' where id = '${fx.student.id}';`);
  // A second student, through the Auth admin API like every fixture account (cleanup deletes it).
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `${TAG}-student2-${RUN}@example.test`,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: ST_B, [TAG]: true },
      app_metadata: { role: "student", [TAG]: true },
    }),
  });
  if (!res.ok) throw new Error(`second student: ${res.status} ${await res.text()}`);
  const b = { id: (await res.json()).id };
  // Onboarded students land on the dashboard rather than the onboarding wizard.
  await sql(`update public.students set level_id = (select id from public.levels order by name limit 1),
      gender = 'female', date_of_birth = '2009-04-12', guardian_name = 'Parent', guardian_phone = '0550000000',
      onboarded_at = now() where id in ('${fx.student.id}', '${b.id}');`);
  const today = (await one(`select current_date::text d, extract(dow from current_date)::int w`)) ?? {};
  // One weekly slot on today's weekday, from four weeks ago: five sessions held up to today.
  const g = await one(`insert into public.groups (name, max_students, teacher_id, status, start_date)
      values ('${GROUP}', 12, '${fx.teacher.id}', 'active', current_date - 28) returning id::text id;`);
  await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time)
      values ('${g.id}', ${today.w}, '09:00', '10:30');`);
  await sql(`insert into public.registrations (student_id, group_id, status, decided_at) values
      ('${fx.student.id}', '${g.id}', 'approved', now()), ('${b.id}', '${g.id}', 'approved', now());`);
  const ch = await one(`insert into public.chapters (group_id, title, position, is_published)
      values ('${g.id}', '${CHAPTER}', 1, true) returning id::text id;`);

  await login(fx.teacher);

  /* ------------------------------------------------------------------ 1. sidebar */
  console.log("\n--- 1. the four pages are live for a teacher ---");
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await sidebar.locator('a[href="/dashboard/attendance"]').waitFor({ timeout: 30000 });
  const links = [];
  for (const href of ["/dashboard/lesson-log", "/dashboard/assessments", "/dashboard/grades", "/dashboard/progression"]) {
    links.push(await sidebar.locator(`a[href="${href}"]`).count());
  }
  check(
    "Cahier de textes, Évaluations, Notes & bulletins and Progression are live links for a teacher",
    links.every((n) => n === 1),
    JSON.stringify(links),
  );

  /* ------------------------------------------------------------------ 2. lesson log */
  console.log("\n--- 2. Cahier de textes ---");
  await page.goto(`${BASE}/dashboard/lesson-log?group=${g.id}`);
  await page.getByTestId("lesson-held").waitFor({ timeout: 30000 });
  await page.getByTestId("lesson-row").first().waitFor({ timeout: 30000 });
  check(
    "the five sessions held are listed, all to fill",
    (await text(page.getByTestId("lesson-held"))) === "5" &&
      (await text(page.getByTestId("lesson-missing"))) === "5" &&
      (await page.locator('[data-testid="lesson-row"][data-logged="false"]').count()) === 5,
    `${await text(page.getByTestId("lesson-held"))} / ${await text(page.getByTestId("lesson-missing"))}`,
  );

  const todayRow = page.locator(`[data-testid="lesson-row"][data-date="${today.d}"]`);
  await todayRow.getByTestId("lesson-edit").click();
  await dialog().waitFor();
  check("the session's date is fixed in the form", await page.getByTestId("lesson-date").isDisabled());
  await page.getByTestId("lesson-save").click();
  check(
    "an empty summary is refused before sending",
    (await dialog().getByText("Décrivez la séance").count()) === 1,
  );
  await page.getByTestId("lesson-chapter").click();
  await page.getByRole("option", { name: CHAPTER }).click();
  await page.getByTestId("lesson-summary-input").fill("Définition d'une suite, premiers exemples");
  await page.getByTestId("lesson-homework-input").fill("Exercices 1 à 4 page 12");
  const due = (await one(`select (current_date + 7)::text d`)).d;
  await page.getByTestId("lesson-due").fill(due);
  await page.getByTestId("lesson-save").click();
  await waitClosed();
  await page.locator(`[data-testid="lesson-row"][data-date="${today.d}"][data-logged="true"]`).waitFor({ timeout: 30000 });
  const saved = await one(`select summary, homework, homework_due::text due, chapter_id::text chapter,
      created_by::text by from public.lesson_entries where group_id = '${g.id}' and session_date = current_date`);
  check(
    "the entry is saved with its chapter, homework and author",
    saved?.chapter === ch.id && saved?.due === due && saved?.by === fx.teacher.id && /suite/.test(saved?.summary ?? ""),
    JSON.stringify(saved),
  );
  check(
    "the counters follow: one logged, four to fill",
    (await text(page.getByTestId("lesson-missing"))) === "4",
    await text(page.getByTestId("lesson-missing")),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pedagogy-lesson-log.png`, fullPage: true });
  await page.getByTestId("lesson-missing-only").click();
  check(
    "the filter shows only the sessions to fill",
    (await page.getByTestId("lesson-row").count()) === 4 &&
      (await page.locator('[data-testid="lesson-row"][data-logged="true"]').count()) === 0,
  );
  await page.getByTestId("lesson-missing-only").click();

  await page.getByTestId("lesson-add").click();
  await dialog().waitFor();
  const offDay = (await one(`select (current_date + 1)::text d`)).d;
  await page.getByTestId("lesson-date").fill(offDay);
  await page.getByTestId("lesson-summary-input").fill("Hors séance");
  await page.getByTestId("lesson-save").click();
  check(
    "a day that is not a session of the group is refused",
    (await dialog().getByText("n'est pas une séance du groupe").count()) === 1,
  );
  await page.keyboard.press("Escape");
  await waitClosed();

  /* ------------------------------------------------------------------ 3. assessments */
  console.log("\n--- 3. Évaluations ---");
  await page.goto(`${BASE}/dashboard/assessments?group=${g.id}`);
  await page.getByTestId("assessment-add").click();
  await dialog().waitFor();
  await page.getByTestId("assessment-title").fill(`${TAG} Contrôle 1 ${RUN}`);
  await page.getByTestId("assessment-coef").fill("2");
  await page.getByTestId("assessment-save").click();
  await waitClosed();
  const row = page.getByTestId("assessment-row").first();
  await row.waitFor({ timeout: 30000 });
  const a1 = await one(`select id::text id, published, coefficient::float coef, max_score::float max,
      created_by::text by from public.assessments where group_id = '${g.id}'`);
  check(
    "the teacher creates an assessment, as a draft",
    a1?.published === false && a1?.coef === 2 && a1?.max === 20 && a1?.by === fx.teacher.id &&
      (await text(page.getByTestId("assessment-status").first())) === "Brouillon",
    JSON.stringify(a1),
  );

  await page.getByTestId("assessment-grade").first().click();
  await dialog().waitFor();
  await page.getByTestId("score-line").first().waitFor({ timeout: 30000 });
  const lineA = page.locator(`[data-testid="score-line"][data-student="${fx.student.id}"]`);
  const lineB = page.locator(`[data-testid="score-line"][data-student="${b.id}"]`);
  await lineA.getByTestId("score-input").fill("25");
  await page.getByTestId("scores-save").click();
  check(
    "a score above the maximum is refused before sending",
    (await dialog().getByText("Une note entre 0 et 20").count()) === 1,
  );
  await lineA.getByTestId("score-input").fill("15,5");
  await lineB.getByTestId("score-absent").click();
  check(
    "the sheet's figures follow what is typed (absence not counted)",
    (await text(dialog().locator('[data-stat="average"]'))) === "15,5" &&
      (await text(dialog().locator('[data-stat="absent"]'))) === "1",
    `${await text(dialog().locator('[data-stat="average"]'))}`,
  );
  await page.getByTestId("scores-save").click();
  await waitClosed();
  const scores = await sql(`select student_id::text s, score::float score, absent from public.assessment_scores
      where assessment_id = '${a1.id}' order by score nulls last`);
  check(
    "the scores and the absence are saved",
    scores.length === 2 && scores[0].s === fx.student.id && scores[0].score === 15.5 && scores[1].absent === true,
    JSON.stringify(scores),
  );
  await page.waitForTimeout(500);
  check(
    "the list counts the graded students",
    (await text(page.getByTestId("assessment-graded").first())) === "2/2",
    await text(page.getByTestId("assessment-graded").first()),
  );
  await page.getByTestId("assessment-publish").first().click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="assessment-status"]')?.textContent?.trim() === "Publiée",
    null,
    { timeout: 30000 },
  );
  check(
    "publishing shows the assessment to students",
    (await one(`select published from public.assessments where id = '${a1.id}'`))?.published === true,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pedagogy-assessments.png`, fullPage: true });
  // A second assessment, out of 10, a week ago: Amina 6 (12/20), Bilal 9 (18/20).
  const a2 = await one(`insert into public.assessments (group_id, title, kind, held_on, max_score, coefficient, published)
      values ('${g.id}', '${TAG} Interrogation ${RUN}', 'quiz', current_date - 7, 10, 1, true) returning id::text id;`);
  await sql(`insert into public.assessment_scores (assessment_id, student_id, score) values
      ('${a2.id}', '${fx.student.id}', 6), ('${a2.id}', '${b.id}', 9);`);

  /* ------------------------------------------------------------------ 4. student */
  console.log("\n--- 4. a student does not reach these pages ---");
  await login(fx.student);
  await page.locator('[data-sidebar="sidebar"]').first().waitFor({ timeout: 30000 });
  const studentLinks = await page
    .locator('[data-sidebar="sidebar"] a[href="/dashboard/grades"], [data-sidebar="sidebar"] a[href="/dashboard/lesson-log"]')
    .count();
  await page.goto(`${BASE}/dashboard/grades`);
  await page.waitForTimeout(2500);
  check(
    "a student has no link and is sent back from the grades page",
    studentLinks === 0 && !/\/dashboard\/grades/.test(page.url()),
    `${studentLinks} ${page.url()}`,
  );

  /* ------------------------------------------------------------------ 5. grades */
  console.log("\n--- 5. Notes & bulletins ---");
  await login(fx.admin);
  await page.goto(`${BASE}/dashboard/grades?group=${g.id}`);
  await page.getByTestId("periods-manage").click();
  await dialog().waitFor();
  const [start, end] = [(await one(`select (current_date - 60)::text d`)).d, (await one(`select (current_date + 30)::text d`)).d];
  await page.getByTestId("period-name").fill(PERIOD);
  await page.getByTestId("period-year").fill("e2e");
  await page.getByTestId("period-start").fill(end);
  await page.getByTestId("period-end").fill(start);
  await page.getByTestId("period-save").click();
  check(
    "a period ending before it starts is refused",
    (await dialog().getByText("La fin ne peut pas précéder le début").count()) === 1,
  );
  await page.getByTestId("period-start").fill(start);
  await page.getByTestId("period-end").fill(end);
  await page.getByTestId("period-save").click();
  await dialog().getByTestId("period-row").first().waitFor({ timeout: 30000 });
  const period = await one(`select id::text id from public.academic_periods where name = '${PERIOD}'`);
  check("the administrator creates the period", !!period?.id);
  await page.keyboard.press("Escape");
  await waitClosed();

  await page.goto(`${BASE}/dashboard/grades?group=${g.id}&period=${period.id}`);
  await page.getByTestId("grades-row").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const rowA = page.locator(`[data-testid="grades-row"][data-student="${fx.student.id}"]`);
  const rowB = page.locator(`[data-testid="grades-row"][data-student="${b.id}"]`);
  // Amina: (15.5 x2 + 12 x1) / 3 = 14.33. Bilal: absent, then 18 -> 18.
  check(
    "averages weigh the coefficients and leave the absence out",
    (await text(rowA.getByTestId("grades-average"))) === "14,33" &&
      (await text(rowB.getByTestId("grades-average"))) === "18",
    `${await text(rowA.getByTestId("grades-average"))} / ${await text(rowB.getByTestId("grades-average"))}`,
  );
  check(
    "ranks follow the averages",
    (await text(rowB.getByTestId("grades-rank"))) === "1/2" && (await text(rowA.getByTestId("grades-rank"))) === "2/2",
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pedagogy-grades.png`, fullPage: true });
  check("both assessments are in the period", (await text(page.getByTestId("grades-assessments"))) === "2");

  await rowA.getByTestId("grades-remark").click();
  await dialog().waitFor();
  await page.getByTestId("remark-group").fill("Bon travail, régulière.");
  await page.getByTestId("remark-general").fill("Trimestre satisfaisant.");
  await page.getByTestId("remark-save").click();
  await waitClosed();
  const remarks = await sql(`select group_id is null general, comment from public.report_comments
      where period_id = '${period.id}' and student_id = '${fx.student.id}' order by general`);
  check(
    "the group remark and the general remark are saved",
    remarks.length === 2 && remarks[0].general === false && remarks[1].general === true,
    JSON.stringify(remarks),
  );

  await rowA.getByTestId("grades-report-card").click();
  await page.getByTestId("report-card").waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  check(
    "the report card names the student and the period",
    (await text(page.getByTestId("report-card-student"))) === ST_A &&
      (await text(page.getByTestId("doc-number"))).includes(PERIOD),
  );
  check(
    "it gives the course average, the general average and its mention",
    (await text(page.getByTestId("report-card-average").first())) === "14,33" &&
      (await text(page.getByTestId("report-card-general"))) === "14,33 / 20" &&
      (await text(page.getByTestId("report-card-mention"))).includes("Très bien"),
    `${await text(page.getByTestId("report-card-general"))} ${await text(page.getByTestId("report-card-mention"))}`,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pedagogy-report-card.png`, fullPage: true });
  const body = await text(page.getByTestId("report-card"));
  check(
    "it carries both remarks and is printable",
    body.includes("Bon travail, régulière.") &&
      body.includes("Trimestre satisfaisant.") &&
      (await page.getByTestId("doc-print").count()) === 1,
  );

  /* ------------------------------------------------------------------ 6. progression */
  console.log("\n--- 6. Progression ---");
  await page.goto(`${BASE}/dashboard/progression`);
  const card = page.locator(`[data-testid="progression-card"][data-group="${g.id}"]`);
  await card.waitFor({ timeout: 30000 });
  check(
    "the overview shows the group's lesson log and coverage",
    (await text(card.getByTestId("progression-logged"))).startsWith("20 %") &&
      (await text(card.getByTestId("progression-coverage"))).startsWith("100 %"),
    `${await text(card.getByTestId("progression-logged"))} | ${await text(card.getByTestId("progression-coverage"))}`,
  );
  await card.getByTestId("progression-open").click();
  const chapterRow = page.locator(`[data-testid="progression-chapter"][data-chapter="${ch.id}"]`);
  await chapterRow.waitFor({ timeout: 30000 });
  check(
    "the chapter referenced in the lesson log counts as covered",
    (await chapterRow.getAttribute("data-covered")) === "true" && (await text(chapterRow)).includes("1 séance"),
    await text(chapterRow),
  );
  await chapterRow.getByTestId("progression-toggle").click();
  await page.waitForFunction(
    (id) => /Terminé le/.test(document.querySelector(`[data-chapter="${id}"]`)?.textContent ?? ""),
    ch.id,
    { timeout: 30000 },
  );
  check(
    "marking the chapter done is saved",
    !!(await one(`select completed_on::text d from public.chapters where id = '${ch.id}'`))?.d,
  );
  await page.getByTestId("progression-period").first().waitFor({ timeout: 30000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pedagogy-progression.png`, fullPage: true });
  check(
    "the results by period show the class average",
    (await text(page.getByTestId("progression-period-average").first())).includes("/ 20"),
    await text(page.getByTestId("progression-period-average").first()),
  );

  /* ------------------------------------------------------------------ 7. Arabic, phone */
  console.log("\n--- 7. Arabic on a phone ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1500);
  const overflows = {};
  for (const path of [
    `/dashboard/lesson-log?group=${g.id}`,
    `/dashboard/assessments?group=${g.id}`,
    `/dashboard/grades?group=${g.id}&period=${period.id}`,
    `/dashboard/progression?group=${g.id}`,
  ]) {
    await page.goto(`${BASE}${path}`);
    await page.locator("main h1").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(900);
    overflows[path.split("?")[0]] = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }
  check(
    "the four pages read right to left in Arabic and fit a phone",
    (await page.evaluate(() => document.documentElement.dir)) === "rtl" &&
      Object.values(overflows).every((o) => o <= 0),
    JSON.stringify(overflows),
  );

  const unexpected = errors.filter(
    (e) => !/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(e),
  );
  check("no console or page errors", unexpected.length === 0, unexpected.join("\n").slice(0, 800));
} catch (e) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pedagogy-failure.png` }).catch(() => {});
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await browser.close();
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`).catch(() => {});
  await cleanupFixtures();
  const left = await one(`select
      (select count(*) from public.groups where name like '${TAG}%')::int groups,
      (select count(*) from public.academic_periods where name like '${TAG}%')::int periods,
      (select count(*) from public.lesson_entries le join public.groups g on g.id = le.group_id where g.name like '${TAG}%')::int entries,
      (select count(*) from public.profiles where email like '${TAG}-%')::int accounts`);
  console.log(`\nleftovers: ${JSON.stringify(left)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
