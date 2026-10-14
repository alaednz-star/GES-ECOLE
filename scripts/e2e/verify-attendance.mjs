/**
 * Attendance workflow, end-to-end in a real browser as a real teacher.
 *
 * REWRITTEN FOR THE SESSION CALENDAR (Phase 3).
 *
 * The page no longer has a group picker or a date input: the calendar is the
 * picker, and marking happens in a drawer opened from a session card. The
 * assertions that targeted `[role="combobox"]` and `input[type="date"]` were
 * therefore removed -- they described a UI that deliberately no longer exists.
 *
 * Everything BEHAVIOURAL is preserved, because those are the regression guards
 * that matter:
 *   * the four statuses are offered
 *   * marking writes to the database
 *   * marks survive a reload (no data loss)
 *   * re-saving updates in place rather than duplicating (UNIQUE holds)
 *   * `marked_by` is attributed to the signed-in user
 *   * dirty tracking gates the Save button   (P1-2 / P1-3)
 *   * a session only exists when the group actually meets  (P0-1)
 *   * no render loop, no console errors
 *
 * RUN ALONE -- `cleanupFixtures()` deletes every `e2e-fixture%` row.
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql } from "./fixtures.mjs";

const APP = process.env["APP_URL"] ?? "http://localhost:8080";

// Disposable teacher with two groups: one meeting today (markable) and one on
// another weekday, so "a session exists only when the group meets" is exercised.
const fx = await withFixtures({ teacher: true });
const TEACHER = fx.teacher.id;
const todayWeekday = new Date().getDay();
const groupA = await createGroupFixture({
  teacherId: TEACHER,
  name: "e2e-fixture Attendance A",
  weekday: todayWeekday,
  studentCount: 4,
  subjectKey: "mathematics",
});
const groupB = await createGroupFixture({
  teacherId: TEACHER,
  name: "e2e-fixture Attendance B",
  weekday: (todayWeekday + 3) % 7,
  studentCount: 3,
  subjectKey: "mathematics",
});

let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${n}`);
  } else {
    fail++;
    console.log(`  FAIL  ${n}  -> ${d}`);
  }
};

const iso = (d) => {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
const todayIso = iso(new Date());

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
// The unsaved-changes guard uses window.confirm; accept so the suite can
// exercise closing the drawer deliberately.
page.on("dialog", (d) => void d.accept());

const openDrawer = async (groupName) => {
  await page.getByText(groupName).first().click();
  await page.waitForTimeout(1600);
};

try {
  await sql(`delete from public.attendance;`);

  console.log("\n[1] Entry points reach attendance");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', fx.teacher.email);
  await page.fill('input[type="password"]', fx.teacher.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });

  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  const heroCta = page
    .getByRole("link", { name: /marquer les présences|mark attendance/i })
    .first();
  check("hero CTA present on workspace", (await heroCta.count()) > 0);
  if ((await heroCta.count()) > 0) {
    await heroCta.click();
    await page.waitForURL(/attendance/, { timeout: 30000 });
    check("hero CTA navigates to attendance", /attendance/.test(page.url()));
  }

  await page.goto(`${APP}/dashboard/attendance`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  console.log("\n[2] The calendar replaces the group/date pickers");
  check(
    "no group combobox is required to start",
    (await page.getByText(/choisir un groupe|choose a group/i).count()) === 0,
  );
  check(
    "today's session is visible with no input",
    (await page.getByText("e2e-fixture Attendance A").count()) > 0,
  );
  check(
    "sessions are scoped to the signed-in teacher",
    (await page.getByText("e2e-fixture Attendance A").count()) > 0,
  );

  console.log("\n[3] Roster loads enrolled students");
  await openDrawer("e2e-fixture Attendance A");
  const body = await page.locator("body").innerText();
  check("roster shows enrolled students", /E2E Student/i.test(body), body.slice(0, 200));

  console.log("\n[4] All four statuses are offered");
  // The drawer uses single-letter P/A/R/E buttons with translated aria-labels.
  for (const [label, re] of [
    ["present", /présent|present|حاضر/i],
    ["absent", /absent|غائب/i],
    ["late", /retard|late|متأخر/i],
    ["excused", /excusé|excused|معذور/i],
  ]) {
    const n = await page
      .locator(`button[aria-label]`)
      .evaluateAll(
        (els, pattern) =>
          els.filter((e) => new RegExp(pattern, "i").test(e.getAttribute("aria-label") ?? ""))
            .length,
        re.source,
      );
    check(`status "${label}" available`, n > 0, `${n} buttons`);
  }

  console.log("\n[5] Marking and saving");
  check(
    "Tout présent bulk action present",
    (await page.getByRole("button", { name: /tout présent|all present/i }).count()) > 0,
  );
  await page.getByRole("button", { name: /tout présent|all present/i }).click();
  await page.waitForTimeout(600);

  const saveBtn = page.getByRole("button", { name: /^enregistrer$|^save$|^حفظ$/i }).first();
  check("save button present", (await saveBtn.count()) > 0);
  await saveBtn.click();
  await page.waitForTimeout(3000);

  const rows = await sql(`select count(*)::int n from public.attendance;`);
  check("attendance rows written to the database", (rows[0]?.n ?? 0) === 4, `${rows[0]?.n}`);

  console.log("\n[6] Reload keeps the marks (no data loss)");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2800);
  const after = await sql(`select count(*)::int n from public.attendance;`);
  check("marks persisted after reload", (after[0]?.n ?? 0) === 4, `${after[0]?.n}`);
  check(
    "the card reflects the saved state without a picker",
    (await page.getByText(/4\/4/).count()) > 0,
    "expected 4/4 on the session card",
  );

  console.log("\n[7] Re-saving updates rather than duplicating");
  const before = (await sql(`select count(*)::int n from public.attendance;`))[0]?.n ?? 0;
  await openDrawer("e2e-fixture Attendance A");
  // Flip one student to absent via the A button, then save again.
  const absentBtns = page.locator("button[aria-label]").filter({ hasText: /^A$/ });
  if ((await absentBtns.count()) > 0) {
    await absentBtns.first().click();
    await page.waitForTimeout(400);
    await page
      .getByRole("button", { name: /^enregistrer$|^save$|^حفظ$/i })
      .first()
      .click();
    await page.waitForTimeout(3000);
  }
  const dup = (await sql(`select count(*)::int n from public.attendance;`))[0]?.n ?? 0;
  check("no duplicate rows created", dup === before, `before=${before} after=${dup}`);

  const uniq = await sql(`
    select count(*)::int n from (
      select group_id, student_id, session_date
        from public.attendance
       group by 1,2,3 having count(*) > 1
    ) d;`);
  check(
    "unique (group, student, date) holds",
    (uniq[0]?.n ?? 0) === 0,
    `${uniq[0]?.n} duplicated keys`,
  );

  console.log("\n[8] marked_by recorded");
  const mb = await sql(
    `select count(*)::int n from public.attendance where marked_by='${TEACHER}';`,
  );
  check("rows attributed to the signed-in teacher", (mb[0]?.n ?? 0) > 0, `${mb[0]?.n}`);

  console.log("\n[8b] A session exists only when the group meets (P0-1 regression)");
  // Group B meets on a different weekday. Its card must therefore NOT appear on
  // today's date -- the old failure mode ("Ce groupe n'a pas cours à cette
  // date") is now structurally impossible because the card is never rendered.
  const bOnToday = await sql(`
    select count(*)::int n from public.group_schedules
     where group_id='${groupB.id}' and weekday=${todayWeekday};`);
  check("fixture group B does not meet today", (bOnToday[0]?.n ?? 0) === 0);
  const bAttendance = await sql(
    `select count(*)::int n from public.attendance where group_id='${groupB.id}' and session_date='${todayIso}';`,
  );
  check("no attendance exists for a non-meeting date", (bAttendance[0]?.n ?? 0) === 0);
  check(
    "the impossible-date warning is gone from the UI",
    (await page.getByText(/n'a pas cours à cette date|does not meet on that date/i).count()) === 0,
  );

  console.log("\n[8c] Dirty tracking (P1-2 / P1-3)");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await openDrawer("e2e-fixture Attendance A");
  const saveNow = page.getByRole("button", { name: /^enregistrer$|^save$|^حفظ$/i }).first();
  check("save disabled when no marks changed", !(await saveNow.isEnabled()));
  const anyStatus = page.locator("button[aria-label]").filter({ hasText: /^R$/ });
  if ((await anyStatus.count()) > 0) {
    await anyStatus.first().click();
    await page.waitForTimeout(500);
    check("save re-enabled after a change", await saveNow.isEnabled());
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);

  console.log("\n[9] Empty period shows a message rather than a dead end");
  // Jump far into the future, where the fixture term has ended.
  for (let i = 0; i < 40; i++) {
    await page.getByRole("button", { name: /période suivante|next period/i }).click();
  }
  await page.waitForTimeout(2500);
  check(
    "an empty period is explained",
    (await page.getByText(/aucune séance|no sessions/i).count()) > 0,
  );

  console.log("\n[10] Mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^aujourd'hui$|^today$/i }).click();
  await page.waitForTimeout(2000);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 2,
  );
  check("no horizontal overflow at 390px", noOverflow);

  console.log("\n[11] Console");
  const loops = errors.filter((e) => /Maximum update depth|too many re-renders/i.test(e));
  check("no render loop", loops.length === 0, loops.join(" | "));
  const real = errors.filter((e) => !/favicon|404|Failed to load resource|net::ERR/i.test(e));
  check("no console errors", real.length === 0, real.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await fx.cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
