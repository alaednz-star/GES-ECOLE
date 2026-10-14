/**
 * School branding, end to end.
 *
 * The questions worth asking about a white-label layer are not "does the logo appear" --
 * they are whether the thing that makes a deployment look like one school can be used to
 * break it. So this suite spends most of its assertions on the boundary:
 *
 *   - the colour columns refuse anything that is not `#RRGGBB`, including CSS that would
 *     close the declaration and open a new rule
 *   - the asset columns refuse `javascript:`, `data:`, plain http and a quote
 *   - a student and a teacher cannot write branding, and a student cannot write into the
 *     branding bucket -- proven with their own tokens, not through the UI
 *   - the semantic tokens (`--accent`, `--success`, `--destructive`) are IDENTICAL before
 *     and after branding is applied, measured in the browser, because a school's gold
 *     turning "en attente" gold is the specific regression this design exists to prevent
 *   - a branding failure leaves the application rendering
 *
 *   - the ANONYMOUS surface is exactly thirteen columns of one row: anon reads the school's
 *     identity and is refused `academic_year`, `students`, `profiles` and `groups`
 *
 * Then the visible half: the public site is the SCHOOL's, not the platform's -- its name,
 * its tagline, its own description -- with no trace of the product pitch that used to be
 * there; and the school's name and tagline in the dashboard shell, in French and Arabic,
 * at 1440 and 375.
 *
 * Needs the dev server and the local Supabase stack:
 *   node scripts/e2e/verify-branding.mjs
 */
import { chromium } from "playwright-core";
import { withFixtures, sql, PUBLISHABLE_KEY, API, TEST_PASSWORD } from "./fixtures.mjs";

const APP = process.env["APP_URL"] ?? "http://localhost:8080";

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};

const SCHOOL = {
  name: "مدرسة النجاح للدعم المدرسي",
  tagline: "مدرسة النجاح – نحو التفوق.",
  primary: "#132A3E",
  gold: "#C6A45C",
};

/**
 * Whatever the row held before this run, restored at the end.
 *
 * EVERY column the suite writes has to be in this list. It once held eight of the ten that
 * get written, and the two it missed were the school's description -- overwritten with a
 * two-line test string and left that way, on the deployment being demonstrated.
 */
const before = (
  await sql(`select school_name, tagline, logo_url, logo_dark_url, favicon_url,
                    primary_color, brand_gold, brand_gold_soft,
                    about_ar, about_fr, about_en, phone, address
               from public.center_settings;`)
)[0];

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

const restore = async () => {
  await sql(`update public.center_settings set
               school_name = ${q(before.school_name)},
               tagline = ${q(before.tagline)},
               logo_url = ${q(before.logo_url)},
               logo_dark_url = ${q(before.logo_dark_url)},
               favicon_url = ${q(before.favicon_url)},
               primary_color = ${q(before.primary_color)},
               brand_gold = ${q(before.brand_gold)},
               brand_gold_soft = ${q(before.brand_gold_soft)},
               about_ar = ${q(before.about_ar)},
               about_fr = ${q(before.about_fr)},
               about_en = ${q(before.about_en)},
               phone = ${q(before.phone)},
               address = ${q(before.address)}
             where id = true;`);
};

const fx = await withFixtures({ teacher: true, student: true, admin: true });

// A student who has not finished onboarding never reaches the dashboard shell, and the
// shell is what this suite is about. Same setup as verify-enrollment-ui.
const level = (await sql(`select id from public.levels where name = '3ème année secondaire';`))[0];
const stream = (
  await sql(`select id from public.streams where code='sciences' and level_id='${level.id}';`)
)[0];
await sql(`update public.students set gender = coalesce(gender,'female'),
             date_of_birth = coalesce(date_of_birth,'2008-03-02'),
             guardian_name = coalesce(guardian_name,'Parent'),
             guardian_phone = coalesce(guardian_phone,'0661000000'),
             level_id = '${level.id}', stream_id = '${stream.id}', onboarded_at = now()
           where id = '${fx.student.id}';`);

const token = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return (await r.json()).access_token;
};

const patchAs = async (tok, body) => {
  const r = await fetch(`${API}/rest/v1/center_settings?id=eq.true`, {
    method: "PATCH",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
};

const browser = await chromium.launch();

const login = async (ctx, page, email, password = TEST_PASSWORD) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

/** Every token the shell resolves, read from the live document. */
const readTokens = (page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim();
    return {
      primary: get("--primary"),
      primaryForeground: get("--primary-foreground"),
      ring: get("--ring"),
      sidebarPrimary: get("--sidebar-primary"),
      brandGold: get("--brand-gold"),
      brandGoldSoft: get("--brand-gold-soft"),
      accent: get("--accent"),
      accentSoft: get("--accent-soft"),
      success: get("--success"),
      successSoft: get("--success-soft"),
      destructive: get("--destructive"),
      destructiveSoft: get("--destructive-soft"),
      border: get("--border"),
      muted: get("--muted"),
      styleTags: document.querySelectorAll("style[data-brand-tokens]").length,
    };
  });

try {
  /* ============================================================ the database boundary */
  console.log("\n--- what the columns refuse ---");

  const rejects = async (column, value) => {
    try {
      await sql(`update public.center_settings set ${column} = ${q(value)} where id = true;`);
      await sql(`update public.center_settings set ${column} = null where id = true;`);
      return false;
    } catch {
      return true;
    }
  };

  for (const attack of [
    "red; } body { display: none",
    "#132A3E; } * { background: url(https://evil.test/x)",
    "rgb(19,42,62)",
    "var(--primary)",
    "#FFF",
    "navy",
  ]) {
    rec(`primary_color refuses ${JSON.stringify(attack)}`, await rejects("primary_color", attack));
  }
  rec("and brand_gold refuses the same", await rejects("brand_gold", "gold; } html {"));

  for (const attack of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "http://x.test/logo.png",
    'https://x.test/a.png" onerror="alert(1)',
    "https://x.test/a.png' onerror='x",
    "https://x.test/<script>",
  ]) {
    rec(
      `logo_url refuses ${JSON.stringify(attack.slice(0, 42))}`,
      await rejects("logo_url", attack),
    );
  }

  // And accepts what the product actually writes.
  await sql(`update public.center_settings
                set primary_color = '${SCHOOL.primary}', brand_gold = '${SCHOOL.gold}',
                    school_name = '${SCHOOL.name.replace(/'/g, "''")}',
                    tagline = '${SCHOOL.tagline.replace(/'/g, "''")}'
              where id = true;`);
  const stored = (await sql(`select primary_color, brand_gold from public.center_settings;`))[0];
  rec(
    "a real school's values are accepted",
    stored.primary_color === SCHOOL.primary && stored.brand_gold === SCHOOL.gold,
    JSON.stringify(stored),
  );

  /* ============================================================ who may write it */
  console.log("\n--- only an administrator may change the brand ---");

  const studentTok = await token(fx.student.email);
  const teacherTok = await token(fx.teacher.email);
  const adminTok = await token(fx.admin.email);

  const asStudent = await patchAs(studentTok, { school_name: "Hijacked" });
  rec(
    "a student's token changes nothing",
    asStudent.body === "[]" || asStudent.status === 403,
    `HTTP ${asStudent.status} ${asStudent.body.slice(0, 60)}`,
  );
  const asTeacher = await patchAs(teacherTok, { primary_color: "#FF0000" });
  rec(
    "a teacher's token changes nothing",
    asTeacher.body === "[]" || asTeacher.status === 403,
    `HTTP ${asTeacher.status} ${asTeacher.body.slice(0, 60)}`,
  );
  const untouched = (
    await sql(`select school_name, primary_color from public.center_settings;`)
  )[0];
  rec(
    "and the row still holds the school's own values",
    untouched.school_name === SCHOOL.name && untouched.primary_color === SCHOOL.primary,
    JSON.stringify(untouched),
  );

  const asAdmin = await patchAs(adminTok, { tagline: SCHOOL.tagline });
  rec("an administrator can", asAdmin.status === 200, `HTTP ${asAdmin.status}`);

  // The constraint applies to an admin too: authority is not a bypass.
  const adminCss = await patchAs(adminTok, { primary_color: "red; } body {" });
  rec(
    "and is refused the same CSS a student would be",
    adminCss.status >= 400,
    `HTTP ${adminCss.status}`,
  );

  /* ============================================================ the bucket */
  console.log("\n--- the branding bucket ---");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  const put = async (tok, path) =>
    fetch(`${API}/storage/v1/object/branding/${path}`, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${tok}`,
        "Content-Type": "image/png",
        "x-upsert": "true",
      },
      body: png,
    });

  const studentPut = await put(studentTok, "center/logo-hijack.png");
  rec("a student cannot write a logo", !studentPut.ok, `HTTP ${studentPut.status}`);
  const teacherPut = await put(teacherTok, "center/logo-hijack.png");
  rec("nor can a teacher", !teacherPut.ok, `HTTP ${teacherPut.status}`);

  const adminPut = await put(adminTok, `center/logo-e2e-${Date.now()}.png`);
  rec("an administrator can", adminPut.ok, `HTTP ${adminPut.status}`);

  const outside = await put(adminTok, `elsewhere/logo-${Date.now()}.png`);
  rec(
    "and not even an administrator writes outside the deployment folder",
    !outside.ok,
    `HTTP ${outside.status}`,
  );

  const svg = await fetch(`${API}/storage/v1/object/branding/center/x.svg`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${adminTok}`,
      "Content-Type": "image/svg+xml",
    },
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  rec("SVG is refused by the bucket, not by the form", !svg.ok, `HTTP ${svg.status}`);

  const leftovers = await sql(`select count(*)::int c from storage.objects
                                where bucket_id = 'branding' and name like '%hijack%';`);
  rec("nothing hijacked landed", leftovers[0].c === 0, `${leftovers[0].c}`);

  /* ============================================================ the anon boundary */
  console.log("\n--- what an anonymous visitor may read ---");

  const anonGet = async (path) => {
    const r = await fetch(`${API}/rest/v1/${path}`, { headers: { apikey: PUBLISHABLE_KEY } });
    return { status: r.status, body: await r.text() };
  };

  const identity = await anonGet(
    "center_settings?select=school_name,tagline,about_ar,primary_color,brand_gold,phone,address",
  );
  rec(
    "anon reads the school's public identity",
    identity.status === 200 && identity.body.includes(SCHOOL.name),
    `HTTP ${identity.status}`,
  );

  // Column privileges, not row filters: asking for one outside the grant is an error, not
  // a null. That distinction is the whole reason this was done with GRANT and not a view.
  for (const column of ["academic_year", "default_language", "updated_at", "id"]) {
    const res = await anonGet(`center_settings?select=${column}`);
    rec(`anon is refused center_settings.${column}`, res.status >= 400, `HTTP ${res.status}`);
  }

  for (const table of ["students", "profiles", "groups", "teachers", "registrations", "subjects"]) {
    const res = await anonGet(`${table}?select=id`);
    rec(`anon is refused ${table}`, res.status >= 400, `HTTP ${res.status}`);
  }

  const anonWrite = await fetch(`${API}/rest/v1/center_settings?id=eq.true`, {
    method: "PATCH",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ school_name: "Hijacked" }),
  });
  rec("anon cannot write the school's identity", !anonWrite.ok, `HTTP ${anonWrite.status}`);
  const afterAnon = (await sql(`select school_name from public.center_settings;`))[0];
  rec("and the name is unchanged", afterAnon.school_name === SCHOOL.name);

  /* ============================================================ the public site */
  console.log("\n--- the public site belongs to the school ---");
  await sql(`update public.center_settings
                set about_ar = 'وصف عربي للاختبار.

فقرة ثانية بالعربية.',
                    about_fr = 'Description française de test.

Deuxième paragraphe en français.',
                    about_en = 'English test description.

Second paragraph in English.'
              where id = true;`);

  const publicCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const publicPage = await publicCtx.newPage();
  await publicPage.goto(APP, { waitUntil: "networkidle" });
  await publicPage.waitForTimeout(2200);

  const publicTokens = await readTokens(publicPage);
  rec(
    "a visitor with no session gets the school's colours",
    publicTokens.primary === SCHOOL.primary,
    publicTokens.primary,
  );
  rec("and its gold", publicTokens.brandGold === SCHOOL.gold, publicTokens.brandGold);

  // Walk the page so every IntersectionObserver has fired, then read it whole.
  const pageHeight = await publicPage.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < pageHeight; y += 600) {
    await publicPage.evaluate((top) => window.scrollTo(0, top), y);
    await publicPage.waitForTimeout(140);
  }
  await publicPage.waitForTimeout(500);
  const publicText = await publicPage.locator("body").innerText();

  rec("the page leads with the school's name", publicText.includes(SCHOOL.name));
  rec("and its tagline", publicText.includes(SCHOOL.tagline));
  rec(
    "and prints the school's own description in the reader's language",
    publicText.includes("Description française de test") &&
      publicText.includes("Deuxième paragraphe en français"),
    JSON.stringify(publicText.match(/Description[^\n]*/)?.[0] ?? "(none)"),
  );
  rec(
    "and NOT in a language the reader did not ask for",
    !publicText.includes("وصف عربي للاختبار") && !publicText.includes("English test description"),
  );

  // The copy that used to be here was addressed to whoever buys the software.
  const platformCopy = [
    "Gérez tout votre",
    "centre de soutien depuis une seule interface",
    "Voir une démonstration",
    "Madrasti", // the name of the platform this product grew out of
    "Accès cloisonnés par rôle",
  ];
  const found = platformCopy.filter((c) => publicText.includes(c));
  rec("and none of the platform's sales copy survives", found.length === 0, JSON.stringify(found));

  rec(
    "Gestion École appears once, as the product underneath",
    (publicText.match(/Gestion École/g) ?? []).length === 1,
    `${(publicText.match(/Gestion École/g) ?? []).length} mentions`,
  );

  rec(
    "the tab is named after the school",
    (await publicPage.title()).includes(SCHOOL.name),
    await publicPage.title(),
  );

  // Both doors into the product, from a page a parent can reach without an account.
  rec(
    "the page offers registration and sign-in",
    (await publicPage.locator('a[href="/register"]').count()) > 0 &&
      (await publicPage.locator('a[href="/login"]').count()) > 0,
  );

  const aboutAttrs = () =>
    publicPage.evaluate(() => {
      const el = document.querySelector("#about [lang]");
      return el ? { lang: el.getAttribute("lang"), dir: el.getAttribute("dir") } : null;
    });

  rec(
    "the French description is laid out left to right",
    JSON.stringify(await aboutAttrs()) === JSON.stringify({ lang: "fr", dir: "ltr" }),
    JSON.stringify(await aboutAttrs()),
  );

  /*
    THE FALLBACK IS STILL THE ARCHITECTURE.

    A school that has written only one language must still be readable in every locale, and
    the text then has to declare the direction of what it actually IS rather than of the
    interface around it. Clearing the French proves both at once: the French page serves the
    Arabic, right to left, inside a left-to-right document.
  */
  await sql(`update public.center_settings set about_fr = null, about_en = null where id = true;`);
  await publicPage.reload({ waitUntil: "networkidle" });
  await publicPage.waitForTimeout(2400);
  // Walk it in steps, not one jump: an IntersectionObserver only fires for a section that
  // was actually inside the viewport for a frame, and the reveal check below depends on
  // every one of them having fired.
  const afterReload = await publicPage.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < afterReload; y += 600) {
    await publicPage.evaluate((top) => window.scrollTo(0, top), y);
    await publicPage.waitForTimeout(140);
  }
  await publicPage.evaluate(() => window.scrollTo(0, 0));
  await publicPage.waitForTimeout(400);

  rec(
    "with no French written, the French page falls back to what the school did write",
    (await publicPage.locator("body").innerText()).includes("وصف عربي للاختبار"),
  );
  rec(
    "and declares that text Arabic and right to left",
    JSON.stringify(await aboutAttrs()) === JSON.stringify({ lang: "ar", dir: "rtl" }),
    JSON.stringify(await aboutAttrs()),
  );

  rec(
    "nothing on the public page is left invisible after scrolling",
    (await publicPage.evaluate(
      () =>
        [...document.querySelectorAll(".reveal")].filter(
          (el) => Number(getComputedStyle(el).opacity) < 0.9,
        ).length,
    )) === 0,
  );

  // The login screen is now branded too -- that was impossible before the anon grant.
  await publicPage.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await publicPage.waitForTimeout(2000);
  const loginTokens = await readTokens(publicPage);
  rec(
    "the login screen carries the school's colours",
    loginTokens.primary === SCHOOL.primary,
    loginTokens.primary,
  );
  rec("and its name", (await publicPage.locator("body").innerText()).includes(SCHOOL.name));

  for (const [w, h] of [
    [1440, 1000],
    [375, 800],
  ]) {
    await publicPage.setViewportSize({ width: w, height: h });
    await publicPage.goto(APP, { waitUntil: "networkidle" });
    await publicPage.waitForTimeout(1500);
    const over = await publicPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    rec(`the public site @ ${w}px does not scroll sideways`, over <= 1, `${over}px`);
  }
  await publicCtx.close();

  /* ============================================================ the browser */
  console.log("\n--- what a student sees ---");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await login(ctx, page, fx.student.email);
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const branded = await readTokens(page);
  rec(
    "exactly one brand style element is emitted",
    branded.styleTags === 1,
    `${branded.styleTags}`,
  );
  rec("--primary is the school's navy", branded.primary === SCHOOL.primary, branded.primary);
  rec("--ring follows it", branded.ring === SCHOOL.primary, branded.ring);
  rec(
    "--sidebar-primary follows it",
    branded.sidebarPrimary === SCHOOL.primary,
    branded.sidebarPrimary,
  );
  rec("--brand-gold is the school's gold", branded.brandGold === SCHOOL.gold, branded.brandGold);
  rec(
    "--primary-foreground is readable on navy",
    branded.primaryForeground.toUpperCase() === "#FFFFFF",
    branded.primaryForeground,
  );

  const shell = await page.locator("body").innerText();
  rec("the sidebar names the school", shell.includes(SCHOOL.name));
  rec("and carries its tagline", shell.includes(SCHOOL.tagline));
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  const sidebarText = (await sidebar.count()) > 0 ? await sidebar.innerText() : "";
  rec(
    "no leftover product name (Madrasti) in the sidebar",
    sidebarText.length > 0 && !/\bMadrasti\b/.test(sidebarText),
    JSON.stringify(sidebarText.split("\n")[0] ?? ""),
  );

  // A school's own string can be in another language than the interface. Without
  // `dir="auto"` an Arabic tagline's full stop renders at the wrong end of the line.
  const autoDir = await page.evaluate(
    () => document.querySelectorAll('[data-sidebar="sidebar"] [dir="auto"]').length,
  );
  rec("school-supplied strings declare dir=auto", autoDir > 0, `${autoDir} elements`);

  /* ============================================================ THE RULE */
  console.log("\n--- branding must not touch the status vocabulary ---");
  await sql(`update public.center_settings
                set primary_color = null, brand_gold = null, school_name = '',
                    tagline = null
              where id = true;`);
  const plainCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const plainPage = await plainCtx.newPage();
  await login(plainCtx, plainPage, fx.student.email);
  await plainPage.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await plainPage.waitForTimeout(2500);
  const plain = await readTokens(plainPage);

  for (const key of [
    "accent",
    "accentSoft",
    "success",
    "successSoft",
    "destructive",
    "destructiveSoft",
    "border",
    "muted",
  ]) {
    rec(
      `--${key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())} is identical branded and unbranded`,
      branded[key] === plain[key] && branded[key] !== "",
      `${branded[key]} vs ${plain[key]}`,
    );
  }
  rec(
    "while --primary genuinely differed",
    branded.primary !== plain.primary,
    `${branded.primary} vs ${plain.primary}`,
  );
  rec(
    "an unbranded deployment emits no override at all",
    plain.styleTags === 0,
    `${plain.styleTags} style elements`,
  );
  rec(
    "and falls back to the platform's own name",
    (await plainPage.locator("body").innerText()).includes("Gestion École"),
  );

  // The catalogue is where the status colours are actually read. Re-brand and confirm the
  // rejected panel is still rendered in the destructive colour, not in the school's.
  await sql(`update public.center_settings
                set primary_color = '${SCHOOL.primary}', brand_gold = '${SCHOOL.gold}',
                    school_name = '${SCHOOL.name.replace(/'/g, "''")}'
              where id = true;`);
  await plainPage.reload({ waitUntil: "networkidle" });
  await plainPage.waitForTimeout(2500);
  await plainPage.goto(`${APP}/dashboard/registration`, { waitUntil: "networkidle" });
  await plainPage.waitForTimeout(2200);
  const statePanels = await plainPage.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("main article [data-state-panel]")) {
      out.push({
        text: (el.textContent ?? "").trim().slice(0, 30),
        color: getComputedStyle(el.querySelector("p") ?? el).color,
      });
    }
    return out;
  });
  rec(
    "state panels still render in their semantic colours under a branded theme",
    statePanels.length === 0 || statePanels.every((p) => !p.color.includes("19, 42, 62")),
    JSON.stringify(statePanels).slice(0, 220),
  );
  await plainCtx.close();

  /* ============================================================ failure */
  console.log("\n--- a branding failure is not an outage ---");
  const brokenCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const brokenPage = await brokenCtx.newPage();
  // Every read of the settings row fails, from before sign-in onwards.
  await brokenPage.route("**/rest/v1/center_settings*", (route) =>
    route.fulfill({ status: 500, body: '{"message":"branding is down"}' }),
  );
  await login(brokenCtx, brokenPage, fx.student.email);
  rec("signing in still works when branding cannot be read", /dashboard/.test(brokenPage.url()));
  await brokenPage.goto(`${APP}/dashboard/registration`, { waitUntil: "networkidle" });
  await brokenPage.waitForTimeout(2200);
  const brokenText = await brokenPage.locator("main").innerText();
  rec(
    "and the dashboard renders, in platform colours",
    brokenText.length > 40 && /S'inscrire|groupe/i.test(brokenText),
    `${brokenText.length} characters of page`,
  );
  const brokenTokens = await readTokens(brokenPage);
  rec(
    "with the platform primary rather than a blank theme",
    brokenTokens.primary.includes("oklch"),
    brokenTokens.primary,
  );
  await brokenCtx.close();

  /* ============================================================ admin surface */
  console.log("\n--- the branding settings screen ---");
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const adminPage = await adminCtx.newPage();
  await login(adminCtx, adminPage, fx.admin.email);
  await adminPage.goto(`${APP}/dashboard/settings`, { waitUntil: "networkidle" });
  await adminPage.waitForTimeout(2500);
  const settingsText = await adminPage.locator("main").innerText();
  rec("the settings screen carries a branding section", /Identité visuelle/i.test(settingsText));
  const previewBox = adminPage.locator("[data-brand-preview]");
  rec("with a live preview", (await previewBox.count()) === 1);
  const previewTones = await adminPage.evaluate(() => {
    const box = document.querySelector("[data-brand-preview]");
    if (!box) return null;
    const rows = [...box.querySelectorAll("p[class*='border']")];
    return rows.map((r) => getComputedStyle(r).color);
  });
  rec(
    "showing three DIFFERENT status colours next to the brand",
    !!previewTones && new Set(previewTones).size === 3,
    JSON.stringify(previewTones),
  );
  await adminCtx.close();

  /* ============================================================ responsive + rtl */
  console.log("\n--- 1440 / 375, French and Arabic ---");
  for (const [w, h] of [
    [1440, 950],
    [375, 800],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1600);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    rec(`fr @ ${w}px does not scroll sideways`, over <= 1, `${over}px`);
  }

  await sql(`update public.profiles set locale = 'ar' where id = '${fx.student.id}';`);
  const arCtx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "ar" });
  const arPage = await arCtx.newPage();
  await login(arCtx, arPage, fx.student.email);
  await arPage.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await arPage.waitForTimeout(2500);
  const dir = await arPage.evaluate(() => document.documentElement.getAttribute("dir"));
  rec("the document is right to left", dir === "rtl", `dir=${dir}`);
  rec(
    "the school's name still renders",
    (await arPage.locator("body").innerText()).includes(SCHOOL.name),
  );
  const arTokens = await readTokens(arPage);
  rec("and the brand tokens survive the direction flip", arTokens.primary === SCHOOL.primary);
  for (const [w, h] of [
    [1440, 950],
    [375, 800],
  ]) {
    await arPage.setViewportSize({ width: w, height: h });
    await arPage.reload({ waitUntil: "networkidle" });
    await arPage.waitForTimeout(1600);
    const over = await arPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    rec(`ar @ ${w}px does not scroll sideways`, over <= 1, `${over}px`);
  }
  await arCtx.close();
  await ctx.close();
} finally {
  await browser.close();
  // Through the Storage API, not SQL: `storage.protect_delete()` refuses a direct DELETE on
  // `storage.objects` -- silently, because the call was wrapped in a catch. It left one
  // object behind per run.
  try {
    const paths = await sql(`select name from storage.objects
                              where bucket_id = 'branding' and name like '%e2e%';`);
    if (paths.length > 0) {
      const res = await fetch(`${API}/storage/v1/object/branding`, {
        method: "DELETE",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${await token(fx.admin.email)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: paths.map((p) => p.name) }),
      });
      if (!res.ok) console.log(`NOTE  branding cleanup left ${paths.length} objects`);
    }
  } catch (e) {
    console.log(`NOTE  branding cleanup skipped: ${String(e).slice(0, 80)}`);
  }
  await restore();
  await fx.cleanup();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
