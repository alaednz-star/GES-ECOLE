/**
 * Phase 2 in a real browser: the hierarchy as a person actually meets it.
 *
 * The API suite proves the data and the rules. This proves the workflow -- that
 * choosing a group fills in its subject, that the chapter list narrows to that
 * group, that a colleague's chapter is nowhere in the list, that the contextual
 * button locks the destination instead of asking again, and that role badges and the
 * course identity survive Arabic and a 375px screen.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase2-ui.mjs
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql, API, PUBLISHABLE_KEY } from "./fixtures.mjs";

const APP = process.env["APP_URL"] ?? "http://localhost:8080";

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  -> ${detail}`);
  }
};

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const other = await withFixtures({ teacher: true });

/** Teacher A owns two groups with DIFFERENT subjects, so "the subject follows the
 *  group" is observable rather than a coincidence. Teacher B owns a third. */
const gMath = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture P2 Maths",
  subjectKey: "mathematics",
  studentCount: 0,
});
const gPhys = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture P2 Physique",
  subjectKey: "physics",
  studentCount: 0,
});
const gForeign = await createGroupFixture({
  teacherId: other.teacher.id,
  name: "e2e-fixture P2 Foreign",
  subjectKey: "natural_sciences",
  studentCount: 0,
});

const chapterIn = async (groupId, title, position) =>
  (
    await sql(`insert into public.chapters (group_id, title, position, is_published)
               values ('${groupId}','${title}',${position}, true) returning id;`)
  )[0].id;

const chMath = await chapterIn(gMath.id, "e2e Cinématique", 1);
await chapterIn(gPhys.id, "e2e Optique", 1);
await chapterIn(gForeign.id, "e2e ForeignChapter", 1);

/** One resource per role in the maths chapter, so the badges are all on screen. */
const roles = ["notes", "exercises", "solutions", "video", "homework", "extra"];
for (const [i, role] of roles.entries()) {
  await sql(`insert into public.resources
               (chapter_id, group_id, title, kind, url, role, position, is_published, created_by)
             values ('${chMath}','${gMath.id}','e2e ${role} item','link',
                     'https://example.test/${role}','${role}',${i}, true, '${fx.teacher.id}');`);
}

// Enrol the fixture student in the maths group only.
await sql(`update public.students set gender=coalesce(gender,'male'),
             date_of_birth=coalesce(date_of_birth,'2008-05-14'),
             guardian_name=coalesce(guardian_name,'Parent Fixture'),
             guardian_phone=coalesce(guardian_phone,'0661000000'),
             level_id=(select level_id from public.groups where id='${gMath.id}'),
             stream_id=(select stream_id from public.groups where id='${gMath.id}'),
             onboarded_at=now()
           where id='${fx.student.id}';`);
await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
           values ('${fx.student.id}','${gMath.id}','approved',now())
           on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);

const teacherName = (
  await sql(`select full_name from public.profiles where id='${fx.teacher.id}';`)
)[0].full_name;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const login = async (email, password) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

const setLocale = async (userId, locale) => {
  await sql(`update public.profiles set locale='${locale}' where id='${userId}';`);
};

/** Opens a shadcn Select by its trigger id and returns the visible option labels. */
const optionsOf = async (triggerId) => {
  await page.locator(`#${triggerId}`).click();
  await page.waitForTimeout(500);
  const labels = await page.locator('[role="option"]').allInnerTexts();
  return labels.map((l) => l.trim()).filter(Boolean);
};
const chooseOption = async (label) => {
  await page.locator('[role="option"]', { hasText: label }).first().click();
  await page.waitForTimeout(700);
};
const closeListbox = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
};

const noOverflow = () =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );

try {
  /* ================= the global cascade ================= */
  console.log("\n--- global '+ Ajouter une ressource': GROUPE -> MATIERE -> CHAPITRE ---");
  await login(fx.teacher.email, fx.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);

  await page
    .locator("button")
    .filter({ hasText: /^Ajouter une ressource$/ })
    .first()
    .click();
  await page.waitForTimeout(900);

  let dialog = await page.locator('[role="dialog"]').innerText();
  check(
    "the dialog asks for the group first",
    /Groupe/.test(dialog) && /Matière/.test(dialog) && /Chapitre/.test(dialog),
    dialog.slice(0, 160),
  );
  check(
    "no group is chosen yet, so the subject and chapter say so",
    /Choisissez d'abord un groupe/.test(dialog),
    dialog.slice(0, 200),
  );
  check("the flat 'Group · Chapter' selector is gone", !/·/.test(dialog), dialog.slice(0, 200));

  const groupLabels = await optionsOf("res-group");
  check(
    "the group list holds this teacher's groups",
    groupLabels.some((l) => /P2 Maths/.test(l)) && groupLabels.some((l) => /P2 Physique/.test(l)),
    groupLabels.join(" | ").slice(0, 200),
  );
  check(
    "a colleague's group is NOT offered",
    !groupLabels.some((l) => /P2 Foreign/.test(l)),
    groupLabels.join(" | ").slice(0, 200),
  );

  await chooseOption("e2e-fixture P2 Maths");
  dialog = await page.locator('[role="dialog"]').innerText();
  check(
    "choosing the group fills in its subject",
    /Mathématiques/.test(dialog),
    dialog.slice(0, 220),
  );

  let chapterLabels = await optionsOf("res-chapter");
  check(
    "the chapter list is scoped to that group",
    chapterLabels.some((l) => /Cinématique/.test(l)) &&
      !chapterLabels.some((l) => /Optique|ForeignChapter/.test(l)),
    chapterLabels.join(" | "),
  );
  await closeListbox();

  // Switching group must re-derive the subject AND replace the chapter list.
  await page.locator("#res-group").click();
  await page.waitForTimeout(400);
  await chooseOption("e2e-fixture P2 Physique");
  dialog = await page.locator('[role="dialog"]').innerText();
  check("switching group re-derives the subject", /Physique/.test(dialog), dialog.slice(0, 220));
  chapterLabels = await optionsOf("res-chapter");
  check(
    "...and replaces the chapter list, so a stale pairing is impossible",
    chapterLabels.some((l) => /Optique/.test(l)) &&
      !chapterLabels.some((l) => /Cinématique/.test(l)),
    chapterLabels.join(" | "),
  );
  await closeListbox();

  const roleLabels = await optionsOf("res-role");
  check(
    "all six pedagogical roles are offered, in reading order",
    /Cours/.test(roleLabels[0] ?? "") &&
      /Exercices/.test(roleLabels[1] ?? "") &&
      /Corrigés/.test(roleLabels[2] ?? "") &&
      roleLabels.length === 6,
    roleLabels.join(" | "),
  );
  await closeListbox();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  /* ================= saving through the cascade ================= */
  console.log("\n--- a resource filed through the cascade lands in the right place ---");
  await page
    .locator("button")
    .filter({ hasText: /^Ajouter une ressource$/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.locator("#res-group").click();
  await page.waitForTimeout(400);
  await chooseOption("e2e-fixture P2 Maths");
  await page.locator("#res-chapter").click();
  await page.waitForTimeout(400);
  await chooseOption("e2e Cinématique");
  await page.locator("#res-role").click();
  await page.waitForTimeout(400);
  await chooseOption("Corrigés");
  await page
    .locator('[role="dialog"] button', { hasText: /Lien externe/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.fill("#res-title", "e2e cascade filed");
  await page.fill("#res-url", "https://example.test/cascade");
  await page
    .locator('[role="dialog"] button')
    .filter({ hasText: /Enregistrer/ })
    .last()
    .click();
  await page.waitForTimeout(2500);

  const filed = await sql(`select r.title, r.role::text, r.group_id, r.chapter_id
                             from public.resources r where r.title='e2e cascade filed';`);
  check("the resource was created", filed.length === 1, JSON.stringify(filed));
  check(
    "it landed in the chosen group and chapter, with the chosen role",
    filed[0]?.group_id === gMath.id &&
      filed[0]?.chapter_id === chMath &&
      filed[0]?.role === "solutions",
    JSON.stringify(filed[0]),
  );

  /* ================= the contextual, locked path ================= */
  console.log("\n--- '+' inside a chapter locks the destination ---");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await page.locator('button[aria-label="Ajouter une ressource"]').first().click();
  await page.waitForTimeout(900);
  dialog = await page.locator('[role="dialog"]').innerText();
  check("the dialog states where it is filing", /Ajout dans/.test(dialog), dialog.slice(0, 220));
  check(
    "group, subject and chapter are all named",
    /P2 (Maths|Physique)/.test(dialog) && /(Mathématiques|Physique)/.test(dialog),
    dialog.slice(0, 260),
  );
  check(
    "there is nothing to choose: no group or chapter selector",
    (await page.locator("#res-group").count()) === 0 &&
      (await page.locator("#res-chapter").count()) === 0,
  );
  check(
    "the role is still chosen, because only the teacher knows it",
    (await page.locator("#res-role").count()) === 1,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  /* ================= role badges + course identity ================= */
  console.log("\n--- badges and course identity, teacher side ---");
  const body = await page.locator("body").innerText();
  check(
    "every role badge is rendered",
    ["COURS", "EXERCICES", "CORRIGÉ", "VIDÉO", "DEVOIR", "COMPLÉMENT"].every((b) =>
      body.toUpperCase().includes(b),
    ),
    body.slice(0, 200),
  );
  check("the course identity names the teacher", body.includes(teacherName), body.slice(0, 300));
  check("the file-type badge was not replaced by the role", /Lien|PDF/i.test(body));
  check("no horizontal overflow at 1440px", await noOverflow());

  await page.setViewportSize({ width: 1024, height: 800 });
  await page.waitForTimeout(800);
  check("no horizontal overflow at 1024px", await noOverflow());
  await page.setViewportSize({ width: 375, height: 720 });
  await page.waitForTimeout(800);
  check("no horizontal overflow at 375px", await noOverflow());
  const mobile = await page.locator("body").innerText();
  check(
    "the hierarchy survives on a phone",
    /P2 Maths/.test(mobile) && /Cinématique/.test(mobile),
    mobile.slice(0, 200),
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ================= the list view ================= */
  console.log("\n--- Liste view carries group, subject, chapter and role ---");
  await page
    .locator("button", { hasText: /^Liste$/ })
    .first()
    .click();
  await page.waitForTimeout(1200);
  const list = await page.locator("body").innerText();
  check(
    "the table names group, subject and chapter",
    /P2 Maths/.test(list) && /Mathématiques/.test(list) && /Cinématique/.test(list),
    list.slice(0, 240),
  );
  check("the table shows role badges", /CORRIGÉ|COURS/.test(list.toUpperCase()));
  check("no horizontal overflow in the table at 1440px", await noOverflow());
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.waitForTimeout(700);
  check("no horizontal overflow in the table at 1024px", await noOverflow());
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ================= student ================= */
  console.log("\n--- student sees COURSE -> SUBJECT -> TEACHER -> CHAPTER -> RESOURCE ---");
  await login(fx.student.email, fx.student.password);
  await page.goto(`${APP}/dashboard/my-resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  const stud = await page.locator("body").innerText();
  check("the course is named", /P2 Maths/.test(stud), stud.slice(0, 240));
  check("the subject is named", /Mathématiques/.test(stud));
  check("the teacher is named", stud.includes(teacherName), stud.slice(0, 300));
  check("the chapter is named", /Cinématique/.test(stud));
  check(
    "resources carry their role",
    /COURS|EXERCICES|CORRIGÉ/.test(stud.toUpperCase()),
    stud.slice(0, 240),
  );
  check(
    "nothing from a group they are not enrolled in",
    !/Optique|ForeignChapter|P2 Foreign/.test(stud),
    stud.slice(0, 240),
  );

  const before = Number(
    (
      await sql(`select count(*)::int c from public.resource_events
                  where student_id='${fx.student.id}' and kind='view';`)
    )[0].c,
  );
  await page.locator("text=e2e notes item").first().click();
  await page.waitForTimeout(2500);
  const after = Number(
    (
      await sql(`select count(*)::int c from public.resource_events
                  where student_id='${fx.student.id}' and kind='view';`)
    )[0].c,
  );
  check(
    "opening a resource still records progress for THIS student",
    after > before,
    `${before} -> ${after}`,
  );
  await page.keyboard.press("Escape");

  /* ================= Arabic / RTL ================= */
  console.log("\n--- Arabic, right to left ---");
  await setLocale(fx.teacher.id, "ar");
  await login(fx.teacher.email, fx.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  const dir = await page.evaluate(() => document.documentElement.dir);
  check("the document is RTL", dir === "rtl", String(dir));
  const ar = await page.locator("body").innerText();
  check("the hierarchy labels are translated", /الفوج|المادة|الفصل/.test(ar), ar.slice(0, 200));
  check("role badges are translated", /درس|تمارين|حل/.test(ar), ar.slice(0, 260));
  check("no horizontal overflow in RTL at 1440px", await noOverflow());

  await page.locator('button[aria-label="إضافة مورد"]').first().click();
  await page.waitForTimeout(900);
  const arDialog = await page.locator('[role="dialog"]').innerText();
  check("the locked context is translated", /إضافة إلى/.test(arDialog), arDialog.slice(0, 200));
  const clipped = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]');
    if (!el) return true;
    return el.scrollWidth > el.clientWidth + 2;
  });
  check("the dialog does not clip its Arabic labels", !clipped);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 375, height: 720 });
  await page.waitForTimeout(900);
  check("no horizontal overflow in RTL at 375px", await noOverflow());
} finally {
  await setLocale(fx.teacher.id, "fr");
  await browser.close();
  await sql(`delete from public.resources where title like 'e2e %';`);
  await sql(`delete from public.chapters where title like 'e2e %';`);
  await fx.cleanup();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
