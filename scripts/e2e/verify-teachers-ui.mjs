/**
 * Regression suite for the reported bugs:
 *   - infinite render loop ("Maximum update depth exceeded")
 *   - dead "Nouvel enseignant" button
 *
 * Drives the real app in Chromium as a real admin. Repeats the navigation to
 * catch intermittent loops, and asserts one click produces exactly one dialog.
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, cleanupFixtures } from "./fixtures.mjs";

let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(e.stack || e.message));

// Disposable admin: the real accounts are production data and their passwords
// are change-on-first-login, so the suite provisions its own.
const fx = await withFixtures({ admin: true });

try {
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', fx.admin.email);
  await page.fill('input[type="password"]', fx.admin.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  check("admin can sign in", /dashboard/.test(page.url()), page.url());

  // Navigate a few times: a loop driven by an unstable dep often needs a
  // remount or two to show itself.
  for (let i = 0; i < 3; i++) {
    await page.goto("http://localhost:5173/dashboard/teachers", { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.goto("http://localhost:5173/dashboard", { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  await page.goto("http://localhost:5173/dashboard/teachers", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(4000);

  const loops = errors.filter((e) => /Maximum update depth/i.test(e));
  check("no 'Maximum update depth' after 3 nav cycles", loops.length === 0, `${loops.length} occurrences`);
  check("no console errors at all", errors.length === 0, errors.slice(0, 2).join(" | ").slice(0, 300));

  // The reported dead button.
  const btn = page.getByRole("button", { name: /nouvel enseignant|new teacher|أستاذ جديد/i });
  check("Add Teacher button present", (await btn.count()) > 0);

  await btn.first().click();
  await page.waitForTimeout(2000);
  const dialogs = await page.locator('[role="dialog"]').count();
  check("one click opens exactly one dialog", dialogs === 1, `${dialogs} dialogs`);

  const hasFields =
    (await page.locator('[role="dialog"] input').count()) >= 3;
  check("dialog renders its form fields", hasFields);

  // Close and confirm it is dismissible (no stuck modal).
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  check("dialog closes on Escape", (await page.locator('[role="dialog"]').count()) === 0);

  const loopsAfter = errors.filter((e) => /Maximum update depth/i.test(e));
  check("no loop introduced by the interaction", loopsAfter.length === 0, `${loopsAfter.length}`);
} catch (e) {
  fail++;
  console.log("  HARNESS ERROR:", e.message.slice(0, 300));
} finally {
  await fx.cleanup();
  await browser.close();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
