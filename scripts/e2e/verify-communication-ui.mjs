/**
 * Communication end to end (ADR-009): Actualités, Messagerie, E-mail & SMS, Rappels & alertes.
 *
 *   - the administrator has the four entries; a student has News and Messages only
 *   - the administrator publishes a pinned post to a group: it is the student's top story, the
 *     student opens and likes it, the author sees the view; a teacher's draft stays private
 *   - a student writes to their teacher, the teacher sees it unread, replies with Enter, the
 *     student reads the reply; the administrator supervises it read-only
 *   - an SMS to the group's guardians reaches the one guardian phone; the row is marked sent
 *   - the absences rule finds the student, a run sends the notice once
 *   - the four pages read right to left on a phone
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API); needs the dev server (BASE_URL,
 * default http://localhost:8080). Reminder rules are put back as they were at the end.
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e/verify-communication-ui.mjs
 */

import { chromium } from "playwright-core";
import { withFixtures, cleanupFixtures, sql } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = process.env.SHOT_DIR ?? null;
const TAG = "e2e-fixture";
const RUN = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const GROUP = `${TAG} COM Groupe ${RUN}`;
const POST = `${TAG} Sortie au musée ${RUN}`;
const DRAFT = `${TAG} Brouillon prof ${RUN}`;
const NNBSP = /[  ]/g;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
  timezoneId: "UTC",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.stack || e.message));

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const one = async (q) => (await sql(q))[0];
const dialog = () => page.getByRole("dialog");
const text = async (loc) => ((await loc.textContent()) ?? "").replace(NNBSP, " ").trim();
const rulesBefore = await sql(
  `select kind, enabled, threshold, channels from public.reminder_rules`,
);

async function login(who) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}
const waitClosed = () => dialog().waitFor({ state: "detached", timeout: 30000 });

try {
  for (const u of [fx.admin, fx.teacher, fx.student]) {
    await sql(`update public.profiles set locale = 'fr' where id = '${u.id}';`);
  }
  await sql(
    `update public.profiles set full_name = 'Amina Com ${RUN}' where id = '${fx.student.id}';`,
  );
  await sql(
    `update public.profiles set full_name = 'Prof Com ${RUN}' where id = '${fx.teacher.id}';`,
  );
  await sql(`update public.students set level_id = (select id from public.levels order by name limit 1), gender = 'female',
      date_of_birth = '2009-04-12', guardian_name = 'Parent', guardian_phone = '0550000077', onboarded_at = now()
      where id = '${fx.student.id}';`);
  const g =
    await one(`insert into public.groups (name, max_students, teacher_id, status, start_date)
      values ('${GROUP}', 12, '${fx.teacher.id}', 'active', current_date - 20) returning id::text id;`);
  await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time)
      select '${g.id}', d, '08:00', '09:00' from generate_series(0, 6) d;`);
  await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
      values ('${fx.student.id}', '${g.id}', 'approved', now());`);
  await sql(`insert into public.attendance (group_id, student_id, session_date, status, marked_by) values
      ('${g.id}', '${fx.student.id}', current_date - 2, 'absent', '${fx.admin.id}'),
      ('${g.id}', '${fx.student.id}', current_date - 1, 'absent', '${fx.admin.id}');`);

  /* ------------------------------------------------------------------ 1. sidebar */
  console.log("\n--- 1. entries per role ---");
  await login(fx.admin);
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await sidebar.locator('a[href="/dashboard/payments"]').waitFor({ timeout: 30000 });
  const adminLinks = [];
  for (const h of [
    "/dashboard/news",
    "/dashboard/messaging",
    "/dashboard/email-sms",
    "/dashboard/reminders",
  ]) {
    adminLinks.push(await sidebar.locator(`a[href="${h}"]`).count());
  }
  check(
    "the administrator has News, Messages, E-mail & SMS and Reminders",
    adminLinks.every((n) => n === 1),
    JSON.stringify(adminLinks),
  );

  /* ------------------------------------------------------------------ 2. news */
  console.log("\n--- 2. Actualités ---");
  await page.goto(`${BASE}/dashboard/news`);
  await page.getByTestId("news-add").click();
  await dialog().waitFor();
  await page.getByTestId("news-title").fill(POST);
  await page.getByTestId("news-summary").fill("Samedi matin, départ à 9 h");
  await page
    .getByTestId("news-body")
    .fill("Rendez-vous devant l'établissement.\n\nPensez à l'autorisation parentale.");
  await page.getByTestId("news-category").click();
  await page.getByRole("option", { name: "Événement" }).click();
  await page.getByTestId("news-audience-type").click();
  await page.getByRole("option", { name: "Groupe", exact: true }).click();
  await page.getByTestId("news-audience-target").click();
  await page.getByRole("option", { name: GROUP }).click();
  await page.getByTestId("news-pinned").click();
  await page.getByTestId("news-save").click();
  await page.getByTestId("news-article").waitFor({ timeout: 30000 });
  const post =
    await one(`select id::text id, status, pinned, (select count(*) from public.news_recipients r where r.post_id = p.id)::int n
      from public.news_posts p where title = '${POST}'`);
  check(
    "the administrator publishes a pinned post to the group (its student and teacher)",
    post?.status === "published" && post?.pinned === true && post?.n === 2,
    JSON.stringify(post),
  );
  check(
    "the article shows its paragraphs and the views out of recipients",
    (await page.getByTestId("news-article-body").locator("p").count()) === 2 &&
      (await text(page.getByTestId("news-article-views"))).includes("0 sur 2"),
    await text(page.getByTestId("news-article-views")),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comm-article.png`, fullPage: true });

  await login(fx.teacher);
  await page.goto(`${BASE}/dashboard/news`);
  await page.getByTestId("news-add").click();
  await dialog().waitFor();
  await page.getByTestId("news-title").fill(DRAFT);
  await page.getByTestId("news-body").fill("À relire.");
  await page.getByTestId("news-audience-target").click();
  await page.getByRole("option", { name: GROUP }).click();
  await dialog()
    .locator("label", { has: page.getByTestId("news-mode-draft") })
    .click();
  await page.getByTestId("news-save").click();
  await page.getByTestId("news-article").waitFor({ timeout: 30000 });
  await page.goto(`${BASE}/dashboard/news`);
  await page.getByTestId("news-tab-mine").click();
  await page.getByTestId("news-mine").waitFor({ timeout: 30000 });
  check(
    "a teacher's draft is in their « Mes publications », as a draft",
    (await page.getByTestId("news-mine").getByText(DRAFT).count()) === 1 &&
      (await one(`select status from public.news_posts where title = '${DRAFT}'`))?.status ===
        "draft",
  );

  await login(fx.student);
  const studentSidebar = page.locator('[data-sidebar="sidebar"]').first();
  await studentSidebar.waitFor({ timeout: 30000 });
  check(
    "a student has News and Messages, not the administration's pages",
    (await studentSidebar.locator('a[href="/dashboard/news"]').count()) === 1 &&
      (await studentSidebar.locator('a[href="/dashboard/messaging"]').count()) === 1 &&
      (await studentSidebar
        .locator('a[href="/dashboard/email-sms"], a[href="/dashboard/reminders"]')
        .count()) === 0,
  );
  await page.goto(`${BASE}/dashboard/news`);
  await page.getByTestId("news-hero").waitFor({ timeout: 30000 });
  check(
    "the pinned post is the student's top story, marked new",
    (await page.getByTestId("news-hero").getAttribute("data-post")) === post.id &&
      (await text(page.getByTestId("news-hero"))).includes("Nouveau"),
  );
  check(
    "the teacher's draft is not visible to the student",
    (await page.getByText(DRAFT).count()) === 0,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comm-news.png`, fullPage: true });
  await page.getByTestId("news-hero").click();
  await page.getByTestId("news-like").waitFor({ timeout: 30000 });
  await page.getByTestId("news-like").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="news-like"]')?.getAttribute("aria-pressed") === "true",
    null,
    { timeout: 30000 },
  );
  const reader =
    await one(`select read_at is not null r, liked_at is not null l from public.news_recipients
      where post_id = '${post.id}' and user_id = '${fx.student.id}'`);
  check(
    "opening the post records the view, and the like is saved",
    reader?.r === true && reader?.l === true,
    JSON.stringify(reader),
  );

  /* ------------------------------------------------------------------ 3. messaging */
  console.log("\n--- 3. Messagerie ---");
  await page.goto(`${BASE}/dashboard/messaging`);
  await page.getByTestId("chat-new").click();
  await dialog().waitFor();
  await page
    .getByTestId("chat-contacts")
    .locator(`[data-user="${fx.teacher.id}"]`)
    .waitFor({ timeout: 30000 });
  check(
    "a student's contacts include their teacher",
    (await page.getByTestId("chat-contacts").locator(`[data-user="${fx.teacher.id}"]`).count()) ===
      1,
  );
  await page.getByTestId("chat-contacts").locator(`[data-user="${fx.teacher.id}"]`).click();
  await page.getByTestId("chat-body").fill("Bonjour, je serai absente samedi.");
  await page.getByTestId("chat-start").click();
  await waitClosed();
  await page.getByTestId("chat-message").first().waitFor({ timeout: 30000 });
  const conv =
    await one(`select c.id::text id from public.conversations c join public.conversation_participants p
      on p.conversation_id = c.id where p.user_id = '${fx.student.id}' limit 1`);
  check(
    "the student's message opens in the thread",
    (await page.locator('[data-testid="chat-message"][data-mine="true"]').count()) === 1,
  );

  await login(fx.teacher);
  await page.goto(`${BASE}/dashboard/messaging`);
  const row = page.locator(`[data-testid="chat-row"][data-conversation="${conv.id}"]`);
  await row.waitFor({ timeout: 30000 });
  check(
    "the teacher sees it unread",
    (await row.getAttribute("data-unread")) === "1",
    await row.getAttribute("data-unread"),
  );
  await row.click();
  await page.getByTestId("chat-input").waitFor({ timeout: 30000 });
  await page.getByTestId("chat-input").fill("Merci de prévenir, bon week-end.");
  await page.getByTestId("chat-input").press("Enter");
  await page
    .locator('[data-testid="chat-message"][data-mine="true"]')
    .first()
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const unreadAfter =
    await one(`select (select count(*) from public.messages where conversation_id = '${conv.id}')::int n,
      (select last_read_at is not null from public.conversation_participants where conversation_id = '${conv.id}' and user_id = '${fx.teacher.id}') r`);
  check(
    "Enter sends the reply, and opening the thread marked it read",
    unreadAfter?.n === 2 && unreadAfter?.r === true,
    JSON.stringify(unreadAfter),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comm-chat.png`, fullPage: true });

  await login(fx.student);
  await page.goto(`${BASE}/dashboard/messaging?c=${conv.id}`);
  await page
    .locator('[data-testid="chat-message"][data-mine="false"]')
    .first()
    .waitFor({ timeout: 30000 });
  check(
    "the student reads the reply",
    (await page.getByTestId("chat-thread").getByText("bon week-end").count()) === 1,
  );

  await login(fx.admin);
  await page.goto(`${BASE}/dashboard/messaging`);
  await page.getByTestId("chat-supervise").click();
  const supRow = page.locator(`[data-testid="chat-row"][data-conversation="${conv.id}"]`);
  await supRow.waitFor({ timeout: 30000 });
  await supRow.click();
  await page.getByTestId("chat-thread").waitFor({ timeout: 30000 });
  check(
    "the administrator supervises it, read-only",
    (await page.getByTestId("chat-input").count()) === 0 &&
      (await page.getByText("en supervision").count()) >= 1,
  );

  /* ------------------------------------------------------------------ 4. e-mail & SMS */
  console.log("\n--- 4. E-mail & SMS ---");
  await page.goto(`${BASE}/dashboard/email-sms`);
  await page.getByTestId("outbox-composer").waitFor({ timeout: 30000 });
  check(
    "the page says no provider is connected",
    (await page.getByTestId("outbox-provider-note").count()) === 1,
  );
  await page.getByTestId("outbox-audience-type").click();
  await page.getByRole("option", { name: "Groupe", exact: true }).click();
  await page.getByTestId("outbox-audience-target").click();
  await page.getByRole("option", { name: GROUP }).click();
  await page.waitForFunction(
    () =>
      /1 destinataire/.test(
        document.querySelector('[data-testid="outbox-preview"]')?.textContent ?? "",
      ),
    null,
    { timeout: 30000 },
  );
  check(
    "the preview counts the one reachable guardian phone out of the group",
    (await text(page.getByTestId("outbox-preview"))).includes(
      "1 destinataire(s) joignable(s) sur 2",
    ),
    await text(page.getByTestId("outbox-preview")),
  );
  await page
    .getByTestId("outbox-body")
    .fill("Sortie samedi pour {name} : merci de signer l'autorisation.");
  check(
    "the SMS counter shows characters and segments",
    /\d+ caractères · 1 SMS/.test(await text(page.getByTestId("outbox-sms-count"))),
  );
  await page.getByTestId("outbox-queue").click();
  const queued = page
    .locator('[data-testid="outbox-row"][data-status="pending"]')
    .filter({ hasText: "0550000077" });
  await queued.first().waitFor({ timeout: 30000 });
  const out = await one(
    `select address, body, status from public.outbound_messages where recipient_id = '${fx.student.id}' and source = 'campaign'`,
  );
  check(
    "one personalised SMS waits for the guardian's phone",
    out?.address === "0550000077" &&
      out?.body.includes(`Amina Com ${RUN}`) &&
      out?.status === "pending",
    JSON.stringify(out),
  );
  check(
    "its row offers the SMS link",
    (
      (await queued
        .first()
        .locator("xpath=ancestor::tr")
        .getByTestId("outbox-open")
        .getAttribute("href")) ?? ""
    ).startsWith("sms:0550000077"),
  );
  await queued.first().locator("xpath=ancestor::tr").getByTestId("outbox-mark-sent").click();
  await page.waitForTimeout(1200);
  check(
    "marking it sent is saved",
    (
      await one(
        `select status from public.outbound_messages where recipient_id = '${fx.student.id}' and source = 'campaign'`,
      )
    )?.status === "sent",
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comm-outbox.png`, fullPage: true });

  /* ------------------------------------------------------------------ 5. reminders */
  console.log("\n--- 5. Rappels & alertes ---");
  await sql(`update public.reminder_rules set enabled = false;`);
  await page.goto(`${BASE}/dashboard/reminders`);
  const card = page.locator('[data-testid="reminder-rule"][data-kind="absences"]');
  await card.waitFor({ timeout: 30000 });
  await card.getByTestId("reminder-threshold").fill("2");
  await card.getByTestId("reminder-threshold").blur();
  await page.waitForTimeout(800);
  await card.getByTestId("reminder-enabled").click();
  await page
    .locator('[data-testid="reminder-candidate"][data-kind="absences"]')
    .first()
    .waitFor({ timeout: 30000 });
  const rule = await one(
    `select enabled, threshold from public.reminder_rules where kind = 'absences'`,
  );
  check(
    "the absences rule is switched on with its threshold",
    rule?.enabled === true && rule?.threshold === 2,
    JSON.stringify(rule),
  );
  check(
    "the preview lists the student with two absences",
    (await text(page.getByTestId("reminders-preview"))).includes(`Amina Com ${RUN}`),
  );
  await page.getByTestId("reminders-run").click();
  await page.getByTestId("reminders-history").waitFor({ timeout: 30000 });
  const notices = await one(
    `select count(*)::int n from public.notifications where user_id = '${fx.student.id}' and kind = 'absence_alert'`,
  );
  check("running sends the absence notice", notices?.n === 1, JSON.stringify(notices));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comm-reminders.png`, fullPage: true });
  await page.reload();
  await page.getByTestId("reminder-rules").waitFor({ timeout: 30000 });
  check(
    "a second run has nothing left to send",
    await page.getByTestId("reminders-run").isDisabled(),
  );

  /* ------------------------------------------------------------------ 6. Arabic, phone */
  console.log("\n--- 6. Arabic on a phone ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1500);
  const overflows = {};
  for (const path of [
    "/dashboard/news",
    "/dashboard/messaging",
    "/dashboard/email-sms",
    "/dashboard/reminders",
    `/dashboard/news/${post.id}`,
  ]) {
    await page.goto(`${BASE}${path}`);
    await page.locator("main h1").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(900);
    overflows[path.length > 30 ? "/dashboard/news/$id" : path] = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }
  check(
    "the pages read right to left in Arabic and fit a phone",
    (await page.evaluate(() => document.documentElement.dir)) === "rtl" &&
      Object.values(overflows).every((o) => o <= 0),
    JSON.stringify(overflows),
  );

  const unexpected = errors.filter(
    (e) => !/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(e),
  );
  check("no console or page errors", unexpected.length === 0, unexpected.join("\n").slice(0, 800));
} catch (e) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comm-failure.png` }).catch(() => {});
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await browser.close();
  for (const r of rulesBefore) {
    await sql(`update public.reminder_rules set enabled = ${r.enabled}, threshold = ${r.threshold},
        channels = '{${r.channels.join(",")}}' where kind = '${r.kind}';`).catch(() => {});
  }
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`).catch(
    () => {},
  );
  await cleanupFixtures();
  const left = await one(`select
      (select count(*) from public.groups where name like '${TAG}%')::int groups,
      (select count(*) from public.news_posts where title like '${TAG}%')::int posts,
      (select count(*) from public.profiles where email like '${TAG}-%')::int accounts,
      (select count(*) from public.conversations c where not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id))::int orphan_conversations`);
  console.log(`\nleftovers: ${JSON.stringify(left)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
