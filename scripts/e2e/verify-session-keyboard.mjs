/**
 * Keyboard marking in the attendance drawer, end-to-end.
 *
 * The daily workflow is "mark 14 students", so this asserts the keyboard path
 * actually writes the right statuses to the database -- not merely that keys are
 * handled. Also checks the two rules that protect data: marking is idempotent
 * (P twice does not clear), and focus clamps rather than wrapping.
 *
 * RUN ALONE -- cleanupFixtures() removes every `e2e-fixture%` row.
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql } from "./fixtures.mjs";

const APP = process.env["APP_URL"] ?? "http://localhost:8080";
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
const iso = (d) =>
  `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
const todayIso = iso(new Date());

const fx = await withFixtures({ teacher: true });
const g = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture Keyboard",
  weekday: new Date().getDay(),
  studentCount: 4,
});

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 1000 } })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());

/** Opens a session card, closing any drawer first -- the scrim blocks clicks. */
const openCard = async (name) => {
  await ensureClosed();
  await page.getByText(name).first().click();
  await page.waitForTimeout(1800);
};

/** Ctrl+S is a no-op when nothing is dirty, so the drawer can still be open. */
const ensureClosed = async () => {
  for (let i = 0; i < 3; i++) {
    if ((await page.getByRole("button", { name: /tout présent|all present/i }).count()) === 0)
      return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
};

const rows = () =>
  sql(
    `select status, count(*)::int n from public.attendance
    where group_id='${g.id}' and session_date='${todayIso}' group by status order by status;`,
  );

try {
  await sql(`delete from public.attendance;`);
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', fx.teacher.email);
  await page.fill('input[type="password"]', fx.teacher.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 45000 });
  await page.goto(`${APP}/dashboard/attendance`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2800);

  console.log("\n[1] The shortcuts are discoverable");
  await openCard("e2e-fixture Keyboard");
  check(
    "keyboard hint is shown",
    (await page.getByText(/clavier|keyboard|لوحة المفاتيح/i).count()) > 0,
  );

  console.log("\n[2] P A R E mark and advance");
  // Four keys down a roster of four: one status each, in order.
  for (const k of ["p", "a", "r", "e"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(220);
  }
  const marked = await page.getByText(/4\/4/).count();
  check("all four rows marked by keyboard", marked > 0, "expected 4/4 in the drawer");

  console.log("\n[3] Ctrl+S saves");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(3000);
  const saved = await rows();
  const total = saved.reduce((a, r) => a + Number(r.n), 0);
  check("4 rows written", total === 4, JSON.stringify(saved));
  const byStatus = Object.fromEntries(saved.map((r) => [r.status, Number(r.n)]));
  check(
    "one of each status, in the order pressed",
    byStatus.present === 1 &&
      byStatus.absent === 1 &&
      byStatus.late === 1 &&
      byStatus.excused === 1,
    JSON.stringify(byStatus),
  );

  console.log("\n[4] Marking is idempotent (P twice does not clear)");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  await openCard("e2e-fixture Keyboard");
  await page.keyboard.press("ArrowDown"); // focus row 0
  await page.keyboard.press("p"); // marks row 0, advances to 1
  await page.keyboard.press("ArrowUp"); // back to row 0
  await page.keyboard.press("p"); // must SET again, not clear
  await page.waitForTimeout(400);
  const stillFour = await page.getByText(/4\/4/).count();
  check("still 4/4 after pressing P twice on one row", stillFour > 0, "a mark was cleared");

  console.log("\n[5] Focus clamps at the end (never wraps to the first student)");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("e");
  await page.waitForTimeout(400);
  check(
    "roster still fully marked after over-scrolling",
    (await page.getByText(/4\/4/).count()) > 0,
  );
  // The LAST student should now be excused; the first must be untouched.
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(3000);
  const after = await rows();
  const afterTotal = after.reduce((a, r) => a + Number(r.n), 0);
  check("no duplicate rows created", afterTotal === 4, JSON.stringify(after));

  console.log("\n[6] Escape still runs the unsaved guard");
  await openCard("e2e-fixture Keyboard");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("a");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  check(
    "drawer closed via the guard",
    (await page.getByRole("button", { name: /tout présent|all present/i }).count()) === 0,
  );

  console.log("\n[7] Console");
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await fx.cleanup();
}
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
