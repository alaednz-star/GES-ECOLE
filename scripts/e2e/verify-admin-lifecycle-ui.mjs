/**
 * The administrator lifecycle, from the page an administrator actually uses.
 *
 * `verify-admin-lifecycle.mjs` proves the rules in the database. This proves the screen
 * offers them: that the actions exist, that your own row refuses them by name, that a
 * deactivation reaches GoTrue rather than merely repainting a badge, and that reactivating
 * gives the login back.
 *
 * Every state is confirmed by trying to sign in, not by reading the badge. A badge saying
 * "Désactivé" above an account that can still get in is the failure this is written to catch.
 */

import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, API, PUBLISHABLE_KEY, TEST_PASSWORD } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

const canSignIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return r.ok;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fxA = await withFixtures({ admin: true });
const fxB = await withFixtures({ admin: true });

/** The card for one account, found by email because fixture names collide. */
const cardFor = (email) => page.locator("li").filter({ hasText: email });

const openMenu = async (email) => {
  await cardFor(email).getByRole("button").last().click();
  await page.waitForSelector('[role="menu"]', { timeout: 10000 });
};

const closeMenu = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
};

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', fxA.admin.email);
  await page.fill('input[type="password"]', fxA.admin.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.goto(`${BASE}/dashboard/users`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  /* ------------------------------------------------------------- the actions exist */
  console.log("\n=== THE ACTIONS ARE ON THE PAGE ===");
  check(
    "both administrators are listed",
    (await cardFor(fxA.admin.email).count()) === 1 &&
      (await cardFor(fxB.admin.email).count()) === 1,
  );

  await openMenu(fxB.admin.email);
  const menu = page.locator('[role="menu"]');
  const menuText = await menu.innerText();
  check("deactivation is offered", /désactiver/i.test(menuText), menuText);
  check("permanent deletion is offered", /supprimer définitivement/i.test(menuText), menuText);
  check(
    "reactivation is not offered for an active account",
    !/réactiver/i.test(menuText),
    menuText,
  );
  await closeMenu();

  /* --------------------------------------------------------------- your own account */
  console.log("\n=== YOUR OWN ACCOUNT REFUSES, BY NAME ===");
  await openMenu(fxA.admin.email);
  const ownMenu = page.locator('[role="menu"]');
  check(
    "the reason is stated on the row",
    /votre compte/i.test(await ownMenu.innerText()),
    await ownMenu.innerText(),
  );
  const ownItems = ownMenu.getByRole("menuitem");
  const disabled = await ownItems.evaluateAll((els) =>
    els.map(
      (e) => e.getAttribute("data-disabled") !== null || e.getAttribute("aria-disabled") === "true",
    ),
  );
  check(
    "every action on your own row is disabled",
    disabled.length > 0 && disabled.every(Boolean),
    JSON.stringify(disabled),
  );
  await closeMenu();
  check("and your own account still works", (await canSignIn(fxA.admin.email)) === true);

  /* ------------------------------------------------------------------- deactivation */
  console.log("\n=== DEACTIVATING ANOTHER ADMINISTRATOR ===");
  await openMenu(fxB.admin.email);
  await page.getByRole("menuitem", { name: /désactiver/i }).click();
  const dialog = page.locator('[role="alertdialog"]');
  await dialog.waitFor({ timeout: 10000 });
  const dialogText = await dialog.innerText();
  check(
    "the confirmation names the consequence",
    /ne pourra plus se connecter/i.test(dialogText),
    dialogText.slice(0, 200),
  );
  check(
    "and says it is reversible",
    /réactivation suffit/i.test(dialogText),
    dialogText.slice(0, 300),
  );

  await dialog.getByRole("button", { name: /^désactiver$/i }).click();
  await page.waitForTimeout(3500);

  check("the account can no longer sign in", (await canSignIn(fxB.admin.email)) === false);
  check(
    "the card says so",
    /désactivé/i.test(await cardFor(fxB.admin.email).innerText()),
    await cardFor(fxB.admin.email).innerText(),
  );

  /* ------------------------------------------------------------------- reactivation */
  console.log("\n=== AND REACTIVATING IT ===");
  await openMenu(fxB.admin.email);
  const backMenu = await page.locator('[role="menu"]').innerText();
  check("reactivation is now offered", /réactiver/i.test(backMenu), backMenu);
  check("deactivation is no longer offered", !/^désactiver$/im.test(backMenu), backMenu);

  await page.getByRole("menuitem", { name: /réactiver/i }).click();
  const backDialog = page.locator('[role="alertdialog"]');
  await backDialog.waitFor({ timeout: 10000 });
  await backDialog.getByRole("button", { name: /^réactiver$/i }).click();
  await page.waitForTimeout(3500);

  check("the account can sign in again", (await canSignIn(fxB.admin.email)) === true);
  check(
    "the card no longer says deactivated",
    !/désactivé/i.test(await cardFor(fxB.admin.email).innerText()),
    await cardFor(fxB.admin.email).innerText(),
  );

  check(
    "no console errors throughout",
    errors.length === 0,
    errors.slice(0, 2).join(" | ").slice(0, 300),
  );
} finally {
  await browser.close();
  await cleanupFixtures();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
if (fail > 0) process.exitCode = 1;
