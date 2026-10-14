/**
 * Attendance Calendar in Arabic (RTL).
 *
 * Verifies that the calendar and drawer are fully translated and that the
 * logical CSS properties hold up under `dir="rtl"` -- no horizontal page
 * overflow, no leaked French strings.
 *
 * NOTE ON SWITCHING LOCALE: for a signed-in user, `LocaleSync` reads
 * `profiles.locale` and it WINS over localStorage. Setting the profile row is
 * therefore the only reliable way to put an authenticated session into Arabic;
 * writing localStorage alone is silently overridden on the next render.
 *
 * RUN ALONE -- see the note in verify-session-calendar.mjs about shared fixtures.
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

const fx = await withFixtures({ teacher: true });
await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture RTL Cal",
  weekday: new Date().getDay(),
  studentCount: 2,
});

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 1000 } })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());

try {
  // Set the profile locale BEFORE signing in, so the first render is already Arabic.
  await sql(`update public.profiles set locale='ar' where id='${fx.teacher.id}';`);

  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', fx.teacher.email);
  await page.fill('input[type="password"]', fx.teacher.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });

  await page.goto(`${APP}/dashboard/attendance`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  const dir = await page.evaluate(() => document.documentElement.dir);
  check("document dir is rtl", dir === "rtl", `dir=${dir}`);

  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 2,
  );
  check("no horizontal page overflow in RTL", noOverflow);

  const arabic = await page.getByText(/الحضور|حصص|بحاجة للتسجيل|اليوم/).count();
  check("Arabic session vocabulary rendered", arabic > 0, `matches=${arabic}`);

  const french = await page.getByText(/séances|à pointer seulement|aujourd'hui/i).count();
  check("no leaked French strings in Arabic mode", french === 0, `leaks=${french}`);

  // The grid is FLUID now: seven `minmax(0, 1fr)` tracks that shrink instead of
  // scrolling. The previous assertion required `overflow-x: auto` on the card,
  // which was the old horizontal-scroll approach -- that is exactly what was
  // removed, because it pushed the last column off-screen below 1280px. What
  // matters instead is that the grid never exceeds its container.
  const gridFits = await page.evaluate(() => {
    const grid = document.querySelector('div.grid[style*="repeat(7"]');
    if (!grid) return null;
    const card = grid.closest(".surface-card");
    if (!card) return null;
    return grid.scrollWidth <= card.clientWidth + 2;
  });
  check("calendar grid fits its container without scrolling", gridFits === true, `${gridFits}`);

  await page.getByText("e2e-fixture RTL Cal").first().click();
  await page.waitForTimeout(1800);

  const drawerAr = await page.getByText(/الجميع حاضر|إعادة تعيين|حفظ/).count();
  check("drawer is translated in Arabic", drawerAr > 0, `matches=${drawerAr}`);

  const drawerNoOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 2,
  );
  check("drawer does not cause overflow in RTL", drawerNoOverflow);

  // Under RTL the Sheet flips to the start (left) edge; assert it is offscreen
  // on neither side rather than hardcoding a side.
  const drawerBox = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, vw: window.innerWidth };
  });
  check(
    "drawer is fully on screen in RTL",
    !!drawerBox && drawerBox.left >= -2 && drawerBox.right <= drawerBox.vw + 2,
    JSON.stringify(drawerBox),
  );

  check("no page errors in RTL", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await fx.cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
