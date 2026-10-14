/**
 * Desktop app offline mode end to end (ADR-010), on the desktop build itself.
 *
 * The built UI (`dist-desktop/`, from `node scripts/build-desktop.mjs --local`) is served to the
 * browser from disk, the way Tauri serves it, so it keeps loading when the network is cut. Then:
 *
 *   - online: a teacher signs in; the app saves its cache and prepares the classroom data
 *   - offline: the lesson log and today's register still open (from the saved cache)
 *   - offline: a lesson entry and the attendance are accepted and QUEUED, the dialogs close
 *   - offline: an action that needs the server (marking a chapter done) is refused clearly
 *   - offline restart: the queue survives
 *   - back online: the attendance reaches the database; the lesson entry, which someone else
 *     wrote meanwhile, is refused and shown in « Synchronisation » (retry / discard)
 *   - sign-out clears the saved cache and the saved user
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API).
 *
 *   node scripts/build-desktop.mjs --local && node scripts/e2e/verify-desktop-offline.mjs
 */

import { chromium } from "playwright-core";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { withFixtures, cleanupFixtures, sql } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

// Same loopback address as the local Supabase API: Chromium blocks localhost -> 127.0.0.1 calls
// ("local network access"). The real app talks to the online database, so this is test-only.
const APP = "http://127.0.0.1:4175";
const DIST = path.resolve("dist-desktop");
const TAG = "e2e-fixture";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const GROUP = `${TAG} OFF Groupe ${RUN}`;
const CHAPTER = `${TAG} Chapitre ${RUN}`;
const SHOTS = process.env.SHOT_DIR ?? null;

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("dist-desktop/ is missing: run `node scripts/build-desktop.mjs --local` first.");
  process.exit(1);
}

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".ico": "image/x-icon", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain" };

// Pages fulfilled from disk count as "public" for Chromium's local-network protection, which
// then refuses their calls to the local Supabase API. The real app calls the online database, so
// the check is disabled for this local test only.
const browser = await chromium.launch({
  args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults"],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, timezoneId: "UTC" });
// The app's own files come from disk, like Tauri; deep links fall back to index.html.
await ctx.route(`${APP}/**`, (route) => {
  const url = new URL(route.request().url());
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  return route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[path.extname(file)] ?? "application/octet-stream" });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const fx = await withFixtures({ teacher: true, student: true });
const one = async (q) => (await sql(q))[0];
const today = (await one(`select current_date::text d`)).d;

async function settle(ms = 1500) {
  await page.waitForTimeout(ms);
}

try {
  await sql(`update public.profiles set locale = 'fr', full_name = 'Prof Off ${RUN}' where id = '${fx.teacher.id}';`);
  await sql(`update public.students set level_id = (select id from public.levels order by name limit 1), gender = 'male',
      date_of_birth = '2010-02-02', guardian_name = 'Parent', guardian_phone = '0550000088', onboarded_at = now()
      where id = '${fx.student.id}';`);
  const g = await one(`insert into public.groups (name, max_students, teacher_id, status, start_date)
      values ('${GROUP}', 12, '${fx.teacher.id}', 'active', current_date - 20) returning id::text id;`);
  await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time)
      select '${g.id}', d, '08:00', '09:00' from generate_series(0, 6) d;`);
  await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
      values ('${fx.student.id}', '${g.id}', 'approved', now());`);
  await sql(`insert into public.chapters (group_id, title, position, is_published) values ('${g.id}', '${CHAPTER}', 1, true);`);
  const session = encodeURIComponent(`${g.id}|${today}`);

  /* ------------------------------------------------------------------ 1. online */
  console.log("\n--- 1. online: sign in, the app prepares offline use ---");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await settle(800);
  await page.fill('input[type="email"]', fx.teacher.email);
  await page.fill('input[type="password"]', fx.teacher.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.getByTestId("desktop-sync-status").waitFor({ timeout: 30000 });
  check("the desktop build shows the connection indicator, online", (await page.getByTestId("desktop-sync-status").getAttribute("data-online")) === "true");
  // Open the pages once, as a teacher would, so their data is in the saved cache.
  await page.goto(`${APP}/dashboard/lesson-log?group=${g.id}`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-row").first().waitFor({ timeout: 30000 });
  await page.goto(`${APP}/dashboard/attendance?date=${today}&session=${session}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /tout présent|all present/i }).first().waitFor({ timeout: 30000 });
  await page.keyboard.press("Escape");
  await page.goto(`${APP}/dashboard/progression?group=${g.id}`, { waitUntil: "networkidle" });
  await page.getByTestId("progression-chapter").first().waitFor({ timeout: 30000 });
  await settle(2500); // the cache is written to IndexedDB about once a second
  const savedCache = await page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open("keyval-store");
    r.onsuccess = () => {
      const tx = r.result.transaction("keyval", "readonly").objectStore("keyval").get("gestion-ecole.query-cache");
      tx.onsuccess = () => resolve(!!tx.result && (tx.result.clientState?.queries?.length ?? 0));
      tx.onerror = () => resolve(0);
    };
    r.onerror = () => resolve(0);
  }));
  check("the query cache is saved on this computer", Number(savedCache) > 5, String(savedCache));

  /* ------------------------------------------------------------------ 2. offline */
  console.log("\n--- 2. offline: read from the saved cache, queue the classroom writes ---");
  await ctx.setOffline(true);
  await page.goto(`${APP}/dashboard/lesson-log?group=${g.id}`, { waitUntil: "load" });
  await page.getByTestId("lesson-row").first().waitFor({ timeout: 30000 });
  check("offline, the lesson log opens from the saved cache", (await page.getByTestId("lesson-row").count()) > 0);
  check("the indicator says offline", (await page.getByTestId("desktop-sync-status").getAttribute("data-online")) === "false");

  await page.locator(`[data-testid="lesson-row"][data-date="${today}"]`).getByTestId("lesson-edit").click();
  await page.getByRole("dialog").waitFor();
  await page.getByTestId("lesson-summary-input").fill("Cours fait hors ligne");
  await page.getByTestId("lesson-save").click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 });
  check(
    "a lesson entry is accepted offline: the dialog closes and the session shows as filled",
    (await page.locator(`[data-testid="lesson-row"][data-date="${today}"][data-logged="true"]`).count()) === 1,
  );
  check("the user is told it will be sent later", (await page.getByText("Enregistré hors ligne").count()) >= 1);

  await page.goto(`${APP}/dashboard/attendance?date=${today}&session=${session}`, { waitUntil: "load" });
  const allPresent = page.getByRole("button", { name: /tout présent|all present/i }).first();
  await allPresent.waitFor({ timeout: 30000 });
  check("offline, today's register opens with its students", await allPresent.isVisible());
  await allPresent.click();
  await settle(500);
  await page.getByRole("button", { name: /^enregistrer$|^save$/i }).first().click();
  await settle(1200);
  check("attendance is accepted offline (queued)", (await page.getByRole("button", { name: /tout présent|all present/i }).count()) === 0);

  await page.goto(`${APP}/dashboard/progression?group=${g.id}`, { waitUntil: "load" });
  const toggle = page.getByTestId("progression-toggle").first();
  await toggle.waitFor({ timeout: 30000 });
  await toggle.click();
  await settle(1000);
  check(
    "an action that needs the server is refused offline, clearly",
    (await page.getByText("Hors ligne : cette action nécessite une connexion.").count()) >= 1,
  );

  const status = page.getByTestId("desktop-sync-status");
  check("two changes are waiting", ((await status.textContent()) ?? "").includes("2"), (await status.textContent()) ?? "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-offline.png` });

  console.log("\n--- 3. offline restart: the queue survives ---");
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("desktop-sync-status").waitFor({ timeout: 30000 });
  await settle(2500);
  check(
    "after restarting offline, the two changes are still waiting",
    ((await page.getByTestId("desktop-sync-status").textContent()) ?? "").includes("2"),
    (await page.getByTestId("desktop-sync-status").textContent()) ?? "",
  );

  /* ------------------------------------------------------------------ 3. online again */
  console.log("\n--- 4. back online: the queue is sent; a conflict is shown, not lost ---");
  // Meanwhile someone else filled today's lesson log online.
  await sql(`insert into public.lesson_entries (group_id, session_date, summary, created_by)
      values ('${g.id}', current_date, 'Écrit par quelqu''un d''autre', '${fx.teacher.id}');`);
  await ctx.setOffline(false);
  await page.waitForFunction(() => document.querySelector('[data-testid="desktop-sync-status"]')?.getAttribute("data-online") === "true", null, { timeout: 30000 });
  await settle(6000);
  const marked = await one(`select count(*)::int n, min(status) s from public.attendance where group_id = '${g.id}' and session_date = current_date`);
  check("the queued attendance reached the database", marked?.n === 1 && marked?.s === "present", JSON.stringify(marked));
  await page.getByTestId("desktop-sync-status").click();
  const failedList = page.getByTestId("desktop-sync-failed");
  await failedList.waitFor({ timeout: 30000 });
  check(
    "the lesson entry refused on replay is shown in « Synchronisation » with its reason",
    (await failedList.locator("li").count()) === 1 && ((await failedList.textContent()) ?? "").includes("Cahier de textes"),
    (await failedList.textContent()) ?? "",
  );
  await failedList.getByRole("button", { name: "Abandonner" }).click();
  await settle(600);
  check("it can be discarded", (await page.getByTestId("desktop-sync-failed").count()) === 0);
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------------------ 4. sign-out */
  console.log("\n--- 5. sign-out clears the saved data ---");
  await page.goto(`${APP}/dashboard/profile`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /E2E|Prof Off/ }).last().click().catch(() => {});
  const logout = page.getByRole("menuitem", { name: /déconnexion|se déconnecter|log out|sign out/i });
  if (await logout.count()) await logout.first().click();
  await page.waitForURL(/\/login|\/$/, { timeout: 30000 }).catch(() => {});
  await settle(1500);
  const leftovers = await page.evaluate(() => new Promise((resolve) => {
    const user = localStorage.getItem("gestion-ecole.user");
    const r = indexedDB.open("keyval-store");
    r.onsuccess = () => {
      const tx = r.result.transaction("keyval", "readonly").objectStore("keyval").get("gestion-ecole.query-cache");
      tx.onsuccess = () => resolve({ user: !!user, cache: !!tx.result });
      tx.onerror = () => resolve({ user: !!user, cache: false });
    };
    r.onerror = () => resolve({ user: !!user, cache: false });
  }));
  check("after sign-out no cache and no saved user remain on this computer", !leftovers.user && !leftovers.cache, JSON.stringify(leftovers));

  check("no page errors", errors.length === 0, errors.join("\n").slice(0, 600));
} catch (e) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-offline-failure.png` }).catch(() => {});
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await browser.close();
  await cleanupFixtures();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
