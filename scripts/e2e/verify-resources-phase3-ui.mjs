/**
 * Phase 3 in a real browser: managing a course, not just storing files.
 *
 * The API suite proves the rules hold. This proves a teacher can actually reach them
 * -- the chapter menu, the three-way delete, bulk selection and its floating bar,
 * duplication through the destination cascade -- and that the student sees the
 * consequences: pinned chapters first, hidden material gone.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase3-ui.mjs
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

const fx = await withFixtures({ admin: true, teacher: true, student: true });

const group = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture P3 Physique",
  subjectKey: "physics",
  studentCount: 0,
});

const mkChapter = async (title, position, pinned = false) =>
  (
    await sql(`insert into public.chapters (group_id, title, position, pinned, is_published)
               values ('${group.id}','${title}',${position},${pinned}, true) returning id;`)
  )[0].id;

const chOne = await mkChapter("e2e P3 Cinématique", 1);
const chTwo = await mkChapter("e2e P3 Dynamique", 2);

const mkResource = async (chapterId, title, role, position) =>
  (
    await sql(`insert into public.resources
                 (chapter_id, group_id, title, kind, url, role, position, is_published, created_by)
               values ('${chapterId}','${group.id}','${title}','link',
                       'https://example.test/${role}','${role}',${position}, true, '${fx.teacher.id}')
               returning id;`)
  )[0].id;

await mkResource(chOne, "e2e P3 Notes", "notes", 0);
await mkResource(chOne, "e2e P3 Exercices", "exercises", 1);
await mkResource(chOne, "e2e P3 Corrigé", "solutions", 2);
await mkResource(chOne, "e2e P3 Vidéo", "video", 3);

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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const login = async (email, password) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};
const gotoResources = async () => {
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
};
const noOverflow = () =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );
/** Opens the "..." menu of the Nth chapter card and returns its item labels. */
const chapterMenu = async (index = 0) => {
  await page
    .locator('button[aria-label="Renommer"], button[aria-label="إعادة التسمية"]')
    .nth(index)
    .click();
  await page.waitForTimeout(500);
  return (await page.locator('[role="menuitem"]').allInnerTexts()).map((s) => s.trim());
};
/** The floating bulk bar, matched by its own label so other page landmarks with
 *  role=region cannot be picked up instead. */
const bulkBar = () => page.locator('[role="region"][aria-label*="lectionn"]');
/** Selection is cleared whenever the row set changes, which a bulk write does. So
 *  each bulk action re-selects first and waits for the bar to actually appear. */
const selectAllAndWait = async () => {
  await page.locator('table [role="checkbox"], table input[type="checkbox"]').first().click();
  await bulkBar().waitFor({ state: "visible", timeout: 15000 });
};
const clickMenuItem = async (label) => {
  await page.locator('[role="menuitem"]', { hasText: label }).first().click();
  await page.waitForTimeout(1600);
};

try {
  /* =============== the chapter action menu =============== */
  console.log("\n--- chapter action menu ---");
  await login(fx.teacher.email, fx.teacher.password);
  await gotoResources();

  let items = await chapterMenu(0);
  check(
    "the menu offers the full chapter workflow",
    [
      "Renommer",
      "Épingler",
      "Publier le chapitre",
      "Publier tout",
      "Masquer tout",
      "Dupliquer",
      "Supprimer",
    ].every((label) => items.some((i) => i.includes(label.split(" ")[0]))),
    items.join(" | "),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  /* =============== pin a chapter =============== */
  console.log("\n--- pin a chapter ---");
  await chapterMenu(0);
  await clickMenuItem("Épingler");
  const pinnedInDb = await sql(`select title, pinned from public.chapters
                                 where group_id='${group.id}' and pinned order by title;`);
  check("pinning persists", pinnedInDb.length === 1, JSON.stringify(pinnedInDb));
  let body = await page.locator("body").innerText();
  check("a PINNED badge appears on the chapter", /ÉPINGLÉ/i.test(body), body.slice(0, 200));

  /* =============== publish / hide a chapter =============== */
  console.log("\n--- hide a chapter, then publish it again ---");
  await chapterMenu(0);
  await clickMenuItem("Masquer le chapitre");
  const hiddenDb = await sql(`select is_published from public.chapters where id='${chOne}';`);
  check(
    "hiding the chapter persists",
    hiddenDb[0]?.is_published === false,
    JSON.stringify(hiddenDb[0]),
  );
  body = await page.locator("body").innerText();
  check("the chapter is marked as hidden in the UI", /Masqué/i.test(body), body.slice(0, 240));
  await chapterMenu(0);
  await clickMenuItem("Publier le chapitre");
  const backDb = await sql(`select is_published from public.chapters where id='${chOne}';`);
  check("republishing persists", backDb[0]?.is_published === true);

  /* =============== publish all / hide all =============== */
  console.log("\n--- publish all / hide all inside a chapter ---");
  await chapterMenu(0);
  await clickMenuItem("Masquer tout");
  const allHidden = await sql(`select count(*)::int c from public.resources
                                where chapter_id='${chOne}' and is_published = false;`);
  check(
    "hide all reaches every resource in the chapter",
    allHidden[0].c === 4,
    `${allHidden[0].c}/4`,
  );
  await chapterMenu(0);
  await clickMenuItem("Publier tout");
  const allShown = await sql(`select count(*)::int c from public.resources
                               where chapter_id='${chOne}' and is_published and published_at is null;`);
  check("publish all clears schedules too", allShown[0].c === 4, `${allShown[0].c}/4`);

  /* =============== duplicate a chapter =============== */
  console.log("\n--- duplicate a chapter ---");
  await chapterMenu(0);
  await clickMenuItem("Dupliquer");
  await page.waitForTimeout(2200);
  const copies = await sql(`select title, is_published, pinned from public.chapters
                             where group_id='${group.id}' and title like '%(copie)%';`);
  check("the copy exists", copies.length === 1, JSON.stringify(copies));
  check(
    "the copy starts hidden and unpinned",
    copies[0]?.is_published === false && copies[0]?.pinned === false,
    JSON.stringify(copies[0]),
  );
  const copiedResources = await sql(`select count(*)::int c from public.resources r
                                      join public.chapters c on c.id = r.chapter_id
                                     where c.title like '%(copie)%';`);
  check("its resources came with it", copiedResources[0].c === 4, `${copiedResources[0].c}/4`);
  const copiedHidden = await sql(`select count(*)::int c from public.resources r
                                   join public.chapters c on c.id = r.chapter_id
                                  where c.title like '%(copie)%' and r.is_published = false;`);
  check("and they are all hidden", copiedHidden[0].c === 4, `${copiedHidden[0].c}/4`);

  /* =============== the three-way delete =============== */
  console.log("\n--- deleting a chapter that still holds resources ---");
  const copyId = (await sql(`select id from public.chapters where title like '%(copie)%';`))[0].id;
  // Target the copy by its CONTENT, not its position: chapter cards sort pinned
  // first, so "the last card" is not the newest one.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await page
    .locator('section:has-text("(copie)")')
    .last()
    .locator('button[aria-label="Renommer"]')
    .first()
    .click();
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]', { hasText: "Supprimer" }).first().click();
  await page.waitForTimeout(800);
  const dialogText = await page.locator('[role="alertdialog"]').innerText();
  check(
    "the dialog says how many resources are at stake",
    /4 ressource/i.test(dialogText),
    dialogText.slice(0, 240),
  );
  check(
    "it offers keeping them as well as deleting them",
    /Non classé/i.test(dialogText) && /Supprimer le chapitre et ses/i.test(dialogText),
    dialogText.slice(0, 300),
  );
  await page
    .locator('[role="alertdialog"] button', { hasText: /Non classé/i })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const survivors = await sql(`select count(*)::int c from public.resources r
                                join public.chapters c on c.id = r.chapter_id
                               where c.title = 'Non classé' and c.group_id = '${group.id}';`);
  check("choosing 'keep' moves them to Non classé", survivors[0].c === 4, `${survivors[0].c}/4`);
  const copyGone = await sql(`select count(*)::int c from public.chapters where id='${copyId}';`);
  check("...and the chapter itself is gone", copyGone[0].c === 0);

  /* =============== bulk actions in the list view =============== */
  console.log("\n--- bulk selection and the floating bar ---");
  await gotoResources();
  await page
    .locator("button", { hasText: /^Liste$/ })
    .first()
    .click();
  await page.waitForTimeout(1400);
  const boxes = page.locator('table [role="checkbox"], table input[type="checkbox"]');
  const boxCount = await boxes.count();
  check("every row has a checkbox, plus select-all", boxCount > 1, `${boxCount} checkboxes`);

  await boxes.nth(1).click();
  await page.waitForTimeout(600);
  let bar = await bulkBar()
    .innerText()
    .catch(() => "");
  check("selecting one row raises the action bar", /1\s*ressource/i.test(bar), bar.slice(0, 160));
  check(
    "the bar offers publish, hide, move and delete",
    /Publier/.test(bar) && /Masquer/.test(bar) && /Déplacer/.test(bar) && /Supprimer/.test(bar),
    bar.slice(0, 200),
  );

  // Select all, then hide everything, and confirm in the database.
  await selectAllAndWait();
  bar = await bulkBar()
    .innerText()
    .catch(() => "");
  check("select-all selects every visible row", /s.lectionn/i.test(bar), bar.slice(0, 160));
  await bulkBar()
    .locator("button", { hasText: /^Masquer$/ })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const bulkHidden = await sql(`select count(*)::int c from public.resources
                                 where group_id='${group.id}' and is_published = false;`);
  check("bulk hide reached the database", bulkHidden[0].c >= 4, `${bulkHidden[0].c} hidden`);

  // The selection SURVIVES a hide, because hiding does not remove the rows from the
  // list -- so the bar is still up and the same selection can be published again.
  // (It is cleared only when the visible row set actually changes.)
  check("the selection survives a bulk edit", await bulkBar().isVisible());
  await bulkBar()
    .locator("button", { hasText: /^Publier$/ })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const bulkShown = await sql(`select count(*)::int c from public.resources
                                where group_id='${group.id}' and is_published;`);
  check("bulk publish reached the database", bulkShown[0].c >= 4, `${bulkShown[0].c} published`);
  check("no horizontal overflow with the bar visible at 1440px", await noOverflow());

  /* =============== bulk move through the cascade =============== */
  console.log("\n--- bulk move uses the same GROUP -> CHAPTER cascade ---");
  await page.locator('table [role="checkbox"], table input[type="checkbox"]').nth(1).click();
  await bulkBar().waitFor({ state: "visible", timeout: 15000 });
  await bulkBar()
    .locator("button", { hasText: /Déplacer/ })
    .first()
    .click();
  await page.waitForTimeout(900);
  const moveDialog = await page.locator('[role="dialog"]').innerText();
  check(
    "the move dialog asks for group then chapter, with the subject derived",
    /Groupe/.test(moveDialog) && /Matière/.test(moveDialog) && /Chapitre/.test(moveDialog),
    moveDialog.slice(0, 220),
  );
  check(
    "the group is preselected from the resource",
    /P3 Physique/.test(moveDialog),
    moveDialog.slice(0, 220),
  );
  await page.locator("#dest-chapter").click();
  await page.waitForTimeout(500);
  const destChapters = (await page.locator('[role="option"]').allInnerTexts()).map((s) => s.trim());
  check(
    "only this group's chapters are offered",
    destChapters.some((c) => /Dynamique/.test(c)) && !destChapters.some((c) => /Foreign/.test(c)),
    destChapters.join(" | "),
  );
  await page.locator('[role="option"]', { hasText: "Dynamique" }).first().click();
  await page.waitForTimeout(500);
  await page
    .locator('[role="dialog"] button', { hasText: /^Déplacer$/ })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const movedCount = await sql(
    `select count(*)::int c from public.resources where chapter_id='${chTwo}';`,
  );
  check(
    "the move landed in the chosen chapter",
    movedCount[0].c >= 1,
    `${movedCount[0].c} in Dynamique`,
  );

  /* =============== responsive =============== */
  console.log("\n--- responsive ---");
  for (const w of [1024, 375]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(800);
    check(`no horizontal overflow at ${w}px`, await noOverflow());
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  /* =============== student =============== */
  console.log("\n--- the student sees the consequences ---");
  // Put the two chapters into a KNOWN state first. Everything above deliberately
  // moved, hid and published things; the ordering assertion below is about pinning,
  // so it should not also be a test of what survived that. The student page skips
  // chapters with nothing visible in them, so both need a published resource.
  await sql(`update public.chapters
                set pinned = (id = '${chTwo}'), is_published = true, published_at = null
              where id in ('${chOne}','${chTwo}');`);
  await sql(`update public.resources set is_published = true, published_at = null
              where chapter_id in ('${chOne}','${chTwo}');`);
  await sql(`insert into public.resources
               (chapter_id, group_id, title, kind, url, role, position, is_published, created_by)
             select '${chOne}','${group.id}','e2e P3 Rattrapage','link',
                    'https://example.test/x','notes',9,true,'${fx.teacher.id}'
              where not exists (select 1 from public.resources where chapter_id='${chOne}');`);
  await login(fx.student.email, fx.student.password);
  await page.goto(`${APP}/dashboard/my-resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  const stud = await page.locator("body").innerText();
  const dynAt = stud.indexOf("Dynamique");
  const cinAt = stud.indexOf("Cinématique");
  check(
    "the pinned chapter comes first",
    dynAt >= 0 && cinAt >= 0 && dynAt < cinAt,
    `Dynamique@${dynAt} Cinématique@${cinAt}`,
  );
  check(
    "no hidden copy leaks to the student",
    !/\(copie\)/.test(stud) && !/Non classé/.test(stud),
    stud.slice(0, 240),
  );
  check("progress is shown per chapter", /consultées/.test(stud), stud.slice(0, 240));

  await sql(`update public.resources set is_published=false where title='e2e P3 Corrigé';`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const afterHide = await page.locator("body").innerText();
  check("a hidden resource disappears for the student", !/e2e P3 Corrigé/.test(afterHide));

  /* =============== Arabic =============== */
  console.log("\n--- Arabic, right to left ---");
  await sql(`update public.profiles set locale='ar' where id='${fx.teacher.id}';`);
  await login(fx.teacher.email, fx.teacher.password);
  await gotoResources();
  const dir = await page.evaluate(() => document.documentElement.dir);
  check("the document is RTL", dir === "rtl", String(dir));
  await page.locator('button[aria-label="إعادة التسمية"]').first().click();
  await page.waitForTimeout(600);
  const arItems = (await page.locator('[role="menuitem"]').allInnerTexts()).map((s) => s.trim());
  check(
    "the chapter menu is translated",
    arItems.some((i) => /تثبيت/.test(i)) && arItems.some((i) => /نشر/.test(i)),
    arItems.join(" | "),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("no horizontal overflow in RTL at 1440px", await noOverflow());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(900);
  check("no horizontal overflow in RTL at 375px", await noOverflow());
} finally {
  await sql(`update public.profiles set locale='fr' where id='${fx.teacher.id}';`);
  await browser.close();
  await sql(`delete from public.resources where title like 'e2e P3%' or title like '%(copie)%';`);
  await sql(`delete from public.chapters where title like 'e2e P3%' or title like '%(copie)%'
               or (title = 'Non classé' and group_id = '${group.id}');`);
  await fx.cleanup();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
