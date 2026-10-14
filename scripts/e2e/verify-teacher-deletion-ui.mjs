/**
 * Deleting a teacher, from the screen the administrator actually uses.
 *
 * `verify-teacher-deletion.mjs` proves the rule in the database. This proves the dialog now
 * agrees with it: the button is enabled for an account whose only records are audit entries,
 * those entries are named as kept rather than hidden, and the deletion goes through from the
 * page. The reported bug was visible exactly here -- the dialog refused, citing
 * "2 entrée(s) d'audit", while promising on the line above that the audit trail is kept.
 *
 * The blocked case is exercised too, because a fix that simply enabled the button would be
 * worse than the bug.
 */

import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, createGroupFixture, sql } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const q = (s) => String(s).replace(/'/g, "''");
const BASE = process.env.BASE_URL ?? "http://localhost:8080";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true, teacher: true });
const fxB = await withFixtures({ teacher: true });

/**
 * Opens the row menu for a teacher and chooses Delete.
 *
 * Keyed on the EMAIL. Every fixture teacher is called "E2E Teacher", so a name would find
 * whichever row happened to come first -- and could open the menu for the wrong person
 * entirely, which is how a test comes to report a deletion it never performed.
 */
const openDeleteDialog = async (email) => {
  const row = page.getByRole("row").filter({ hasText: email });
  await row.getByRole("button").last().click();
  await page.getByRole("menuitem", { name: /supprimer|delete|حذف/i }).click();
  await page.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
  // The dependency lookup is a round trip; the dialog says so while it runs.
  await page.waitForFunction(
    () => !document.body.innerText.match(/vérification des données|checking/i),
    { timeout: 15000 },
  );
};

try {
  /* ------------------------------------------------------------------------- set-up */
  // The two entries from the bug report: the account's own creation, and one reset.
  await sql(`
    insert into public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
    values ('teacher_created', '${q(fx.admin.id)}', '${q(fx.admin.email)}',
            '${q(fx.teacher.id)}', '${q(fx.teacher.email)}', '{}'::jsonb),
           ('teacher_password_reset', '${q(fx.admin.id)}', '${q(fx.admin.email)}',
            '${q(fx.teacher.id)}', '${q(fx.teacher.email)}', '{}'::jsonb);
  `);
  // The other teacher has a group, so they must stay blocked.
  await createGroupFixture({ teacherId: fxB.teacher.id, studentCount: 2 });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', fx.admin.email);
  await page.fill('input[type="password"]', fx.admin.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.goto(`${BASE}/dashboard/teachers`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  /* ------------------------------------------- the account that could not be deleted */
  console.log("\n=== AN ACCOUNT WHOSE ONLY RECORDS ARE AUDIT ENTRIES ===");
  await openDeleteDialog(fx.teacher.email);
  const dialog = page.locator('[role="alertdialog"]');
  const text = await dialog.innerText();

  check("the dialog opens", (await dialog.count()) === 1);
  check(
    "it no longer refuses because of the audit trail",
    !/suppression impossible/i.test(text),
    text.slice(0, 220),
  );
  check("it says the deletion is safe", /aucune donnée rattachée/i.test(text), text.slice(0, 220));
  check(
    "it names the audit entries that will be kept",
    /conservé après la suppression/i.test(text) && /entrée\(s\) d'audit/i.test(text),
    text.slice(0, 400),
  );
  check("it still promises the audit trail survives", /journal d'audit est conservé/i.test(text));

  const confirm = dialog.getByRole("button", { name: /supprimer|delete|حذف/i }).last();
  check("the delete button is enabled", !(await confirm.isDisabled()));

  /* ------------------------------------------------------------- and it actually works */
  console.log("\n=== THE DELETION GOES THROUGH ===");
  await confirm.click();
  await page.waitForTimeout(3500);

  const gone = await sql(
    `select count(*)::int c from auth.users where id = '${q(fx.teacher.id)}';`,
  );
  check("the account is gone from the database", Number(gone[0].c) === 0, JSON.stringify(gone[0]));

  const kept = await sql(`
    select count(*)::int c from public.audit_log
     where target_email = '${q(fx.teacher.email)}' and target_id is null;
  `);
  check(
    "its audit entries survive, pointer nulled and email kept",
    Number(kept[0].c) >= 2,
    JSON.stringify(kept[0]),
  );

  await page.waitForTimeout(1000);
  // By email, and `getByRole` rather than `locator("table")`: the other fixture teacher
  // shares the display name "E2E Teacher", and the export control added a second, hidden
  // print table to this page which is aria-hidden and so absent from the accessibility tree.
  const listed = await page.getByRole("table").innerText();
  check(
    "the deleted teacher is off the list without a reload",
    !listed.includes(fx.teacher.email),
    listed.slice(0, 200),
  );
  check(
    "and the other teacher is still listed",
    listed.includes(fxB.teacher.email),
    "the refresh must not empty the table",
  );

  /* ------------------------------------------------------- the case that must stay shut */
  console.log("\n=== A TEACHER WITH A GROUP IS STILL REFUSED ===");
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await openDeleteDialog(fxB.teacher.email);
  const blockedDialog = page.locator('[role="alertdialog"]');
  const blockedText = await blockedDialog.innerText();

  check(
    "the dialog refuses",
    /suppression impossible/i.test(blockedText),
    blockedText.slice(0, 220),
  );
  check(
    "it names the group as the reason",
    /groupe\(s\) assigné\(s\)/i.test(blockedText),
    blockedText.slice(0, 300),
  );
  check("it points at archiving instead", /archiv/i.test(blockedText));
  const blockedBtn = blockedDialog.getByRole("button", { name: /supprimer|delete|حذف/i }).last();
  check("the delete button is disabled", await blockedBtn.isDisabled());

  const still = await sql(
    `select count(*)::int c from auth.users where id = '${q(fxB.teacher.id)}';`,
  );
  check("the account is still there", Number(still[0].c) === 1);

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
