/**
 * Deep links into the attendance calendar, end-to-end.
 *
 * Six workspace entry points link here and several name a SPECIFIC session. This
 * asserts the link actually lands on it -- URL params open the right week, in the
 * right view, with the right drawer already open -- and that a broken link still
 * yields a usable calendar rather than an error page.
 *
 * RUN ALONE -- cleanupFixtures() removes every `e2e-fixture%` row.
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql } from "./fixtures.mjs";
import { sessionKey } from "../../src/features/school/session/session-key.ts";

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

const iso = (d) => {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
const shift = (n) => iso(new Date(Date.now() + n * 86_400_000));

const fx = await withFixtures({ admin: true, teacher: true });
const weekday = new Date().getDay();
const todayIso = iso(new Date());

const gTarget = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture DeepLink Target",
  weekday,
  studentCount: 4,
});
await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture DeepLink Other",
  weekday,
  studentCount: 3,
});

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 1000 } })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());

const login = async (email) => {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', fx.teacher.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 45000 });
};

const drawerOpen = async () =>
  (await page.getByRole("button", { name: /tout présent|all present/i }).count()) > 0;

const closeDrawer = async () => {
  if (await drawerOpen()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
  }
};

try {
  await sql(`delete from public.attendance;`);
  await login(fx.teacher.email);

  console.log("\n[1] ?session= opens that session's drawer on arrival");
  const key = sessionKey(gTarget.id, todayIso);
  await page.goto(
    `${APP}/dashboard/attendance?date=${todayIso}&session=${encodeURIComponent(key)}`,
    { waitUntil: "networkidle", timeout: 60000 },
  );
  await page.waitForTimeout(3200);
  check("drawer opened without a click", await drawerOpen());
  check(
    "it is the RIGHT session",
    (await page.getByText("e2e-fixture DeepLink Target").count()) > 0,
    "target group not shown in drawer",
  );

  console.log("\n[2] Closing the deep-linked drawer keeps it closed");
  await closeDrawer();
  check("drawer stays closed (target consumed once)", !(await drawerOpen()));
  await page.waitForTimeout(1200);
  check("still closed after a re-render", !(await drawerOpen()));

  console.log("\n[3] ?date= opens the week containing that date");
  const pastWeek = shift(-14);
  await page.goto(`${APP}/dashboard/attendance?date=${pastWeek}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2600);
  const label = await page.locator('[data-testid="period-label"]').first().textContent();
  // Compare against TODAY's label rather than pattern-matching the range: the
  // wording varies by locale and by whether the week straddles two months
  // ("27 juil. – 2 août 2026"), so a regex on the shape tests the formatter, not
  // the behaviour. What matters is that the linked week is NOT the current one.
  const todayLabel = await (async () => {
    await page.goto(`${APP}/dashboard/attendance`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2200);
    return page.locator('[data-testid="period-label"]').first().textContent();
  })();
  check(
    "period label reflects the linked week, not today",
    !!label && label !== todayLabel,
    `linked="${label}" today="${todayLabel}"`,
  );
  await page.goto(`${APP}/dashboard/attendance?date=${pastWeek}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2400);
  const targetVisible = await page.getByText("e2e-fixture DeepLink Target").count();
  check("sessions from the linked week are rendered", targetVisible > 0, `${targetVisible} cards`);
  check("no drawer opens without ?session=", !(await drawerOpen()));

  console.log("\n[4] ?view=month arrives in month view");
  await page.goto(`${APP}/dashboard/attendance?view=month`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2600);
  const monthPressed = await page
    .getByRole("button", { name: /^mois$|^month$/i })
    .getAttribute("aria-pressed");
  check("month segment is active", monthPressed === "true", `aria-pressed=${monthPressed}`);

  console.log("\n[5] ?toMark=true arrives with the filter applied");
  await page.goto(`${APP}/dashboard/attendance?toMark=true`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2600);
  const filterPressed = await page
    .getByRole("button", { name: /à pointer seulement|to mark only/i })
    .getAttribute("aria-pressed");
  check("to-mark filter is active", filterPressed === "true", `aria-pressed=${filterPressed}`);

  console.log("\n[6] Malformed params degrade to a working calendar");
  for (const q of [
    "date=not-a-date",
    "date=2026-02-31",
    "session=garbage",
    "session=",
    "view=decade",
    "toMark=maybe",
    "date=2026-13-99&session=|&view=x",
  ]) {
    await page.goto(`${APP}/dashboard/attendance?${q}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    const heading = await page.getByRole("heading", { level: 1 }).count();
    const errored = await page.getByText(/impossible de charger|something went wrong/i).count();
    check(
      `"${q}" still renders the calendar`,
      heading > 0 && errored === 0,
      `h1=${heading} err=${errored}`,
    );
  }

  console.log("\n[7] A link to a session that no longer exists does not hang");
  const ghost = sessionKey("00000000-0000-4000-8000-000000000000", todayIso);
  await page.goto(
    `${APP}/dashboard/attendance?date=${todayIso}&session=${encodeURIComponent(ghost)}`,
    { waitUntil: "networkidle", timeout: 60000 },
  );
  await page.waitForTimeout(3000);
  check("no drawer for a missing session", !(await drawerOpen()));
  check(
    "the calendar around it still works",
    (await page.getByText("e2e-fixture DeepLink Target").count()) > 0,
  );

  console.log("\n[8] The workspace CTA carries the target");
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const cta = page.getByRole("link", { name: /marquer les présences|mark attendance/i }).first();
  if ((await cta.count()) > 0) {
    const href = await cta.getAttribute("href");
    check(
      "hero CTA links with session params",
      !!href && href.includes("session="),
      `href=${href}`,
    );
    await cta.click();
    await page.waitForURL(/attendance/, { timeout: 30000 });
    await page.waitForTimeout(3200);
    check("following it opens a drawer", await drawerOpen(), "no drawer after CTA click");
  } else {
    console.log("  SKIP  hero CTA not present (no next class today)");
  }

  console.log("\n[9] Console");
  const loops = errors.filter((e) => /Maximum update depth|too many re-renders/i.test(e));
  check("no render loop from the deep-link effect", loops.length === 0, loops.join(" | "));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await fx.cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
