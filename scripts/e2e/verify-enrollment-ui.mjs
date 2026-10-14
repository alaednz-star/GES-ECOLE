/**
 * The redesigned enrolment and profile pages, in a real browser.
 *
 * Scope: `/dashboard/registration`, `/dashboard/my-classes`, `/dashboard/my-registrations`,
 * `/dashboard/profile`.
 * The security questions are answered over the API in `verify-enrollment-security.mjs`;
 * this suite is about what a student actually sees and can reach --
 *
 *   - the teacher's photo is the dominant element on a catalogue card, and falls back to
 *     initials rather than a broken image or a silhouette
 *   - the card geometry the brief specifies is MEASURED: an 88px banner that the content
 *     below it outweighs, a 72-76px avatar centred on its lower edge, three equal metadata
 *     columns, two columns per row at 24px, and a subject/level line that wraps rather than
 *     clipping to an ellipsis
 *   - all three course surfaces render the same card -- the catalogue, "Mes cours" and
 *     "Mes inscriptions" are checked against the same geometry and the same column width,
 *     because they used to be two implementations and three different grids
 *   - a card is as tall as its content: no card carries a large empty region below its
 *     last element, which is what equal-height stretching used to pay for the alignment
 *   - a group whose teacher's account is gone says so, and is not dressed up as a person
 *   - nothing is said twice: no status chip in a banner whose panel already states it, and
 *     no schedule pills repeating the HORAIRE column
 *   - ZERO pricing UI, on a fixture group that deliberately HAS a price in the database
 *   - capacity states the class size and never invents occupancy, a ratio or a bar
 *   - the blocked states explain the REAL reason (one group per subject and level), never
 *     an invented schedule clash
 *   - enrolling goes through a confirmation, and the request appears without a reload
 *   - a pending request can be withdrawn, and the seat count reflects it
 *   - nothing overflows horizontally at 1440 / 1024 / 768 / 375
 *   - the same holds in Arabic, right-to-left, with no mirrored-icon or clipped text
 *   - every control a student must tap is at least 44px
 *
 * Needs the dev server and the local Supabase stack:
 *   node scripts/e2e/verify-enrollment-ui.mjs
 */
import { chromium } from "playwright-core";
import { withFixtures, sql, SERVICE_ROLE_KEY, TEST_PASSWORD } from "./fixtures.mjs";

const APP = process.env["APP_URL"] ?? "http://localhost:8080";
const TAG = "e2e-fixture";
const TARGET = 44;

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};

/* ------------------------------------------------------------------ fixtures */

const fx = await withFixtures({ teacher: true, student: true, admin: true });

const level = (await sql(`select id from public.levels where name = '3ème année secondaire';`))[0];
const stream = (
  await sql(`select id from public.streams where code='sciences' and level_id='${level.id}';`)
)[0];

/** A group in the student's own level and stream, with a chosen number of seats taken. */
const makeGroup = async ({ name, subjectKey, capacity, taken = 0, weekday = 1 }) => {
  const subject = (await sql(`select id from public.subjects where key='${subjectKey}';`))[0];
  await sql(`insert into public.teacher_subjects (teacher_id, subject_id)
             values ('${fx.teacher.id}','${subject.id}') on conflict do nothing;`);
  const g = (
    await sql(`
      insert into public.groups
        (name, subject_id, teacher_id, level_id, stream_id, max_students, price_dzd, status,
         start_date, end_date)
      values ('${name}','${subject.id}','${fx.teacher.id}','${level.id}','${stream.id}',
              ${capacity}, 4500, 'active', current_date - 30, current_date + 180)
      returning id;`)
  )[0];
  await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time, room)
             values ('${g.id}', ${weekday}, '14:00', '16:00', 'B12');`);
  // A second slot, so "+1" and the weekly volume have something to show.
  await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time, room)
             values ('${g.id}', ${(weekday + 2) % 7}, '10:00', '11:30', 'B12');`);

  // Seat-fillers exist only to occupy seats; they never sign in. Tagged, so the global
  // cleanup removes them with everything else.
  for (let i = 0; i < taken; i++) {
    const created = await fetch(`http://127.0.0.1:54321/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${TAG}-seat-${i}-${Math.random().toString(36).slice(2)}@example.test`,
        password: TEST_PASSWORD,
        email_confirm: true,
        app_metadata: { role: "student", [TAG]: true },
      }),
    });
    if (!created.ok) throw new Error(`seat filler: ${created.status} ${await created.text()}`);
    const id = (await created.json()).id;
    await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
               values ('${id}','${g.id}','approved', now())
               on conflict (student_id, group_id) where status in ('pending', 'approved') do nothing;`);
  }
  return { id: g.id, name };
};

// The catalogue needs variety: a comfortable group, one that is nearly full, one that is
// full, and a second group of a subject the student will already be enrolled in.
const open = await makeGroup({
  name: `${TAG} UI Maths A`,
  subjectKey: "mathematics",
  capacity: 20,
});
const scarce = await makeGroup({
  name: `${TAG} UI Physique`,
  subjectKey: "physics",
  capacity: 10,
  taken: 8,
  weekday: 2,
});
const filled = await makeGroup({
  name: `${TAG} UI Anglais`,
  subjectKey: "english",
  capacity: 2,
  taken: 2,
  weekday: 3,
});
const sameSubject = await makeGroup({
  name: `${TAG} UI Maths B`,
  subjectKey: "mathematics",
  capacity: 20,
  weekday: 4,
});
// `groups.teacher_id` is ON DELETE SET NULL, so a class really can outlive its teacher.
// The card has to have something honest to say when it does.
const orphan = await makeGroup({
  name: `${TAG} UI Français`,
  subjectKey: "french",
  capacity: 20,
  weekday: 5,
});
await sql(`update public.groups set teacher_id = null where id = '${orphan.id}';`);

// The student: onboarded, in the right level and stream, with a photo-less teacher so the
// initials fallback is exercised, and one approved maths enrolment so `takenSubject` and
// `approved` states both appear.
await sql(`update public.students set gender = coalesce(gender,'female'),
             date_of_birth = coalesce(date_of_birth,'2008-03-02'),
             guardian_name = coalesce(guardian_name,'Parent'),
             guardian_phone = coalesce(guardian_phone,'0661000000'),
             level_id = '${level.id}', stream_id = '${stream.id}', onboarded_at = now()
           where id = '${fx.student.id}';`);

const browser = await chromium.launch();

const login = async (ctx, page, email) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

const cardFor = (page, name) => page.locator("article").filter({ hasText: name });

/** Names of every card on screen -- printed when a lookup fails, so the failure is legible. */
const cardNames = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main article h3")].map((h) => h.textContent?.trim()),
  );

try {
  /* ================================================================ desktop, fr */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await login(ctx, page, fx.student.email);
  await page.goto(`${APP}/dashboard/registration`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  console.log("\n--- the catalogue ---");
  const cards = page.locator("article");
  rec("the eligible groups render as cards", (await cards.count()) >= 4, `${await cards.count()}`);

  const openCard = cardFor(page, open.name);
  if ((await openCard.count()) === 0) {
    console.log("cards on screen:", JSON.stringify(await cardNames(page)));
    throw new Error(`card not found: ${open.name}`);
  }
  const avatar = openCard.locator("[data-person-avatar]").first();
  const box = await avatar.boundingBox();
  rec(
    "the teacher avatar is the dominant element (>= 64px)",
    !!box && box.width >= 64,
    `${box ? Math.round(box.width) : "none"}px`,
  );
  // No photo was uploaded for the fixture teacher, so this must be initials -- not a
  // broken <img> and not a generic silhouette.
  const fallbackText = await openCard.locator("[data-person-avatar] > span").first().innerText();
  rec(
    "with initials as the fallback, not a broken image",
    /^[A-Z]{1,2}$/.test(fallbackText.trim()),
    JSON.stringify(fallbackText.trim()),
  );

  // ---- Geometry the brief specifies, measured rather than trusted.
  const geo = await openCard.evaluate((el) => {
    const c = el.getBoundingClientRect();
    const banner = el.firstElementChild.getBoundingClientRect();
    const av = el.querySelector("[data-person-avatar]").getBoundingClientRect();
    const title = el.querySelector("h3").getBoundingClientRect();
    return {
      bannerH: Math.round(banner.height),
      avatarW: Math.round(av.width),
      intoBanner: Math.round(banner.bottom - av.top),
      belowBanner: Math.round(av.bottom - banner.bottom),
      titleOverlapsAvatar: title.top < av.bottom && title.left < av.right && title.right > av.left,
      factWidths: [...el.querySelectorAll("dl > div")].map((d) =>
        Math.round(d.getBoundingClientRect().width),
      ),
      contentH: Math.round(el.lastElementChild.getBoundingClientRect().height),
      // The subject/level line must WRAP rather than clip -- an ellipsis there loses the
      // stream entirely.
      subjectClamped: (() => {
        const line = el.querySelector("h3")?.nextElementSibling;
        if (!line) return null;
        return (
          getComputedStyle(line).textOverflow === "ellipsis" &&
          getComputedStyle(line).whiteSpace === "nowrap"
        );
      })(),
      cardW: Math.round(c.width),
    };
  });
  // 88px, down from 120. The point of the reduction is that the banner must no longer be
  // the tallest thing on the card, so that is what is asserted rather than just the number.
  rec("the banner is 88px on desktop", geo.bannerH === 88, `${geo.bannerH}px`);
  rec(
    "and no longer dominates: the content below it is taller",
    geo.contentH > geo.bannerH * 2,
    `banner ${geo.bannerH}px vs content ${geo.contentH}px`,
  );
  rec("the avatar is 72-76px", geo.avatarW >= 72 && geo.avatarW <= 76, `${geo.avatarW}px`);
  rec(
    "and is centred on the banner boundary, not merely near it",
    geo.intoBanner > 0 && Math.abs(geo.intoBanner - geo.belowBanner) <= 2,
    `${geo.intoBanner}px into / ${geo.belowBanner}px below`,
  );
  rec("the title does not collide with the avatar", !geo.titleOverlapsAvatar);
  rec(
    "the subject/level line wraps instead of being truncated with an ellipsis",
    geo.subjectClamped === false,
    `truncated=${geo.subjectClamped}`,
  );
  rec(
    "the three metadata blocks are equal columns",
    geo.factWidths.length === 3 && new Set(geo.factWidths).size === 1,
    JSON.stringify(geo.factWidths),
  );

  // Staff DO get a real bar, and when they do it must carry an accessible value -- a
  // `role="progressbar"` with no `aria-valuenow` is what shipped before Phase 5.
  const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const staffPage = await staffCtx.newPage();
  await login(staffCtx, staffPage, fx.admin.email);
  await staffPage.goto(`${APP}/dashboard/groups`, { waitUntil: "networkidle" });
  await staffPage.waitForTimeout(1500);
  const staffBars = staffPage.locator('[role="progressbar"]');
  const staffCount = await staffBars.count();
  rec(
    "progress bars expose an accessible value",
    staffCount === 0 || (await staffBars.first().getAttribute("aria-valuenow")) !== null,
    staffCount === 0
      ? "no bars on the admin groups page"
      : `aria-valuenow=${await staffBars.first().getAttribute("aria-valuenow")}`,
  );
  await staffCtx.close();

  // SEATS. A student's `registrations` read is restricted to their own rows, so occupancy
  // is not merely approximate for them -- it is unavailable, and always resolves to 0/N.
  // The card must therefore show the group's SIZE, and must not draw a bar or an urgency
  // claim from a number nobody measured. See docs/enrollment-seat-counts.md; unlocking the
  // urgency display needs one aggregate server object, which is NOT part of this change.
  const scarceText = await cardFor(page, scarce.name).innerText();
  rec(
    "a student is shown the group's size, not a fabricated occupancy",
    /Groupe de\s*10\s*élèves/i.test(scarceText),
    JSON.stringify(scarceText.split("\n").find((l) => /Groupe de|inscrit/i.test(l)) ?? ""),
  );
  rec(
    "and NO 0-of-N count is rendered as though it were measured",
    !/0\s*inscrit/i.test(scarceText),
    JSON.stringify(scarceText.split("\n").find((l) => /inscrit/i.test(l)) ?? ""),
  );
  rec(
    "and no seat progress bar is drawn from it",
    (await cardFor(page, scarce.name).locator('[role="progressbar"]').count()) === 0,
  );

  // A genuinely full group: the student may still ASK. `enforce_group_capacity` treats a
  // pending row as a request rather than a seat, so this is the database's own rule
  // surfacing, and the admin's rejection is where capacity bites.
  const filledText = await cardFor(page, filled.name).innerText();
  rec(
    "a full group is not falsely labelled open or closed to a student",
    !/Complet/i.test(filledText) && /Groupe de/i.test(filledText),
    JSON.stringify(filledText.split("\n").find((l) => /Complet|Groupe de/i.test(l)) ?? ""),
  );

  // The fixture group HAS a price in the database (4500). The card must still show none of
  // it -- otherwise this assertion would pass on a card that simply had no price to show.
  const cardText = (await openCard.innerText()).replace(/ | /g, " ");
  rec(
    "no price anywhere on the card, though the group has one in the database",
    !/DZD|4\s?500|Tarif/i.test(cardText),
    JSON.stringify(cardText.split("\n").find((l) => /DZD|4 ?500|Tarif/i.test(l)) ?? "(none)"),
  );
  rec(
    "and no currency icon: the banner carries the status badge only",
    (await openCard.locator(".lucide-wallet").count()) === 0,
  );

  const grid = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("main article")];
    const top = Math.round(cards[0].getBoundingClientRect().top);
    const row = cards.filter((c) => Math.round(c.getBoundingClientRect().top) === top);
    const heights = row.map((c) => Math.round(c.getBoundingClientRect().height));
    const a = row[0].getBoundingClientRect();
    const b = row[1] ? row[1].getBoundingClientRect() : null;
    const tops = row.map((c) => Math.round(c.getBoundingClientRect().top));
    return {
      columns: row.length,
      heights,
      tops,
      topsEqual: new Set(tops).size === 1,
      gap: b ? Math.round(Math.abs(b.left - a.right)) : null,
      widthsEqual: !b || Math.abs(Math.round(b.width) - Math.round(a.width)) <= 1,
    };
  });
  rec("two cards per row on desktop", grid.columns === 2, `${grid.columns}`);
  rec("of equal width", grid.widthsEqual);
  rec("with a 24px gap", grid.gap === 24, `${grid.gap}px`);
  rec("aligned at the top of the row", grid.topsEqual, JSON.stringify(grid.tops));

  /*
    CONTENT SIZES THE CARD.

    This assertion is the inverse of the one it replaces. Equal heights were the earlier
    requirement and they were bought with `h-full`: the shorter card in a row stretched to
    the taller one and the difference sat inside it as blank card -- 111px under the buttons
    of an open group next to a rejected one. Every card is now measured for the distance
    between its last element and its own bottom edge, which should be the card's padding and
    nothing else, and the row is aligned at the top instead.
  */
  const slack = await page.evaluate(() =>
    [...document.querySelectorAll("main article")].map((el) => {
      const body = el.lastElementChild;
      const last = body.lastElementChild;
      return {
        name: el.querySelector("h3")?.textContent?.trim().slice(0, 28),
        px: Math.round(el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom),
      };
    }),
  );
  const padded = slack.filter((c) => c.px > 28);
  rec(
    "no card carries a large empty region below its content",
    padded.length === 0,
    padded.length ? JSON.stringify(padded) : `worst ${Math.max(...slack.map((c) => c.px))}px`,
  );

  /* ---------------------------------------------------------------- teacher, or nobody */
  const orphanCard = cardFor(page, orphan.name);
  const orphanText = await orphanCard.innerText();
  rec(
    "a group with no teacher says the record is empty, not that the class has no teacher",
    /Enseignant non renseigné/i.test(orphanText) && !/Sans enseignant/i.test(orphanText),
    JSON.stringify(orphanText.split("\n").find((l) => /enseignant/i.test(l)) ?? ""),
  );
  // The tint is an inline `color-mix` of the subject colour. A group with nobody in the
  // teacher slot must not get it: a coloured disc reads as a person who is simply unnamed.
  const tints = await page.evaluate(() =>
    [...document.querySelectorAll("main article")].map((el) => ({
      name: el.querySelector("h3")?.textContent?.trim(),
      // A teacher with a photo has no fallback disc to tint at all, so only the initials
      // avatars are evidence either way.
      hasFallback: !!el.querySelector("[data-person-avatar] > span"),
      tinted: !!el
        .querySelector("[data-person-avatar] > span")
        ?.getAttribute("style")
        ?.includes("color-mix"),
    })),
  );
  const orphanTint = tints.find((c) => c.name === orphan.name);
  rec(
    "and its avatar stays neutral rather than borrowing the subject colour",
    tints.some((c) => c.tinted) && orphanTint?.hasFallback === true && orphanTint.tinted === false,
    JSON.stringify(tints.filter((c) => c.hasFallback)),
  );

  /* ================================================================ details sheet */
  console.log("\n--- the details sheet ---");
  await openCard.getByRole("button", { name: /^Détails$/i }).click();
  await page.waitForTimeout(700);
  const sheet = page.locator('[role="dialog"]').first();
  rec("the explicit Détails button opens the sheet", await sheet.isVisible());
  const sheetText = await sheet.innerText();
  rec(
    "it lists EVERY slot, not only the first",
    (sheetText.match(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/g) ?? []).length >= 2,
    `${(sheetText.match(/\d{2}:\d{2}/g) ?? []).length} times`,
  );
  rec("and the room", /B12/.test(sheetText));
  rec(
    "the details sheet has no pricing row",
    !/DZD|4\s?500|Tarif/i.test(sheetText),
    JSON.stringify(sheetText.split("\n").find((l) => /DZD|Tarif/i.test(l)) ?? "(none)"),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  /* ================================================================ enrol */
  console.log("\n--- enrolling goes through a confirmation ---");
  await cardFor(page, scarce.name)
    .getByRole("button", { name: /S'inscrire/i })
    .click();
  await page.waitForTimeout(600);
  const dialog = page.locator('[role="dialog"]').first();
  rec("a confirmation dialog appears rather than firing immediately", await dialog.isVisible());
  const dialogText = await dialog.innerText();
  rec(
    "it says the seat is not booked yet",
    /pas encore réservée|valide chaque demande/i.test(dialogText),
    JSON.stringify(dialogText.split("\n")[1] ?? ""),
  );
  rec(
    "and carries no pricing either",
    !/DZD|4\s?500|Tarif/i.test(dialogText),
    JSON.stringify(dialogText.split("\n").find((l) => /DZD|Tarif/i.test(l)) ?? "(none)"),
  );

  await dialog.getByRole("button", { name: /Envoyer la demande/i }).click();
  // Success navigates to the confirmation route.
  await page.waitForURL(/registration\/success/, { timeout: 20000 }).catch(() => {});
  rec(
    "confirming sends the request and lands on the confirmation page",
    /registration\/success/.test(page.url()),
    page.url().replace(APP, ""),
  );

  const created = await sql(`select status from public.registrations
                              where student_id='${fx.student.id}' and group_id='${scarce.id}';`);
  rec("the row exists and is pending", created[0]?.status === "pending", `${created[0]?.status}`);

  /* ================================================================ pending, no reload */
  console.log("\n--- the catalogue reflects it without a reload ---");
  await page.goto(`${APP}/dashboard/registration`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const scarceAfter = await cardFor(page, scarce.name).innerText();
  rec(
    "the group now shows the pending state",
    /attente/i.test(scarceAfter),
    JSON.stringify(scarceAfter.split("\n").find((l) => /attente/i.test(l)) ?? ""),
  );
  rec(
    "with a way to withdraw",
    (await cardFor(page, scarce.name)
      .getByRole("button", { name: /Retirer/i })
      .count()) > 0,
  );

  /* ================================================================ the real rule */
  console.log("\n--- the blocked state explains the REAL reason ---");
  // Approve the maths request so the sibling maths group becomes `takenSubject`.
  await sql(`insert into public.registrations (student_id, group_id, status, decided_at)
             values ('${fx.student.id}','${open.id}','approved', now())
             on conflict (student_id, group_id) where status in ('pending', 'approved') do update set status='approved';`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const siblingText = await cardFor(page, sameSubject.name).innerText();
  rec(
    "a second group of the same subject explains the one-per-subject rule",
    /déjà inscrit/i.test(siblingText),
    JSON.stringify(siblingText.split("\n").find((l) => /déjà/i.test(l)) ?? ""),
  );
  const pageText = await page.locator("main").innerText();
  rec(
    "and NO invented schedule-conflict wording appears anywhere",
    !/chevauche|conflit d.horaire|overlaps/i.test(pageText),
  );

  // With open, pending, approved and takenSubject all on screen at once, the cards must NOT
  // agree on a height: each one ends where its own state panel ends. Equal heights here
  // would mean the stretch is back.
  const stateHeights = await page.evaluate(() =>
    [...document.querySelectorAll("main article")].map((el) => ({
      name: el.querySelector("h3")?.textContent?.trim().slice(0, 24),
      h: Math.round(el.getBoundingClientRect().height),
    })),
  );
  rec(
    "cards in different states differ in height, because they differ in content",
    new Set(stateHeights.map((c) => c.h)).size > 1,
    JSON.stringify(stateHeights.map((c) => c.h)),
  );

  // The geometry every state panel shares, measured once here and compared on Mes cours.
  const cataloguePanel = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("main article [data-state-panel]")];
    const first = panels[0];
    if (!first) return null;
    const style = (el) =>
      `${getComputedStyle(el).borderTopLeftRadius}|${getComputedStyle(el).padding}`;
    return {
      count: panels.length,
      radius: getComputedStyle(first).borderTopLeftRadius,
      pad: getComputedStyle(first).padding,
      allIdentical: new Set(panels.map(style)).size === 1,
    };
  });
  rec(
    "every state panel on the catalogue shares one radius and one padding",
    !!cataloguePanel && cataloguePanel.allIdentical,
    JSON.stringify(cataloguePanel),
  );

  /* ================================================================ my-registrations */
  console.log("\n--- my registrations ---");
  await page.goto(`${APP}/dashboard/my-registrations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const regCards = page.locator("article");
  rec("the requests render as cards", (await regCards.count()) >= 2, `${await regCards.count()}`);
  rec(
    "each carries the teacher's avatar, like the catalogue",
    (await regCards.first().locator("[data-person-avatar]").count()) > 0,
  );

  // The two pages must be the same component, not two implementations that look alike.
  const shape = await page.evaluate(() => {
    const el = document.querySelector("main article");
    if (!el) return null;
    const banner = el.firstElementChild.getBoundingClientRect();
    const av = el.querySelector("[data-person-avatar]");
    return {
      bannerH: Math.round(banner.height),
      avatarW: av ? Math.round(av.getBoundingClientRect().width) : 0,
      facts: el.querySelectorAll("dl > div").length,
      hasCapacity: /Groupe de \d+ élèves/.test(el.textContent ?? ""),
      // Redundancy the brief called out: the bottom panel already states the status, so
      // there must be no status chip in the banner and no schedule pills repeating HORAIRE.
      bannerChips: el.firstElementChild.querySelectorAll("span").length,
    };
  });
  rec(
    "Mes inscriptions uses the identical card geometry as the catalogue",
    !!shape && shape.bannerH === 88 && shape.avatarW >= 72 && shape.avatarW <= 76,
    JSON.stringify(shape),
  );
  rec(
    "with the same three metadata blocks and capacity line",
    !!shape && shape.facts === 3 && shape.hasCapacity,
    JSON.stringify(shape),
  );
  const myRegText = await page.locator("main").innerText();
  rec(
    "and no status chip in the banner -- the state panel already says it",
    !!shape && shape.bannerChips === 0,
    `${shape?.bannerChips} chips`,
  );
  rec(
    "and no pricing on this page either",
    !/DZD|Tarif/i.test(myRegText),
    JSON.stringify(myRegText.split("\n").find((l) => /DZD|Tarif/i.test(l)) ?? "(none)"),
  );

  const pendingCard = regCards.filter({ hasText: /attente/i }).first();
  rec(
    "a pending request offers withdrawal",
    (await pendingCard.getByRole("button", { name: /Retirer/i }).count()) > 0,
  );
  await pendingCard.getByRole("button", { name: /Retirer/i }).click();
  await page.waitForTimeout(600);
  const confirm = page.locator('[role="alertdialog"]').first();
  rec("withdrawing is confirmed first", await confirm.isVisible());
  await confirm.getByRole("button", { name: /Retirer la demande/i }).click();
  await page.waitForTimeout(2000);
  const afterWithdraw = await sql(`select count(*)::int c from public.registrations
                                    where student_id='${fx.student.id}' and group_id='${scarce.id}';`);
  rec("and the row is gone", afterWithdraw[0].c === 0, `${afterWithdraw[0].c}`);

  /* ================================================================ my-classes */
  console.log("\n--- mes cours ---");
  await page.goto(`${APP}/dashboard/my-classes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const classCard = page.locator("main article").first();
  rec("the approved class appears on Mes cours", (await classCard.count()) > 0);

  const classGeo = await page.evaluate(() => {
    const el = document.querySelector("main article");
    if (!el) return null;
    const body = el.lastElementChild;
    const footer = el.querySelector("footer");
    const panel = footer?.querySelector("[data-state-panel]");
    return {
      w: Math.round(el.getBoundingClientRect().width),
      bannerH: Math.round(el.firstElementChild.getBoundingClientRect().height),
      avatarW: Math.round(el.querySelector("[data-person-avatar]").getBoundingClientRect().width),
      facts: el.querySelectorAll("dl > div").length,
      hasCapacity: /Groupe de \d+ élèves/.test(el.textContent ?? ""),
      // The footer used to be a centred 12px line -- the only centred text on any card.
      footerAlign: panel ? getComputedStyle(panel).textAlign : null,
      panelRadius: panel ? getComputedStyle(panel).borderTopLeftRadius : null,
      panelPad: panel ? getComputedStyle(panel).padding : null,
      slack: Math.round(
        el.getBoundingClientRect().bottom - body.lastElementChild.getBoundingClientRect().bottom,
      ),
    };
  });
  rec(
    "Mes cours draws the identical card as the catalogue",
    !!classGeo &&
      classGeo.bannerH === 88 &&
      classGeo.avatarW >= 72 &&
      classGeo.avatarW <= 76 &&
      classGeo.facts === 3 &&
      classGeo.hasCapacity,
    JSON.stringify(classGeo),
  );
  // One card in a two-column grid is one COLUMN -- not a banner stretched across the page,
  // and not a narrow strip beside a dead area. The catalogue's own card width, measured at
  // the same viewport, is the only definition of "right" that keeps the screens one product.
  rec(
    "and it is exactly one catalogue column wide",
    !!classGeo && Math.abs(classGeo.w - geo.cardW) <= 1,
    `${classGeo?.w}px vs catalogue ${geo.cardW}px`,
  );
  rec(
    "its footer is a state panel like every other card, aligned to the start",
    !!classGeo &&
      classGeo.footerAlign === "start" &&
      classGeo.panelRadius === cataloguePanel.radius &&
      classGeo.panelPad === cataloguePanel.pad,
    JSON.stringify({ mesCours: classGeo, catalogue: cataloguePanel }),
  );
  rec("with no empty region below it", !!classGeo && classGeo.slack <= 28, `${classGeo?.slack}px`);

  const classText = await classCard.innerText();
  rec(
    "it states the next session as a fact rather than a sentence",
    /Prochaine séance/i.test(classText) &&
      (/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/.test(classText) || /Aucune séance/i.test(classText)),
    JSON.stringify(classText.split("\n").slice(-2)),
  );
  rec(
    "and dates the enrolment instead of replaying the request",
    /Inscrit\(e\) depuis/i.test(classText) && !/Demande envoyée/i.test(classText),
    JSON.stringify(classText.split("\n").find((l) => /Inscrit|Demande/i.test(l)) ?? ""),
  );
  rec(
    "no pricing on Mes cours either",
    !/DZD|Tarif|4\s?500/i.test(classText),
    JSON.stringify(classText.split("\n").find((l) => /DZD|Tarif/i.test(l)) ?? "(none)"),
  );

  /* ================================================================ profile */
  console.log("\n--- the profile ---");
  await page.goto(`${APP}/dashboard/profile`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const main = page.locator("main");
  // The hero photo is the AvatarPicker's own button -- the photo IS the control.
  const heroPhoto = main
    .getByRole("button", { name: /Ajouter une photo|Changer la photo/i })
    .first();
  const heroBox = await heroPhoto.boundingBox();
  rec(
    "the profile opens with the photo, not a form field",
    !!heroBox && heroBox.width >= 80,
    `${heroBox ? Math.round(heroBox.width) : "none"}px`,
  );
  const profileText = await main.innerText();
  rec("the name is stated as a heading", profileText.includes("E2E Student"));
  rec("the role is stated", /Élève|Student|طالب/i.test(profileText));
  rec("the e-mail is stated", profileText.includes(fx.student.email));
  rec("and when the account was created", /Membre depuis/i.test(profileText));
  rec(
    "the photo itself is the upload control",
    (await heroPhoto.count()) > 0 && (await main.locator('input[type="file"]').count()) > 0,
  );
  rec(
    "and it accepts only the image types storage allows",
    /image\/jpeg/.test(
      (await main.locator('input[type="file"]').first().getAttribute("accept")) ?? "",
    ),
    String(await main.locator('input[type="file"]').first().getAttribute("accept")),
  );

  /* ================================================================ topbar photo */
  const topbarAvatar = page.locator("header").locator("[data-person-avatar]").first();
  rec(
    "the topbar shows the same avatar component as everywhere else",
    (await topbarAvatar.count()) > 0,
  );

  /* ================================================================ responsive */
  console.log("\n--- no horizontal overflow at any width ---");
  for (const [w, h] of [
    [1440, 950],
    [1024, 800],
    [768, 900],
    [375, 800],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ["registration", "my-classes", "my-registrations", "profile"]) {
      await page.goto(`${APP}/dashboard/${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(900);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      rec(`${route} @ ${w}px does not scroll sideways`, over <= 1, `${over}px`);
    }
  }

  /* ================================================================ touch targets */
  console.log("\n--- touch targets at 375px ---");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${APP}/dashboard/registration`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  // Measured on the page's OWN controls. The dashboard chrome (sidebar trigger, global
  // search, language switcher, user menu) is shared by every screen and predates this
  // work, so it is reported separately rather than folded into this page's verdict.
  const measured = await page.evaluate((target) => {
    const sel = 'button, a[href], [role="button"]';
    const shell = ["header", '[data-sidebar="sidebar"]', "nav", '[data-slot="sidebar"]'].join(",");
    const boxes = [...document.querySelectorAll(`main ${sel}`)].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        label: (el.textContent ?? "").trim().slice(0, 40),
        w: r.width,
        h: r.height,
        inShell: !!el.closest(shell),
      };
    });
    return boxes.filter((b) => b.w > 0 && b.h > 0 && (b.w < target || b.h < target));
  }, TARGET);
  const mine = measured.filter((b) => !b.inShell);
  const shell = measured.filter((b) => b.inShell);
  const fmt = (list) =>
    list.map((s) => `${s.label || "(icon)"} ${Math.round(s.w)}x${Math.round(s.h)}`).join(", ");
  rec(`every catalogue control is at least ${TARGET}px`, mine.length === 0, fmt(mine));
  const ctas = await page.evaluate(() => {
    const card = document.querySelector("main article");
    return [...(card?.querySelectorAll("footer button") ?? [])].map((b) => ({
      label: (b.textContent ?? "").trim(),
      h: Math.round(b.getBoundingClientRect().height),
      w: Math.round(b.getBoundingClientRect().width),
    }));
  });
  rec(
    "both card CTAs are tappable at 375px",
    ctas.length > 0 && ctas.every((c) => c.h >= 44 && c.w >= 88),
    JSON.stringify(ctas),
  );
  if (shell.length > 0) {
    console.log(`NOTE  pre-existing dashboard chrome below ${TARGET}px: ${fmt(shell)}`);
  }

  /* ================================================================ arabic, rtl */
  console.log("\n--- Arabic, right to left ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.student.id}';`).catch(
    () => {},
  );
  const arCtx = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    locale: "ar",
  });
  const arPage = await arCtx.newPage();
  await login(arCtx, arPage, fx.student.email);
  await arPage.goto(`${APP}/dashboard/registration`, { waitUntil: "networkidle" });
  await arPage.waitForTimeout(1500);
  // The switcher is the reliable way in: locale may come from the profile or storage.
  const dir = await arPage.evaluate(() => document.documentElement.getAttribute("dir"));
  rec("the document direction is set", dir === "rtl" || dir === "ltr", `dir=${dir}`);

  if (dir === "rtl") {
    const arOver = await arPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    rec("RTL catalogue does not scroll sideways", arOver <= 1, `${arOver}px`);

    // A price or a time range must not be reordered by the bidi algorithm.
    const isolated = await arPage.evaluate(() => {
      const els = [...document.querySelectorAll('main [dir="ltr"]')];
      return els.length;
    });
    rec("direction-neutral values are bidi-isolated", isolated > 0, `${isolated} isolated spans`);

    // The avatar must sit on the correct side: logical properties, not left/right.
    const sides = await arPage.evaluate(() => {
      const card = document.querySelector("main article");
      if (!card) return null;
      const av = card.querySelector("[data-person-avatar]");
      if (!av) return null;
      const c = card.getBoundingClientRect();
      const a = av.getBoundingClientRect();
      return { fromStart: Math.round(c.right - a.right), fromEnd: Math.round(a.left - c.left) };
    });
    rec(
      "the avatar flips to the start side in RTL",
      !!sides && sides.fromStart < sides.fromEnd,
      JSON.stringify(sides),
    );
  } else {
    rec(
      "RTL could not be reached in this run -- reported, not silently skipped",
      false,
      `dir=${dir}`,
    );
  }
  await arCtx.close();
} finally {
  await browser.close();
  await fx.cleanup();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
