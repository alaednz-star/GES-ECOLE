/**
 * Teacher lifecycle end-to-end, driven in a real browser as a real admin.
 *
 * Covers the contextual actions menu, the confirmation dialogs, and that each
 * transition actually reaches the database.
 */
import { chromium } from "playwright-core";
import { withFixtures, PUBLISHABLE_KEY } from "./fixtures.mjs";

const API = "http://127.0.0.1:54321";
const APP = "http://localhost:5173";

let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};
const sql = async (query) =>
  (await fetch(`${API}/pg/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })).json();

const fx = await withFixtures({ admin: true, teacher: true });
const TEACHER = fx.teacher.id;
const TEACHER_EMAIL = fx.teacher.email;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

const openMenuFor = async (email) => {
  const row = page.locator("tbody tr").filter({ hasText: email });
  await row.locator("button").last().click();
  await page.waitForTimeout(700);
};

try {
  // Known starting state.
  await sql(`select private.entity_lifecycle('teacher','${TEACHER}','active','e2e reset');`);

  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', fx.admin.email);
  await page.fill('input[type="password"]', fx.admin.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.goto(`${APP}/dashboard/teachers`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  check("teachers page loads", (await page.locator("tbody tr").count()) >= 1);

  console.log("\n[1] Actions menu replaces the pencil icon");
  await openMenuFor(TEACHER_EMAIL);
  const items = await page.locator('[role="menuitem"]').allInnerTexts();
  check("menu opens", items.length > 0, `${items.length} items`);
  check("has View profile", items.some((i) => /voir le profil|view profile|عرض الملف/i.test(i)));
  check("has Suspend (teacher is active)", items.some((i) => /suspendre|suspend|تعليق/i.test(i)));
  check("has Archive", items.some((i) => /archiver|archive|أرشفة/i.test(i)));
  check("has Delete", items.some((i) => /supprimer|delete|حذف/i.test(i)));
  check("NO Reactivate while active", !items.some((i) => /réactiver|reactivate/i.test(i)));
  check("NO Restore while active", !items.some((i) => /restaurer|^restore/i.test(i)));

  console.log("\n[2] Suspend, with the effects dialog");
  await page.locator('[role="menuitem"]').filter({ hasText: /suspendre|suspend|تعليق/i }).first().click();
  await page.waitForTimeout(1200);
  const dlg = page.locator('[role="alertdialog"]');
  check("confirmation dialog opens", (await dlg.count()) === 1);
  const dtxt = await dlg.innerText();
  check("dialog states what WILL happen", /connexion sera bloquée|sign-in will be blocked|سيُمنع/i.test(dtxt));
  check("dialog states what is PRESERVED", /conservé|kept|تبقى|محفوظ/i.test(dtxt));
  await dlg.locator("button").filter({ hasText: /suspendre|suspend|تعليق/i }).last().click();
  await page.waitForTimeout(3500);

  let q = await sql(`select status::text s from public.teachers where id='${TEACHER}';`);
  check("status is suspended in the database", q[0]?.s === "suspended", q[0]?.s);

  q = await sql(`select action::text a from public.audit_log where target_id='${TEACHER}' order by created_at desc limit 1;`);
  check("transition audited", q[0]?.a === "teacher_suspended", q[0]?.a);

  console.log("\n[3] Menu adapts to the new state");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await openMenuFor(TEACHER_EMAIL);
  const items2 = await page.locator('[role="menuitem"]').allInnerTexts();
  check("Reactivate now offered", items2.some((i) => /réactiver|reactivate|إعادة التفعيل/i.test(i)));
  check("Suspend no longer offered", !items2.some((i) => /^suspendre$|^suspend$/i.test(i.trim())));
  check("Reset password hidden while suspended", !items2.some((i) => /réinitialiser|reset password/i.test(i)));

  console.log("\n[4] Suspended teacher cannot sign in");
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEACHER_EMAIL, password: fx.teacher.password }),
  });
  check("sign-in blocked while suspended", r.status === 400, `HTTP ${r.status}`);

  console.log("\n[5] Reactivate restores access");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await openMenuFor(TEACHER_EMAIL);
  await page.locator('[role="menuitem"]').filter({ hasText: /réactiver|reactivate|إعادة التفعيل/i }).first().click();
  await page.waitForTimeout(1000);
  await page.locator('[role="alertdialog"] button').filter({ hasText: /réactiver|reactivate|إعادة التفعيل/i }).last().click();
  await page.waitForTimeout(3500);

  q = await sql(`select status::text s from public.teachers where id='${TEACHER}';`);
  check("status is active again", q[0]?.s === "active", q[0]?.s);

  const r2 = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEACHER_EMAIL, password: fx.teacher.password }),
  });
  check("sign-in restored", r2.status === 200, `HTTP ${r2.status}`);

  console.log("\n[6] Deletion is refused when history exists");
  await openMenuFor(TEACHER_EMAIL);
  await page.locator('[role="menuitem"]').filter({ hasText: /supprimer|delete|حذف/i }).first().click();
  await page.waitForTimeout(3000);
  const del = page.locator('[role="alertdialog"]');
  const deltxt = await del.innerText();
  check("delete dialog names the blockers", /audit|impossible|cannot delete|تعذّر/i.test(deltxt), deltxt.slice(0, 160));
  const confirmBtn = del.locator("button").filter({ hasText: /supprimer définitivement|delete permanently|حذف نهائي/i }).last();
  check("confirm button is disabled", await confirmBtn.isDisabled());
  await page.keyboard.press("Escape");

  console.log("\n[7] No console errors");
  const loops = errors.filter((e) => /Maximum update depth/i.test(e));
  check("no render loop", loops.length === 0, `${loops.length}`);
  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | ").slice(0, 240));
} catch (e) {
  fail++;
  console.log("  HARNESS ERROR:", e.message.slice(0, 300));
} finally {
  await fx.cleanup();
  await sql(`select private.entity_lifecycle('teacher','${TEACHER}','active','e2e cleanup');`);
  await browser.close();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
