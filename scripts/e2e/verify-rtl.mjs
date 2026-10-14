/**
 * Arabic (RTL) layout audit, in a real browser, for every role.
 *
 * The shell is `position: fixed`, so physical `left`/`right` offsets ignore
 * `dir` entirely: before this suite existed the sidebar stayed pinned to the
 * left of an Arabic page while the content flowed from the right, overlapping
 * it and clipping the last table column off screen.
 *
 * Locale is seeded two ways because BOTH are authorities: localStorage for the
 * pre-auth paint, and `profiles.locale` for signed-in users (LocaleSync pulls
 * the profile and overrides the local choice on login).
 *
 * Assertions are geometric rather than visual -- they compare the sidebar and
 * main-content rectangles -- so they fail on a real mirroring regression rather
 * than on a cosmetic change.
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, cleanupFixtures } from "./fixtures.mjs";
const SS = process.argv[2], APP = "http://localhost:5173";
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} -> ${d}`)); };
const API = "http://127.0.0.1:54321";
const sql = async (query) =>
  (await fetch(`${API}/pg/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })).json();

// LocaleSync overrides localStorage from the profile on login, so the profile
// is the authority that actually decides the signed-in language.
const fx = await withFixtures({ admin: true, teacher: true, student: true });
const TEST_EMAILS = fx.all.map((a) => `'${a.email}'`).join(",");
await sql(`update public.profiles set locale='ar' where id in (select id from auth.users where email in (${TEST_EMAILS}));`);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("gestion-ecole.locale", "ar"));
const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", (e) => errs.push(e.message));
const login = async (email, password) => {
  await p.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForURL(/dashboard/, { timeout: 30000 });
  await p.waitForTimeout(2000);
};
const audit = async (path, name) => {
  await p.goto(`${APP}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(2800);
  const r = await p.evaluate(() => {
    const de = document.documentElement, vw = de.clientWidth;
    const nav = document.querySelector('[data-sidebar="sidebar"]')?.closest(".fixed");
    const main = document.querySelector("main");
    const off = [];
    document.querySelectorAll("*").forEach((el) => {
      const q = el.getBoundingClientRect();
      if (q.width && q.height && (q.right > vw + 2 || q.left < -2)) off.push(el.tagName);
    });
    return { dir: de.dir, vw, sw: de.scrollWidth, url: location.pathname,
      navL: nav ? Math.round(nav.getBoundingClientRect().left) : null,
      mainL: main ? Math.round(main.getBoundingClientRect().left) : null,
      mainR: main ? Math.round(main.getBoundingClientRect().right) : null,
      off: off.length };
  });
  check(`${name}: dir=rtl`, r.dir === "rtl", r.dir);
  if (r.navL === null) {
    // Shell-less route (onboarding / redirect). Direction + overflow still apply.
    console.log(`  SKIP  ${name}: no dashboard shell on this route (${r.url})`);
  } else {
    check(`${name}: sidebar on the right`, r.navL > r.vw / 2, `navL=${r.navL}`);
    check(`${name}: content does not overlap sidebar`, r.mainR <= r.navL + 2, `mainR=${r.mainR} navL=${r.navL}`);
  }
  check(`${name}: no horizontal overflow`, r.sw <= r.vw + 2, `${r.sw}>${r.vw}`);
  check(`${name}: nothing rendered off-screen`, r.off === 0, `${r.off} elements`);
  await p.screenshot({ path: `${SS}/rtl-${name}.png` });
};
try {
  console.log("ADMIN"); await login(fx.admin.email, fx.admin.password);
  for (const [a, n] of [["/dashboard","admin-dashboard"],["/dashboard/teachers","admin-teachers"],["/dashboard/students","admin-students"],["/dashboard/groups","admin-groups"],["/dashboard/levels","admin-levels"],["/dashboard/subjects","admin-subjects"],["/dashboard/registrations","admin-registrations"],["/dashboard/attendance-report","admin-report"],["/dashboard/settings","admin-settings"],["/dashboard/profile","admin-profile"]]) await audit(a, n);
  console.log("TEACHER"); await ctx.clearCookies(); await login(fx.teacher.email, fx.teacher.password);
  for (const [a, n] of [["/dashboard","teacher-workspace"],["/dashboard/attendance","teacher-attendance"],["/dashboard/groups","teacher-groups"]]) await audit(a, n);
  console.log("STUDENT"); await ctx.clearCookies(); await login(fx.student.email, fx.student.password);
  await audit("/dashboard", "student-dashboard");
  console.log("\nMOBILE (390px)");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(2500);
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check("mobile: no horizontal overflow", m.sw <= m.cw + 2, `${m.sw}>${m.cw}`);
  await p.screenshot({ path: `${SS}/rtl-mobile.png` });
  check("no console errors", errs.length === 0, errs.slice(0,2).join(" | ").slice(0,200));
} catch (e) { fail++; console.log("  HARNESS ERROR:", e.message.slice(0,300)); }
finally {
  await b.close();
  await fx.cleanup();
}
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
