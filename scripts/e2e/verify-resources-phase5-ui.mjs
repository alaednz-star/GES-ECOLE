/**
 * Phase 5 in a real browser: the upload actually reports itself, and can be stopped.
 *
 * These are the checks that cannot be done any other way. "Does the progress bar
 * move?" is not answerable from the DOM at one instant, and "does cancel stop the
 * bytes?" is only answerable by looking at the bucket afterwards. So the test watches
 * the bar across time and then asks the database what landed.
 *
 * The file is deliberately large enough that a local upload takes more than one frame;
 * a 20 kB file completes before any intermediate value can be observed, which would
 * make the progress assertion pass for the wrong reason.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase5-ui.mjs
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

const fx = await withFixtures({ teacher: true });
const group = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture P5 Physique",
  subjectKey: "physics",
  studentCount: 0,
});
const chapter = (
  await sql(`insert into public.chapters (group_id, title, position, is_published)
             values ('${group.id}','e2e P5 Chapitre',1,true) returning id;`)
)[0].id;

/**
 * 4 MB of PDF, uploaded through a THROTTLED connection.
 *
 * Size alone cannot make a local upload observable: 24 MB over loopback finished
 * before the sampler could read a single intermediate value, and before a cancel could
 * land -- which made both assertions fail for an environmental reason rather than a
 * product one. Throttling the upload to 512 kB/s over CDP makes the transfer take
 * about eight seconds, which is deterministic and matches the condition this feature
 * exists for: a teacher on a slow line.
 */
const BIG_MB = 4;
const UPLOAD_BYTES_PER_SEC = 512 * 1024;

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

/** Throttle the upload only. Downloads stay fast so the app still loads quickly. */
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
const throttle = (bytesPerSec) =>
  cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 20,
    downloadThroughput: -1,
    uploadThroughput: bytesPerSec,
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
    .locator('section:has-text("e2e P5 Chapitre")')
    .last()
    .locator('button[aria-label="Ajouter une ressource"]')
    .first()
    .click();
  await page.waitForTimeout(900);
};
/** Attaches a large file without materialising it in Node: built in the page. */
const attachBigFile = async (name) => {
  await page.evaluate(
    async ({ name, mb }) => {
      const input = document.querySelector("#res-file");
      if (!input) throw new Error("no file input");
      // A repeating buffer: the bytes do not matter, the length does.
      const chunk = new Uint8Array(1024 * 1024).fill(65);
      const parts = [];
      for (let i = 0; i < mb; i++) parts.push(chunk);
      const file = new File(parts, name, { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { name, mb: BIG_MB },
  );
  await page.waitForTimeout(600);
};
const noOverflow = () =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );

try {
  await login(fx.teacher.email, fx.teacher.password);
  await gotoResources();

  /* ================= the quota readout ================= */
  console.log("\n--- the header shows measured usage against the real limit ---");
  const header = await page.locator("body").innerText();
  check(
    "usage is shown as a fraction of the quota, not a bare number",
    /\/\s*5(\.0)?\s*GB/i.test(header) || /5\s*GB/i.test(header),
    header.slice(0, 400),
  );
  const dbQuota = await sql(
    `select public.center_storage_bytes() u, public.center_storage_quota_bytes() q;`,
  );
  check(
    "and the limit matches what the database will enforce",
    Number(dbQuota[0].q) === 5 * 1024 ** 3,
    JSON.stringify(dbQuota[0]),
  );

  /* ================= real progress ================= */
  console.log("\n--- the progress bar reports actual bytes ---");
  await openAddDialog();
  await page.fill("#res-title", "e2e P5 Gros fichier");
  await attachBigFile("e2e-p5-big.pdf");
  const sizeHint = await page.locator('[role="dialog"]').innerText();
  check("the chosen file's size is shown", /4(\.0)?\s*MB/i.test(sizeHint), sizeHint.slice(0, 300));

  // Sample the bar while the upload runs. A fake bar produces {5} or {0,100}; a real
  // one produces several distinct intermediate values.
  await throttle(UPLOAD_BYTES_PER_SEC);
  const samples = [];
  const sampler = setInterval(async () => {
    try {
      const v = await page
        .locator('[role="dialog"] [role="progressbar"]')
        .first()
        .getAttribute("aria-valuenow");
      if (v !== null) samples.push(Number(v));
    } catch {
      /* dialog gone */
    }
  }, 120);

  await page
    .locator('[role="dialog"] button', { hasText: /Enregistrer/ })
    .last()
    .click();
  // 4 MB at 512 kB/s is roughly 8 s; wait past it so the upload also completes.
  await page.waitForTimeout(14000);
  clearInterval(sampler);
  await unthrottle();

  const distinct = [...new Set(samples.filter((n) => n > 0 && n < 100))];
  check(
    "the bar passes through intermediate values, so it is real",
    distinct.length >= 2,
    `samples=${JSON.stringify(samples.slice(0, 40))}`,
  );
  check(
    "...and none of them is the old fixed 5% placeholder alone",
    !(distinct.length === 1 && distinct[0] === 5),
    JSON.stringify(distinct),
  );

  const uploaded = await sql(`select r.title, r.size_bytes, r.file_name
                               from public.resources r where r.title = 'e2e P5 Gros fichier';`);
  check("the upload completed and the row exists", uploaded.length === 1, JSON.stringify(uploaded));
  check(
    "the recorded size is the real size",
    Number(uploaded[0]?.size_bytes) === BIG_MB * 1024 * 1024,
    `${uploaded[0]?.size_bytes} vs ${BIG_MB * 1024 * 1024}`,
  );
  const object = await sql(`select count(*)::int c from storage.objects
                             where bucket_id='course-resources' and name like '${group.id}/%'
                               and name like '%e2e-p5-big.pdf';`);
  check("the bytes reached the private bucket", object[0].c === 1, `${object[0].c}`);

  /* ================= cancel actually stops it ================= */
  console.log("\n--- cancel stops the transfer and leaves nothing behind ---");
  const objectsBefore = Number(
    (
      await sql(`select count(*)::int c from storage.objects
                 where bucket_id='course-resources' and name like '${group.id}/%';`)
    )[0].c,
  );
  const rowsBefore = Number(
    (await sql(`select count(*)::int c from public.resources where chapter_id='${chapter}';`))[0].c,
  );

  await gotoResources();
  await openAddDialog();
  await page.fill("#res-title", "e2e P5 Annulé");
  await attachBigFile("e2e-p5-cancel.pdf");
  await throttle(UPLOAD_BYTES_PER_SEC);
  await page
    .locator('[role="dialog"] button', { hasText: /Enregistrer/ })
    .last()
    .click();
  // Wait for the transfer to be genuinely under way before aborting it, and confirm
  // from the bar that bytes are still moving -- cancelling a finished upload would
  // prove nothing.
  await page.locator('[role="dialog"] [role="progressbar"]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000);
  const midFlight = Number(
    await page
      .locator('[role="dialog"] [role="progressbar"]')
      .first()
      .getAttribute("aria-valuenow"),
  );
  check(
    "the transfer is still in flight when cancel is pressed",
    midFlight > 0 && midFlight < 100,
    `${midFlight}%`,
  );
  // By aria-label, not by text: the footer also has an "Annuler", and matching on
  // that word clicked the wrong button -- which closed the dialog and made the
  // database assertions below pass for entirely the wrong reason.
  // Phase 6 made the stop control per FILE, so its label carries the filename:
  // "Interrompre dbg.pdf". Prefix match rather than exact -- the intent of this check
  // (a stop control exists, and using it leaves nothing behind) is unchanged.
  const cancelBtn = page.locator('[role="dialog"] button[aria-label^="Interrompre"]').first();
  check("a cancel control is offered during the transfer", (await cancelBtn.count()) > 0);
  await cancelBtn.click();
  // Poll for the toast instead of sleeping past it: sonner dismisses after a few
  // seconds, and a fixed wait was reading an empty container.
  let toastText = "";
  for (let i = 0; i < 20 && !toastText; i++) {
    toastText = (
      await page
        .locator('[data-sonner-toast], [role="status"], [role="alert"]')
        .allInnerTexts()
        .catch(() => [])
    )
      .join(" | ")
      .trim();
    if (!toastText) await page.waitForTimeout(200);
  }
  await page.waitForTimeout(2500);
  await unthrottle();

  const rowsAfter = Number(
    (await sql(`select count(*)::int c from public.resources where chapter_id='${chapter}';`))[0].c,
  );
  check("no resource row was created", rowsAfter === rowsBefore, `${rowsBefore} -> ${rowsAfter}`);
  const cancelledObject = await sql(`select count(*)::int c from storage.objects
                                      where bucket_id='course-resources'
                                        and name like '%e2e-p5-cancel.pdf';`);
  check(
    "no half-written object was left in the bucket",
    cancelledObject[0].c === 0,
    `${cancelledObject[0].c}`,
  );
  const objectsAfter = Number(
    (
      await sql(`select count(*)::int c from storage.objects
                 where bucket_id='course-resources' and name like '${group.id}/%';`)
    )[0].c,
  );
  check(
    "the bucket is exactly as it was",
    objectsAfter === objectsBefore,
    `${objectsBefore} -> ${objectsAfter}`,
  );
  // Read the toast region rather than the whole page: the body text is thousands of
  // characters and a substring match on it is meaningless.
  const toast = toastText;
  check(
    "a cancel reads as a cancel, not as an error",
    /annul/i.test(toast) && !/erreur|échou/i.test(toast),
    JSON.stringify(toast).slice(0, 200),
  );

  /* ================= external links embed in place ================= */
  console.log("\n--- a YouTube link is watched in the app, not on youtube.com ---");
  // A watch URL is what a teacher actually pastes. It cannot be framed; the embed form
  // can. The provider is derived on save, so this also checks the write path.
  await gotoResources();
  await openAddDialog();
  await page
    .locator('[role="dialog"] button', { hasText: /Lien externe/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.fill("#res-title", "e2e P5 Vidéo YouTube");
  await page.fill("#res-url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page
    .locator('[role="dialog"] button', { hasText: /Enregistrer/ })
    .last()
    .click();
  await page.waitForTimeout(2500);

  const stored = await sql(`select link_provider, url from public.resources
                             where title = 'e2e P5 Vidéo YouTube';`);
  check(
    "the provider is derived and stored on save",
    stored[0]?.link_provider === "youtube",
    JSON.stringify(stored[0]),
  );
  check(
    "the original URL is kept unchanged",
    stored[0]?.url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    String(stored[0]?.url),
  );

  await page.locator("text=e2e P5 Vidéo YouTube").first().click();
  await page.waitForTimeout(2500);
  const frameSrc = await page
    .locator('[role="dialog"] iframe')
    .first()
    .getAttribute("src")
    .catch(() => null);
  check(
    "the preview frames the EMBED url, not the watch url",
    typeof frameSrc === "string" && /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(frameSrc),
    String(frameSrc),
  );
  check(
    "...so nothing tries to frame a page that refuses framing",
    !/\/watch\?/.test(String(frameSrc)),
    String(frameSrc),
  );
  check(
    "the embed is allowed to go fullscreen",
    (await page
      .locator('[role="dialog"] iframe')
      .first()
      .getAttribute("allowfullscreen")
      .catch(() => null)) !== null,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  console.log("\n--- a provider that refuses framing is never framed ---");
  // OneDrive share links need a per-tenant embed call, so there is nothing safe to
  // frame. The contract is that such a link OPENS rather than rendering a frame the
  // student would only see an error in -- checked by intercepting window.open, since
  // asserting on a broken iframe would prove nothing.
  await gotoResources();
  await page.evaluate(() => {
    globalThis.__opened = [];
    globalThis.open = (u) => {
      globalThis.__opened.push(String(u));
      return null;
    };
  });
  await openAddDialog();
  await page
    .locator('[role="dialog"] button', { hasText: /Lien externe/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.fill("#res-title", "e2e P5 OneDrive");
  await page.fill("#res-url", "https://onedrive.live.com/?id=ABC123");
  await page
    .locator('[role="dialog"] button', { hasText: /Enregistrer/ })
    .last()
    .click();
  await page.waitForTimeout(2500);

  const oneDrive = await sql(`select link_provider from public.resources
                               where title = 'e2e P5 OneDrive';`);
  check(
    "the provider is recognised even though it cannot be embedded",
    oneDrive[0]?.link_provider === "onedrive",
    JSON.stringify(oneDrive[0]),
  );

  await page.locator("text=e2e P5 OneDrive").first().click();
  await page.waitForTimeout(1800);
  const openedExternally = await page.evaluate(() => globalThis.__opened ?? []);
  check(
    "it opens externally instead of being framed",
    openedExternally.some((u) => u.includes("onedrive.live.com")),
    JSON.stringify(openedExternally),
  );
  check(
    "and no frame was rendered for it",
    (await page.locator('[role="dialog"] iframe').count()) === 0,
  );

  /* ================= responsive + RTL ================= */
  console.log("\n--- responsive and RTL ---");
  await gotoResources();
  for (const w of [1024, 375]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(800);
    check(`no horizontal overflow at ${w}px`, await noOverflow());
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await sql(`update public.profiles set locale='ar' where id='${fx.teacher.id}';`);
  await login(fx.teacher.email, fx.teacher.password);
  await gotoResources();
  check("the document is RTL", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
  const ar = await page.locator("body").innerText();
  check(
    "the quota figure is not reversed under RTL",
    !/GB\s*\d/.test(ar.replace(/\n/g, " ")),
    ar.slice(0, 400),
  );
  await page
    .locator('section:has-text("e2e P5 Chapitre")')
    .last()
    .locator('button[aria-label="إضافة مورد"]')
    .first()
    .click();
  await page.waitForTimeout(900);
  const arDialog = await page.locator('[role="dialog"]').innerText();
  check("the dialog is translated", /إضافة إلى|نوع المورد/.test(arDialog), arDialog.slice(0, 200));
  check("no horizontal overflow in RTL at 1440px", await noOverflow());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(800);
  check("no horizontal overflow in RTL at 375px", await noOverflow());
} finally {
  await sql(`update public.profiles set locale='fr' where id='${fx.teacher.id}';`);
  await browser.close();
  await sql(`delete from public.resources where chapter_id='${chapter}';`);
  await removeObjects(`${group.id}/`);
  await sql(`delete from public.chapters where id='${chapter}';`);
  await fx.cleanup();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
