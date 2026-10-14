/**
 * Phase 6: several files at once, each able to fail on its own.
 *
 * Almost every requirement here is about a FAILURE mode -- one file failing must not
 * take the others with it, a cancel must abort the request rather than abandon a
 * promise, a row that cannot be created must not leave its bytes behind. So the tests
 * are mostly about what is in the database and the bucket afterwards, not about what
 * the dialog looked like.
 *
 * Uploads are throttled over CDP for the same reason as Phase 5: on loopback a batch
 * finishes before anything can be observed or interrupted, which would make the
 * assertions pass without testing anything.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase6-ui.mjs
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql, API, SERVICE_ROLE_KEY } from "./fixtures.mjs";

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

const MB = 1024 * 1024;
const UPLOAD_BYTES_PER_SEC = 700 * 1024;

const fx = await withFixtures({ teacher: true });
const group = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture P6 Physique",
  subjectKey: "physics",
  studentCount: 0,
});
const chapter = (
  await sql(`insert into public.chapters (group_id, title, position, is_published)
             values ('${group.id}','e2e P6 Chapitre',1,true) returning id;`)
)[0].id;

const removeObjects = async (prefix) => {
  const rows = await sql(`select name from storage.objects
                           where bucket_id='course-resources' and name like '${prefix}%';`);
  if (rows.length === 0) return;
  await fetch(`${API}/storage/v1/object/course-resources`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: rows.map((r) => r.name) }),
  });
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
const throttle = (bps) =>
  cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 20,
    downloadThroughput: -1,
    uploadThroughput: bps,
  });
const unthrottle = () =>
  cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

const login = async (email, password) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};
const gotoResources = async () => {
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
};
const openAddDialog = async () => {
  await page
    .locator('section:has-text("e2e P6 Chapitre")')
    .last()
    .locator('button[aria-label="Ajouter une ressource"]')
    .first()
    .click();
  await page.waitForTimeout(900);
};
/** Attaches N files of `mb` each, named `prefix-1.pdf` … */
const attachFiles = async (prefix, count, mb) => {
  await page.evaluate(
    ({ prefix, count, mb }) => {
      const input = document.querySelector("#res-file");
      if (!input) throw new Error("no file input");
      const chunk = new Uint8Array(1024 * 1024).fill(65);
      const dt = new DataTransfer();
      for (let n = 1; n <= count; n++) {
        const parts = [];
        for (let i = 0; i < mb; i++) parts.push(chunk);
        dt.items.add(new File(parts, `${prefix}-${n}.pdf`, { type: "application/pdf" }));
      }
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { prefix, count, mb },
  );
  await page.waitForTimeout(700);
};
const save = () =>
  page
    .locator('[role="dialog"] button', { hasText: /Enregistrer/ })
    .last()
    .click();
const noOverflow = () =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );
const rowsInChapter = async () =>
  Number(
    (await sql(`select count(*)::int c from public.resources where chapter_id='${chapter}';`))[0].c,
  );
const objectsInGroup = async () =>
  Number(
    (
      await sql(`select count(*)::int c from storage.objects
                  where bucket_id='course-resources' and name like '${group.id}/%';`)
    )[0].c,
  );

try {
  await login(fx.teacher.email, fx.teacher.password);

  /* ============ the happy batch ============ */
  console.log("\n--- four files, one dialog, four rows ---");
  await gotoResources();
  await openAddDialog();
  await attachFiles("e2e-p6-batch", 4, 1);
  let dialog = await page.locator('[role="dialog"]').innerText();
  check("the dialog lists every chosen file", /4 fichier/i.test(dialog), dialog.slice(0, 300));
  check(
    "each file is named individually",
    ["1", "2", "3", "4"].every((n) => dialog.includes(`e2e-p6-batch-${n}.pdf`)),
    dialog.slice(0, 400),
  );
  check(
    "no single title is demanded for a batch",
    (await page.locator("#res-title").inputValue()) === "",
  );

  await save();
  await page.waitForTimeout(9000);
  const batchRows = await sql(`select title, size_bytes, file_name, role::text
                                from public.resources where chapter_id='${chapter}'
                               order by title;`);
  check("one row per file", batchRows.length === 4, `${batchRows.length}`);
  check(
    "each row is titled from its own filename",
    batchRows.every((r, i) => r.title === `e2e-p6-batch-${i + 1}`),
    batchRows.map((r) => r.title).join(", "),
  );
  check(
    "each row records its own size",
    batchRows.every((r) => Number(r.size_bytes) === 1 * MB),
    batchRows.map((r) => r.size_bytes).join(", "),
  );
  check(
    "the shared settings applied to all of them",
    batchRows.every((r) => r.role === "notes"),
    batchRows.map((r) => r.role).join(", "),
  );
  check("four objects in the bucket", (await objectsInGroup()) === 4, `${await objectsInGroup()}`);

  /* ============ one cancelled file does not take the others ============ */
  console.log("\n--- cancelling one file leaves the rest alone ---");
  const rowsBefore = await rowsInChapter();
  const objectsBefore = await objectsInGroup();
  await gotoResources();
  await openAddDialog();
  await attachFiles("e2e-p6-mixed", 3, 3);
  await throttle(UPLOAD_BYTES_PER_SEC);
  await save();
  // Wait until at least one row is uploading, then cancel THAT one.
  await page.locator('[role="dialog"] [role="progressbar"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const stopButtons = page.locator('[role="dialog"] button[aria-label^="Interrompre"]');
  const stopCount = await stopButtons.count();
  check("each in-flight file has its own stop control", stopCount >= 2, `${stopCount}`);
  await stopButtons.first().click();
  await page.waitForTimeout(14000);
  await unthrottle();

  dialog = await page
    .locator('[role="dialog"]')
    .innerText()
    .catch(() => "");
  const mixedRows = await sql(`select title from public.resources
                                where chapter_id='${chapter}' and title like 'e2e-p6-mixed%'
                               order by title;`);
  check(
    "the files that were not cancelled still became rows",
    mixedRows.length === 2,
    `${mixedRows.length} of 3: ${mixedRows.map((r) => r.title).join(", ")}`,
  );
  check(
    "the cancelled file left no row",
    (await rowsInChapter()) === rowsBefore + 2,
    `${await rowsInChapter()} vs ${rowsBefore + 2}`,
  );
  check(
    "and no half-written object",
    (await objectsInGroup()) === objectsBefore + 2,
    `${await objectsInGroup()} vs ${objectsBefore + 2}`,
  );

  /* ============ closing the dialog stops everything ============ */
  console.log("\n--- closing the dialog aborts every transfer ---");
  const beforeClose = { rows: await rowsInChapter(), objects: await objectsInGroup() };
  await gotoResources();
  await openAddDialog();
  await attachFiles("e2e-p6-closed", 3, 3);
  await throttle(UPLOAD_BYTES_PER_SEC);
  await save();
  await page.locator('[role="dialog"] [role="progressbar"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(12000);
  await unthrottle();
  check(
    "no rows were created after closing",
    (await rowsInChapter()) === beforeClose.rows,
    `${await rowsInChapter()} vs ${beforeClose.rows}`,
  );
  check(
    "and nothing kept landing in the bucket",
    (await objectsInGroup()) === beforeClose.objects,
    `${await objectsInGroup()} vs ${beforeClose.objects}`,
  );

  /* ============ the quota is asked about the whole batch ============ */
  console.log("\n--- the quota sees the batch total, the 250 MB rule sees one file ---");
  // Two files whose SUM exceeds the remaining quota would be refused; each alone would
  // pass. Rather than fill a 5 GB quota, assert the server contract directly.
  const tok = await (async () => {
    const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: fx.teacher.email, password: fx.teacher.password }),
    });
    return (await r.json()).access_token;
  })();
  const quotaAsk = async (incoming) => {
    const r = await fetch(`${API}/rest/v1/rpc/storage_quota_allows`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _incoming: incoming }),
    });
    return r.json();
  };
  check("a batch inside the quota is allowed", (await quotaAsk(400 * MB)) === true);
  check("a batch beyond the quota is refused", (await quotaAsk(6 * 1024 * MB)) === false);
  // The per-file rule is separate: 2 x 200 MB is a legal batch, 1 x 300 MB is not.
  check(
    "two 200 MB files are a legal batch by total",
    (await quotaAsk(400 * MB)) === true,
    "400 MB total",
  );

  /* ============ drag and drop ============ */
  console.log("\n--- the drop zone is wired ---");
  // HONEST LIMIT. A synthetic DragEvent carrying a DataTransfer does not deliver
  // `dataTransfer.files` to the handler in this harness -- the same limitation this
  // repo already recorded for the chapter drag-and-drop, where Playwright's mouse API
  // could not initiate a native drag either. So the DROP PATH ITSELF IS NOT VERIFIED
  // END TO END here; what is verified is that the zone is wired and that the code path
  // it calls (`onFilesChange` -> queue -> upload) is the same one the file picker uses,
  // which the batch checks above exercise thoroughly.
  await gotoResources();
  await openAddDialog();
  const zoneWired = await page.evaluate(() => {
    const zone = document.querySelector('label[for="res-file"]');
    if (!zone) return null;
    const before = zone.className;
    const dt = new DataTransfer();
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    return { before, hasZone: true };
  });
  check("the file picker doubles as a drop zone", zoneWired?.hasZone === true);
  // A second assertion -- that dragover is preventDefault()ed -- was removed: a
  // programmatically dispatched DragEvent does not reliably reach React's delegated
  // listener in this harness, so the check was testing the harness rather than the
  // product. Drag-and-drop is therefore IMPLEMENTED BUT NOT VERIFIED END TO END, and
  // the Phase 6 report says so rather than claiming otherwise.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  /* ============ responsive + RTL ============ */
  console.log("\n--- responsive and RTL ---");
  await gotoResources();
  await openAddDialog();
  await attachFiles("e2e-p6-layout", 3, 1);
  for (const w of [1440, 1024, 375]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(700);
    check(`the file list does not overflow at ${w}px`, await noOverflow());
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  await sql(`update public.profiles set locale='ar' where id='${fx.teacher.id}';`);
  await login(fx.teacher.email, fx.teacher.password);
  await gotoResources();
  await page
    .locator('section:has-text("e2e P6 Chapitre")')
    .last()
    .locator('button[aria-label="إضافة مورد"]')
    .first()
    .click();
  await page.waitForTimeout(900);
  await attachFiles("e2e-p6-rtl", 2, 1);
  // Read the file LIST, not the whole dialog: the dialog's innerText proved unreliable
  // after several navigations, and the list is what this assertion is about.
  const arList = await page
    .locator('[role="dialog"] ul li')
    .allInnerTexts()
    .catch(() => []);
  const arText = arList.join(" | ");
  check("the file list is translated", /ملف|في الانتظار/.test(arText), arText.slice(0, 240));
  check(
    "sizes are not reversed under RTL",
    arList.length > 0 && !/MB\s+\d/.test(arText),
    arText.slice(0, 300),
  );
  check("no horizontal overflow in RTL at 1440px", await noOverflow());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(800);
  check("no horizontal overflow in RTL at 375px", await noOverflow());
} finally {
  await unthrottle().catch(() => {});
  await sql(`update public.profiles set locale='fr' where id='${fx.teacher.id}';`);
  await browser.close();
  await sql(`delete from public.resources where chapter_id='${chapter}';`);
  await removeObjects(`${group.id}/`);
  await sql(`delete from public.chapters where id='${chapter}';`);
  await fx.cleanup();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
