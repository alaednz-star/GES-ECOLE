/**
 * Touch targets on the Resources pages, MEASURED at 375px.
 *
 * The tracker asked for measurement rather than assertion, and it is right to: every
 * control here looks tappable in a screenshot, and `size-8` (32px) is a perfectly
 * ordinary Tailwind class that produces a target below the 44px both Apple and the
 * WCAG 2.5.5 guidance ask for. Only geometry can tell you which ones.
 *
 * Reports every visible interactive element smaller than the threshold in either
 * direction, on the teacher page and the student page, in French and Arabic.
 *
 * This is a REPORT rather than a pass/fail gate on its own: a 32px icon button with
 * generous padding around it is not the same failure as two 24px controls touching.
 * The exit code fails only on targets below 32px, which nothing can excuse.
 *
 *   node scripts/e2e/verify-resources-touch-targets.mjs
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql } from "./fixtures.mjs";

const APP = process.env["APP_URL"] ?? "http://localhost:8080";
/** The guidance figure. */
const TARGET = 44;
/** Below this there is no defensible reading; it fails the run. */
const FLOOR = 32;

const fx = await withFixtures({ teacher: true, student: true });
const group = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture TT Physique",
  subjectKey: "physics",
  studentCount: 0,
});
const chapter = (
  await sql(`insert into public.chapters (group_id, title, position, is_published)
             values ('${group.id}','e2e TT Chapitre',1,true) returning id;`)
)[0].id;
for (const [i, [role, title]] of [
  ["notes", "e2e TT Notes"],
  ["exercises", "e2e TT Exercices"],
].entries()) {
  await sql(`insert into public.resources
               (chapter_id, group_id, title, kind, url, role, position, is_published, created_by)
             values ('${chapter}','${group.id}','${title}','link',
                     'https://example.test/${role}','${role}',${i}, true, '${fx.teacher.id}');`);
}
await sql(`update public.students set gender=coalesce(gender,'male'),
             date_of_birth=coalesce(date_of_birth,'2008-05-14'),
             guardian_name=coalesce(guardian_name,'Parent'),
             guardian_phone=coalesce(guardian_phone,'0661000000'),
             level_id=(select level_id from public.groups where id='${group.id}'),
             stream_id=(select stream_id from public.groups where id='${group.id}'),
             onboarded_at=now() where id='${fx.student.id}';`);
await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
           values ('${fx.student.id}','${group.id}','approved',now())
           on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
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

/** Every visible interactive element, with its rendered box. */
const measure = () =>
  page.evaluate(() => {
    const sel = 'button, a[href], [role="button"], [role="checkbox"], input:not([type="hidden"])';
    return [...document.querySelectorAll(sel)]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          visible:
            r.width > 0 &&
            r.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            style.opacity !== "0",
          label:
            el.getAttribute("aria-label") ||
            el.textContent?.trim().slice(0, 40) ||
            el.getAttribute("name") ||
            el.tagName.toLowerCase(),
        };
      })
      .filter((m) => m.visible);
  });

/**
 * Controls that belong to the shared app shell rather than to Resources.
 *
 * The sidebar toggle measures 28x28 on every page of the product. That is a real
 * failure and it is REPORTED below, not ignored -- but it lives in
 * `src/components/layout/`, it is not a Resources dependency, and changing shared
 * layout geometry would move every other suite's measurements. It is the user's call.
 */
const SHARED_SHELL = [/afficher ou masquer/i, /toggle sidebar/i, /القائمة/];
const isShared = (label) => SHARED_SHELL.some((re) => re.test(label));

const report = [];
const sharedOffenders = [];
let worst = 999;

const audit = async (name) => {
  const all = await measure();
  const boxes = all.filter((b) => !isShared(b.label));
  for (const b of all.filter((x) => isShared(x.label))) {
    if (b.w < FLOOR || b.h < FLOOR) sharedOffenders.push(b);
  }
  const small = boxes.filter((b) => b.w < TARGET || b.h < TARGET);
  const tiny = boxes.filter((b) => b.w < FLOOR || b.h < FLOOR);
  for (const b of boxes) worst = Math.min(worst, Math.min(b.w, b.h));
  report.push({ page: name, total: boxes.length, small: small.length, tiny: tiny.length });
  console.log(
    `\n${name}: ${boxes.length} controls, ${small.length} under ${TARGET}px, ${tiny.length} under ${FLOOR}px`,
  );
  // Group identical sizes so the output is a list of problems, not of elements.
  const grouped = new Map();
  for (const b of small) {
    const k = `${b.w}x${b.h}`;
    grouped.set(k, [...(grouped.get(k) ?? []), b.label]);
  }
  for (const [size, labels] of [...grouped.entries()].sort()) {
    console.log(
      `  ${size.padEnd(8)} x${labels.length}  ${[...new Set(labels)].slice(0, 4).join(", ")}`,
    );
  }
  return tiny;
};

try {
  const tiny = [];

  await login(fx.teacher.email, fx.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  tiny.push(...(await audit("teacher / Chapitres / fr")));

  await page
    .locator("button", { hasText: /^Liste$/ })
    .first()
    .click();
  await page.waitForTimeout(1400);
  tiny.push(...(await audit("teacher / Liste / fr")));

  await login(fx.student.email, fx.student.password);
  await page.goto(`${APP}/dashboard/my-resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  tiny.push(...(await audit("student / fr")));

  await sql(`update public.profiles set locale='ar' where id='${fx.student.id}';`);
  await login(fx.student.email, fx.student.password);
  await page.goto(`${APP}/dashboard/my-resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  tiny.push(...(await audit("student / ar")));

  console.log(`\nsmallest dimension anywhere: ${worst}px`);
  if (tiny.length > 0) {
    console.log(`\n${tiny.length} control(s) below the ${FLOOR}px floor:`);
    for (const b of tiny) console.log(`  ${b.w}x${b.h}  ${b.label}`);
    process.exitCode = 1;
  } else {
    console.log(`
OK: no Resources control below the ${FLOOR}px floor.`);
  }
  if (sharedOffenders.length > 0) {
    const px = Math.min(...sharedOffenders.map((b) => Math.min(b.w, b.h)));
    const labels = [...new Set(sharedOffenders.map((b) => b.label))];
    console.log(
      `
OUT OF SCOPE, reported not ignored: shared app-shell control at ${px}px --` +
        ` ${labels.join(", ")}.` +
        `
  Lives in src/components/layout/, affects every page of the product, and is` +
        ` not a Resources dependency, so it is surfaced rather than changed here.`,
    );
  }
} finally {
  await sql(`update public.profiles set locale='fr' where id='${fx.student.id}';`);
  await browser.close();
  await sql(`delete from public.resources where chapter_id='${chapter}';`);
  await sql(`delete from public.chapters where id='${chapter}';`);
  await fx.cleanup();
}
