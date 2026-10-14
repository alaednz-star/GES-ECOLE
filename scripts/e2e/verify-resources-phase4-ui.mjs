/**
 * Phase 4 in a real browser: a student is told, and a teacher can see who read it.
 *
 * The API suite proves the mechanism. This proves the two ends a person touches --
 * the notification actually appearing in the bell with readable prose, and the
 * engagement panel naming the students who have not opened something.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase4-ui.mjs
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql } from "./fixtures.mjs";

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

const fx = await withFixtures({ teacher: true, student: true });
const group = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture P4 Physique",
  subjectKey: "physics",
  studentCount: 2,
});
// The signed-in student joins the same group as the two generated ones, so the
// engagement panel has both an opener and non-openers to list.
await sql(`update public.students set gender=coalesce(gender,'male'),
             date_of_birth=coalesce(date_of_birth,'2008-05-14'),
             guardian_name=coalesce(guardian_name,'Parent Fixture'),
             guardian_phone=coalesce(guardian_phone,'0661000000'),
             level_id=(select level_id from public.groups where id='${group.id}'),
             stream_id=(select stream_id from public.groups where id='${group.id}'),
             onboarded_at=now()
           where id='${fx.student.id}';`);
await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
           values ('${fx.student.id}','${group.id}','approved',now())
           on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);

const chapter = (
  await sql(`insert into public.chapters (group_id, title, position, is_published)
             values ('${group.id}','e2e P4 Cinématique',1,true) returning id;`)
)[0].id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const login = async (email, password) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};
const noOverflow = () =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );

try {
  /* ============ a teacher publishes; the student is told ============ */
  console.log("\n--- publishing notifies the student ---");
  await login(fx.teacher.email, fx.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page
    .locator('section:has-text("e2e P4 Cinématique")')
    .last()
    .locator('button[aria-label="Ajouter une ressource"]')
    .first()
    .click();
  await page.waitForTimeout(900);
  await page
    .locator('[role="dialog"] button', { hasText: /Lien externe/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.fill("#res-title", "Notes de cours P4");
  await page.fill("#res-url", "https://example.test/p4");
  await page
    .locator('[role="dialog"] button', { hasText: /Enregistrer/ })
    .last()
    .click();
  await page.waitForTimeout(2500);

  const notices = await sql(`select count(*)::int c from public.notifications
                              where kind = 'resource_published'
                                and params->>'title' = 'Notes de cours P4';`);
  check("one notice per enrolled student", notices[0].c === 3, `${notices[0].c} (3 enrolled)`);

  await login(fx.student.email, fx.student.password);
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page
    .locator('button[aria-label*="Notification"], button[aria-label*="notification" i]')
    .first()
    .click();
  await page.waitForTimeout(1200);
  let bell = await page.locator("body").innerText();
  check(
    "the student reads the notice as prose, not a key",
    /Nouvelle ressource dans/.test(bell) && /Notes de cours P4/.test(bell),
    bell.slice(0, 300),
  );
  check("it names the chapter it landed in", /Cinématique/.test(bell), bell.slice(0, 300));
  check("no raw template key leaked", !/notification\.resource_published/.test(bell));
  await page.keyboard.press("Escape");

  /* ============ a scheduled publication stays quiet ============ */
  console.log("\n--- a scheduled publication does not notify early ---");
  const scheduled = (
    await sql(`insert into public.resources
                 (chapter_id, group_id, title, kind, url, role, position, is_published, published_at)
               values ('${chapter}','${group.id}','Corrigé programmé','link',
                       'https://example.test/s','solutions',1,true, now() + interval '5 days')
               returning id;`)
  )[0].id;
  const pending = await sql(`select count(*)::int c from public.notifications
                              where params->>'resourceId' = '${scheduled}';`);
  check("the notice row exists already", pending[0].c === 3, `${pending[0].c}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page
    .locator('button[aria-label*="Notification"], button[aria-label*="notification" i]')
    .first()
    .click();
  await page.waitForTimeout(1200);
  bell = await page.locator("body").innerText();
  check(
    "...but the student is not told about it yet",
    !/Corrigé programmé/.test(bell),
    bell.slice(0, 300),
  );
  await page.keyboard.press("Escape");

  /* ============ the student opens it, the teacher sees who did ============ */
  console.log("\n--- engagement panel ---");
  await page.goto(`${APP}/dashboard/my-resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.locator("text=Notes de cours P4").first().click();
  await page.waitForTimeout(2200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const studentName = (
    await sql(`select full_name from public.profiles where id='${fx.student.id}';`)
  )[0].full_name;

  await login(fx.teacher.email, fx.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page
    .locator('li:has-text("Notes de cours P4")')
    .last()
    .locator('button[aria-label="Modifier la ressource"], button[aria-label="Modifier"]')
    .first()
    .click()
    .catch(async () => {
      // The row menu is the "..." button; fall back to it by position within the row.
      await page
        .locator('li:has-text("Notes de cours P4")')
        .last()
        .locator("button")
        .last()
        .click();
    });
  await page.waitForTimeout(700);
  await page
    .locator('[role="menuitem"]', { hasText: /Consultations/ })
    .first()
    .click();
  await page.waitForTimeout(2200);

  const panel = await page.locator('[role="dialog"]').innerText();
  check(
    "the panel opens with the resource named",
    /Notes de cours P4/.test(panel),
    panel.slice(0, 200),
  );
  check(
    "it shows the three figures",
    /vues/.test(panel) && /élèves/.test(panel) && /téléch/.test(panel),
    panel.slice(0, 260),
  );
  check(
    "it lists who has NOT opened it, first",
    /n'ont pas consult/i.test(panel),
    panel.slice(0, 300),
  );
  check(
    "it names the student who did open it",
    panel.includes(studentName) && /ont consult/i.test(panel),
    panel.slice(0, 400),
  );
  const upper = panel.toUpperCase();
  const notOpenedAt = upper.indexOf("N'ONT PAS CONSULT");
  const openedAt = upper.search(/\d+ ÉLÈVE\(S\) ONT CONSULT/);
  check(
    "the actionable half comes first",
    notOpenedAt >= 0 && openedAt >= 0 && notOpenedAt < openedAt,
    `notOpened@${notOpenedAt} opened@${openedAt}`,
  );
  check("no horizontal overflow at 1440px", await noOverflow());

  for (const w of [1024, 375]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(700);
    check(`the panel has no horizontal overflow at ${w}px`, await noOverflow());
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");

  /* ============ Arabic ============ */
  console.log("\n--- Arabic ---");
  await sql(`update public.profiles set locale='ar' where id='${fx.teacher.id}';`);
  await login(fx.teacher.email, fx.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2200);
  check("the document is RTL", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
  await page.locator('li:has-text("Notes de cours P4")').last().locator("button").last().click();
  await page.waitForTimeout(700);
  const arItems = (await page.locator('[role="menuitem"]').allInnerTexts()).map((s) => s.trim());
  check(
    "the engagement entry is translated",
    arItems.some((i) => /المشاهدات/.test(i)),
    arItems.join(" | "),
  );
  await page
    .locator('[role="menuitem"]', { hasText: /المشاهدات/ })
    .first()
    .click();
  await page.waitForTimeout(2200);
  const arPanel = await page.locator('[role="dialog"]').innerText();
  check("the panel is translated", /مشاهدة|تلميذ/.test(arPanel), arPanel.slice(0, 240));
  check("no horizontal overflow in RTL at 1440px", await noOverflow());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(800);
  check("no horizontal overflow in RTL at 375px", await noOverflow());
} finally {
  await sql(`update public.profiles set locale='fr' where id='${fx.teacher.id}';`);
  await browser.close();
  await sql(
    `delete from public.notifications where params ? 'resourceId' or params ? 'chapterId';`,
  );
  await sql(`delete from public.resources where chapter_id='${chapter}';`);
  await sql(`delete from public.chapters where id='${chapter}';`);
  await fx.cleanup();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
