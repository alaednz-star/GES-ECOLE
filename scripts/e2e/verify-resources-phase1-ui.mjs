/**
 * Phase 1, browser half: the real Resources UI now goes through the server
 * storage path.
 *
 * The API suite proves the DATABASE refuses the wrong things. This proves the
 * APPLICATION asks it -- that signing moved out of the browser, that the preview
 * and download buttons still work for the people who should have them, that the
 * download button is not merely hidden when `allow_download = false`, and that a
 * student opening a resource actually records a view (which is what the whole
 * event log exists for).
 *
 * RUN ALONE -- `cleanupFixtures()` removes every `e2e-fixture%` row, and it runs
 * once, in `finally`.
 *
 *   node scripts/e2e/verify-resources-phase1-ui.mjs
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

/** A one-page PDF, small enough to inline and real enough for an iframe. */
const PDF = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAw" +
    "IG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8" +
    "PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA5OSA5OV0+PgplbmRvYmoKdHJh" +
    "aWxlcgo8PC9Sb290IDEgMCBSPj4K",
  "base64",
);

const upload = async (path) => {
  const res = await fetch(`${API}/storage/v1/object/course-resources/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    },
    body: PDF,
  });
  if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
};

/** Deletes every object under a prefix through the Storage API, which is the only
 *  route allowed: `storage.protect_delete()` blocks a direct DELETE on the table. */
const removeObjects = async (prefix) => {
  const rows = await sql(`select name from storage.objects
                           where bucket_id='course-resources'
                             and name like '${prefix.replace(/'/g, "''")}%';`);
  if (rows.length === 0) return 0;
  const res = await fetch(`${API}/storage/v1/object/course-resources`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: rows.map((r) => r.name) }),
  });
  if (!res.ok) console.log(`  (storage cleanup failed: ${res.status} ${await res.text()})`);
  return rows.length;
};

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const other = await withFixtures({ teacher: true });

const group = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture Res Alpha",
  studentCount: 1,
});
// The fixture student is the one we sign in as, so enrol them here too.
await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
           values ('${fx.student.id}','${group.id}','approved',now())
           on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);
await sql(`update public.students set gender=coalesce(gender,'male'),
             date_of_birth=coalesce(date_of_birth,'2008-05-14'),
             guardian_name=coalesce(guardian_name,'Parent Fixture'),
             guardian_phone=coalesce(guardian_phone,'0661000000'),
             level_id=(select level_id from public.groups where id='${group.id}'),
             stream_id=(select stream_id from public.groups where id='${group.id}'),
             onboarded_at=now()
           where id='${fx.student.id}';`);

const chapter = (
  await sql(`insert into public.chapters (group_id, title, position, is_published)
             values ('${group.id}','e2e Chapitre 1', 1, true) returning id;`)
)[0].id;

const mk = async (title, allowDownload) => {
  const path = `${group.id}/${crypto.randomUUID()}/${title}.pdf`;
  await upload(path);
  return (
    await sql(`insert into public.resources
                 (chapter_id, group_id, title, kind, storage_path, mime_type, size_bytes,
                  allow_download, is_published, role, created_by)
               values ('${chapter}','${group.id}','${title}','file','${path}','application/pdf',
                       ${PDF.length}, ${allowDownload}, true, 'notes', '${fx.teacher.id}')
               returning id;`)
  )[0].id;
};
const rOk = await mk("e2e-open-me", true);
const rNoDl = await mk("e2e-no-download", false);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

/** Every server-function POST the page makes, so "did it go through the server?"
 *  is answered by observation rather than by reading the source. */
const serverCalls = [];
page.on("request", (r) => {
  const u = r.url();
  if (r.method() === "POST" && /_serverFn|serverFn|\.functions\./.test(u)) serverCalls.push(u);
});
/** Signed URLs the page hands to `window.open`, which we intercept rather than
 *  letting a download tab open. */
await ctx.addInitScript(() => {
  globalThis.__opened = [];
  const real = globalThis.open;
  globalThis.open = (u, ...rest) => {
    globalThis.__opened.push(String(u));
    return real ? null : null;
  };
});

const login = async (email, password) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

const openedUrls = () => page.evaluate(() => globalThis.__opened ?? []);
const clearOpened = () => page.evaluate(() => (globalThis.__opened = []));

try {
  /* ------------------------------ teacher ------------------------------ */
  console.log("\n--- teacher page still works, and signs through the server ---");
  await login(fx.teacher.email, fx.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  let body = await page.locator("body").innerText();
  check("teacher sees the chapter", /e2e Chapitre 1/.test(body), body.slice(0, 200));
  check("teacher sees both resources", /e2e-open-me/.test(body) && /e2e-no-download/.test(body));
  check(
    "no error state on the page",
    !/Impossible de charger|Une erreur/i.test(body),
    body.slice(0, 200),
  );

  // Preview: the URL must come back signed, and via the server function.
  serverCalls.length = 0;
  await page.locator("text=e2e-open-me").first().click();
  await page.waitForTimeout(2500);
  const previewSrc = await page
    .locator('iframe, [role="dialog"] iframe, video, audio, img[src*="sign"]')
    .first()
    .getAttribute("src")
    .catch(() => null);
  check(
    "preview URL is a short-lived SIGNED storage URL",
    typeof previewSrc === "string" && /\/storage\/v1\/object\/sign\//.test(previewSrc),
    String(previewSrc).slice(0, 120),
  );
  check(
    "the signature was requested from the server, not minted in the browser",
    serverCalls.length > 0,
    `${serverCalls.length} server-function calls`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // Upload now asks the server for the per-file limit and the centre quota before
  // a byte moves. If that call were broken, uploading would fail outright -- so it
  // has to be exercised, not reasoned about.
  console.log("\n--- upload goes through the server quota check ---");
  // Phase 2 made the destination explicit, so the shortest honest upload path is
  // the CONTEXTUAL one: the add button inside a chapter carries group and chapter
  // with it. The global cascade is covered by verify-resources-phase2.mjs.
  // The per-chapter button is icon-only, so it is found by its aria-label, not by
  // text. Scoped to the chapter card so the page-level button cannot be picked up.
  const addBtn = page.locator('button[aria-label="Ajouter une ressource"]').last();
  if ((await addBtn.count()) === 0) {
    check("an add-resource button exists", false, "not found");
  } else {
    await addBtn.click();
    await page.waitForTimeout(1200);
    serverCalls.length = 0;
    await page.setInputFiles("#res-file", {
      name: "e2e-uploaded.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await page.waitForTimeout(400);
    const saveBtn = page
      .locator('[role="dialog"] button')
      .filter({ hasText: /enregistrer|save|حفظ/i })
      .last();
    await saveBtn.click();
    await page.waitForTimeout(4000);

    const uploaded = await sql(`select file_name, file_ext, size_bytes, role
                                  from public.resources
                                 where title = 'e2e-uploaded' and group_id = '${group.id}';`);
    check(
      "the upload completed and the row exists",
      uploaded.length === 1,
      JSON.stringify(uploaded),
    );
    check(
      "the quota check ran on the server",
      serverCalls.length > 0,
      `${serverCalls.length} server-function calls`,
    );
    if (uploaded.length === 1) {
      check(
        "file_name and file_ext are populated by the trigger, not the client",
        uploaded[0].file_name === "e2e-uploaded.pdf" && uploaded[0].file_ext === "pdf",
        JSON.stringify(uploaded[0]),
      );
    }
    const objects = await sql(`select count(*)::int c from storage.objects
                                where bucket_id='course-resources'
                                  and name like '${group.id}/%e2e-uploaded.pdf';`);
    check("the bytes actually reached the private bucket", objects[0].c === 1, `${objects[0].c}`);
  }

  /* ------------------------------ student ------------------------------ */
  console.log("\n--- student: preview, download, and the download that is refused ---");
  await login(fx.student.email, fx.student.password);
  await page.goto(`${APP}/dashboard/my-resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  body = await page.locator("body").innerText();
  check("student sees the chapter", /e2e Chapitre 1/.test(body), body.slice(0, 200));
  check("student sees the published resources", /e2e-open-me/.test(body));

  const viewsBefore = Number(
    (
      await sql(`select count(*)::int c from public.resource_events
                  where resource_id='${rOk}' and student_id='${fx.student.id}' and kind='view';`)
    )[0].c,
  );

  await clearOpened();
  await page.locator("text=e2e-open-me").first().click();
  await page.waitForTimeout(2500);

  const studentPreview = await page
    .locator('iframe, [role="dialog"] iframe')
    .first()
    .getAttribute("src")
    .catch(() => null);
  check(
    "student preview is served by a signed URL",
    typeof studentPreview === "string" && /\/storage\/v1\/object\/sign\//.test(studentPreview),
    String(studentPreview).slice(0, 120),
  );
  check(
    "a preview URL carries NO attachment disposition",
    typeof studentPreview === "string" && !/[?&]download=/.test(studentPreview),
    String(studentPreview).slice(0, 160),
  );

  // The whole point of the event log: opening it records a view.
  await page.waitForTimeout(1500);
  const viewsAfter = Number(
    (
      await sql(`select count(*)::int c from public.resource_events
                  where resource_id='${rOk}' and student_id='${fx.student.id}' and kind='view';`)
    )[0].c,
  );
  check(
    "opening a resource records a view for this student",
    viewsAfter > viewsBefore,
    `${viewsBefore} -> ${viewsAfter}`,
  );

  // Download from inside the preview.
  const dlButton = page
    .locator('[role="dialog"] button, [data-state="open"] button')
    .filter({ hasText: /télécharger|download|تنزيل/i })
    .first();
  const hasDl = (await dlButton.count()) > 0;
  check("download is offered for an allowed resource", hasDl);
  if (hasDl) {
    await clearOpened();
    await dlButton.click();
    await page.waitForTimeout(2500);
    const opened = await openedUrls();
    check(
      "the download URL is signed AND marked as an attachment",
      opened.some((u) => /\/storage\/v1\/object\/sign\//.test(u) && /[?&]download=/.test(u)),
      JSON.stringify(opened).slice(0, 200),
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // allow_download = false: preview yes, attachment no.
  await page.locator("text=e2e-no-download").first().click();
  await page.waitForTimeout(2500);
  const noDlPreview = await page
    .locator('iframe, [role="dialog"] iframe')
    .first()
    .getAttribute("src")
    .catch(() => null);
  check(
    "a no-download resource can still be PREVIEWED",
    typeof noDlPreview === "string" && /\/storage\/v1\/object\/sign\//.test(noDlPreview),
    String(noDlPreview).slice(0, 120),
  );
  const noDlButton = await page
    .locator('[role="dialog"] button, [data-state="open"] button')
    .filter({ hasText: /télécharger|download|تنزيل/i })
    .count();
  check("no download button is offered for it", noDlButton === 0, `${noDlButton} buttons`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // And the server refuses even when the button is bypassed. The UI cannot be
  // asked to do this, so ask the database the same question the server asks.
  const sTok = await (async () => {
    const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: fx.student.email, password: fx.student.password }),
    });
    return (await r.json()).access_token;
  })();
  const refused = await fetch(`${API}/rest/v1/rpc/can_download_resource`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${sTok}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ _resource_id: rNoDl }),
  });
  check(
    "hiding the button is not the control: the database refuses too",
    (await refused.json()) === false,
  );

  /* --------------------------- unauthorised --------------------------- */
  console.log("\n--- unauthorised access ---");
  await login(other.teacher.email, other.teacher.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  body = await page.locator("body").innerText();
  check(
    "a teacher of another group sees none of these resources",
    !/e2e-open-me/.test(body) && !/e2e-no-download/.test(body),
    body.slice(0, 200),
  );

  console.log("\n--- admin ---");
  await login(fx.admin.email, fx.admin.password);
  await page.goto(`${APP}/dashboard/resources`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  body = await page.locator("body").innerText();
  check("admin sees the resources", /e2e-open-me/.test(body), body.slice(0, 200));
} finally {
  await browser.close();
  await sql(`delete from public.resources where title like 'e2e-%';`);
  // Rows go, but the objects they pointed at would keep counting against the
  // centre quota -- which is measured from storage.objects, not from `resources`.
  // `storage.protect_delete()` refuses a direct DELETE, so it has to be the API.
  await removeObjects(`${group.id}/`);
  await fx.cleanup();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
process.exit(fail > 0 ? 1 : 0);
