/**
 * The teacher list export, on the real page, in a real browser.
 *
 * `verify-teacher-roster.mjs` proves the document; this proves the control that produces it
 * is actually mounted, actually admin-only, and that the hidden print document carries the
 * same teachers as the table beside it. A model can be perfect and the feature still absent
 * from the screen, which is the gap this closes.
 *
 * The Word download is exercised for real: the browser's own download is captured and the
 * bytes checked for a ZIP signature, so the button is proven to produce a file rather than
 * merely to be clickable.
 */

import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, sql } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

// The dev server takes 8080 unless something already holds it, so the URL is an input
// rather than a constant -- a suite that assumes a port silently tests nothing.
const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const signIn = async (email, password) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

// Disposable accounts: the real ones are this school's data.
const fx = await withFixtures({ admin: true, teacher: true, student: true });

try {
  /* ------------------------------------------------------------------ admin sees it */
  console.log("\n=== ADMIN ===");
  await signIn(fx.admin.email, fx.admin.password);
  await page.goto(`${BASE}/dashboard/teachers`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  check(
    "the export section is on the page",
    (await page.getByText(/exporter la liste des enseignants/i).count()) > 0,
  );

  const scope = page.getByLabel(/statut/i).first();
  check("the scope selector is present", (await scope.count()) > 0);

  const printBtn = page.getByRole("button", { name: /^imprimer$/i });
  const pdfBtn = page.getByRole("button", { name: /^pdf$/i });
  const wordBtn = page.getByRole("button", { name: /^word$/i });
  check("Print is offered", (await printBtn.count()) > 0);
  check("PDF is offered", (await pdfBtn.count()) > 0);
  check("Word is offered", (await wordBtn.count()) > 0);
  check(
    "the PDF button says how to get a PDF",
    /enregistrer au format pdf/i.test((await pdfBtn.first().getAttribute("title")) ?? ""),
  );

  /* ------------------------------------------------- the document matches the screen */
  console.log("\n=== DOCUMENT MATCHES THE SCREEN ===");
  const doc = page.locator("[data-roster-print]");
  check("the printable document is in the DOM", (await doc.count()) === 1);
  check("it is hidden on screen", !(await doc.first().isVisible()));

  const headers = await doc.first().locator("thead th").allInnerTexts();
  check("the document has the seven staff columns", headers.length === 7, headers.join(" | "));
  check(
    "the columns are the teacher's own, not the student roster's",
    /enseignant/i.test(headers.join(" ")) && !/élève/i.test(headers.join(" ")),
    headers.join(" | "),
  );

  const dbCount = Number((await sql(`select count(*)::int c from public.teachers;`))[0].c);
  const printedRows = await doc.first().locator("tbody tr").count();
  check(
    "every teacher the database holds is on the document",
    printedRows === dbCount,
    `${printedRows} printed vs ${dbCount} in the database`,
  );
  check(
    "the fixture teacher is named on the document",
    (await doc.first().innerText()).includes(fx.teacher.fullName ?? fx.teacher.email),
  );
  check(
    "the document carries the school's own letterhead",
    (await doc.first().locator("h1").count()) === 1,
  );

  /* ------------------------------------------------------------------- scope narrows */
  console.log("\n=== SCOPE ===");
  await scope.click();
  await page.getByRole("option", { name: /^inactif$/i }).click();
  await page.waitForTimeout(800);
  const inactiveRows = await doc.first().locator("tbody tr").count();
  check(
    "narrowing to inactive changes what the document holds",
    inactiveRows < printedRows,
    `${inactiveRows} vs ${printedRows}`,
  );
  check("the document states the narrowed scope", /inactif/i.test(await doc.first().innerText()));

  const emptyNow = inactiveRows === 0;
  check(
    "an empty selection disables the buttons and says why",
    !emptyNow ||
      ((await wordBtn.first().isDisabled()) &&
        (await page.getByText(/aucun enseignant à exporter/i).count()) > 0),
    "buttons must not offer to export nothing",
  );

  await scope.click();
  await page.getByRole("option", { name: /tous les statuts/i }).click();
  await page.waitForTimeout(800);

  /* ------------------------------------------------------------------ a real download */
  console.log("\n=== WORD DOWNLOAD ===");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    wordBtn.first().click(),
  ]);
  const name = download.suggestedFilename();
  check("the download is a .docx", name.endsWith(".docx"), name);
  check("the filename names the teacher list", name.includes("teachers"), name);
  check("the filename carries the date", /\d{4}-\d{2}-\d{2}/.test(name), name);

  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(path);
  check("the downloaded bytes are a real ZIP container", bytes[0] === 0x50 && bytes[1] === 0x4b);
  check("the file is not empty", bytes.length > 2000, `${bytes.length} bytes`);

  check(
    "no console errors on the page",
    errors.length === 0,
    errors.slice(0, 2).join(" | ").slice(0, 300),
  );

  /* ------------------------------------------------------------- nobody else sees it */
  console.log("\n=== NOT FOR ANYONE ELSE ===");
  for (const [role, account] of [
    ["teacher", fx.teacher],
    ["student", fx.student],
  ]) {
    await ctx.clearCookies();
    await signIn(account.email, account.password);
    await page.goto(`${BASE}/dashboard/teachers`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2000);
    const reachable = (await page.locator("[data-roster-print]").count()) > 0;
    check(`a ${role} is not offered the staff list`, !reachable, page.url());
  }
} finally {
  await browser.close();
  await cleanupFixtures();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
if (fail > 0) process.exitCode = 1;
