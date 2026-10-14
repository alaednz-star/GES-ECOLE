/**
 * Calendar LAYOUT verification across widths and both text directions.
 *
 * The bug this exists to prevent: session chips escaping their day cell. A month
 * cell is ~1/7th of the grid, so a long group name will push a chip past its
 * column unless every ancestor can shrink. Measuring geometry is the only honest
 * way to assert that -- a screenshot can hide a 3px overflow, and `truncate`
 * silently does nothing when an ancestor lacks `min-w-0`.
 *
 * Checks, at 1440 / 1280 / 1024 / 768 / 390, in French and Arabic:
 *   * the page never scrolls horizontally
 *   * every session card stays inside its day cell (both edges)
 *   * the 7 day columns are equal width
 *   * month header labels align with body columns
 *   * narrow screens get the agenda, not a squeezed 7-column grid
 *
 * RUN ALONE -- cleanupFixtures() removes every `e2e-fixture%` row.
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, sql } from "./fixtures.mjs";

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

const fx = await withFixtures({ admin: true, teacher: true });
const weekday = new Date().getDay();

// Deliberately long names: this is what breaks containment when truncation or a
// `min-w-0` is missing anywhere in the ancestor chain.
const LONG = "3AS Sciences Expérimentales — Groupe Renforcement Samedi";
await createGroupFixture({
  teacherId: fx.teacher.id,
  name: LONG,
  weekday,
  studentCount: 6,
});
await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "2AS Sciences",
  weekday,
  studentCount: 4,
});
await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "1AM Groupe 1",
  weekday,
  studentCount: 3,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());

/** Cards must sit inside their grid cell, with a small tolerance for borders. */
const measureContainment = () =>
  page.evaluate(() => {
    const out = { checked: 0, escapes: [] };
    // A day cell is a direct child of the 7-track grid; cards are buttons inside.
    const grids = [...document.querySelectorAll('div.grid[style*="repeat(7"]')];
    for (const grid of grids) {
      for (const cell of [...grid.children]) {
        const cb = cell.getBoundingClientRect();
        for (const card of cell.querySelectorAll("button")) {
          const rb = card.getBoundingClientRect();
          if (rb.width === 0) continue;
          out.checked++;
          if (rb.left < cb.left - 1.5 || rb.right > cb.right + 1.5) {
            out.escapes.push({
              text: (card.textContent ?? "").trim().slice(0, 32),
              cell: [Math.round(cb.left), Math.round(cb.right)],
              card: [Math.round(rb.left), Math.round(rb.right)],
            });
          }
        }
      }
    }
    return out;
  });

const columnWidths = () =>
  page.evaluate(() => {
    const grid = document.querySelector('div.grid[style*="repeat(7"]');
    if (!grid) return null;
    return [...grid.children].slice(0, 7).map((c) => Math.round(c.getBoundingClientRect().width));
  });

const noPageOverflow = () =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);

const login = async (email) => {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  // Wait for hydration before submitting: an un-hydrated form submits as a GET
  // and the credentials end up in the query string instead of signing in.
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', fx.teacher.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 45000 });
};

const gotoCal = async () => {
  await page.goto(`${APP}/dashboard/attendance`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2600);
};

const WIDTHS = [1440, 1280, 1024, 768, 390];

try {
  await sql(`delete from public.attendance;`);
  await login(fx.admin.email);

  for (const dir of ["fr", "ar"]) {
    await sql(`update public.profiles set locale='${dir}' where id='${fx.admin.id}';`);
    console.log(`\n=== ${dir.toUpperCase()} ${dir === "ar" ? "(RTL)" : "(LTR)"} ===`);
    await gotoCal();

    const actualDir = await page.evaluate(() => document.documentElement.dir);
    check(
      `${dir}: document dir is ${dir === "ar" ? "rtl" : "ltr"}`,
      actualDir === (dir === "ar" ? "rtl" : "ltr"),
      `got ${actualDir}`,
    );

    for (const view of ["week", "month"]) {
      if (view === "month") {
        await page.getByRole("button", { name: /^mois$|^month$|^شهر$/i }).click();
        await page.waitForTimeout(1600);
      }

      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 1000 });
        await page.waitForTimeout(900);

        check(`${dir}/${view}/${w}px: no horizontal page overflow`, await noPageOverflow());

        const isAgenda = view === "week" && w < 1024;
        if (isAgenda) {
          // Below lg the week becomes an agenda; a 7-col week grid must be gone.
          const weekGrids = await page.evaluate(
            () => document.querySelectorAll('div.grid[style*="repeat(7"]').length,
          );
          // The agenda keeps ONE 7-track strip (the date picker), never a body grid.
          check(
            `${dir}/${view}/${w}px: agenda replaces the 7-column week`,
            weekGrids <= 1,
            `${weekGrids} seven-track grids found`,
          );
          continue;
        }

        const cont = await measureContainment();
        check(
          `${dir}/${view}/${w}px: all ${cont.checked} cards inside their cell`,
          cont.escapes.length === 0,
          JSON.stringify(cont.escapes.slice(0, 2)),
        );

        const widths = await columnWidths();
        if (widths) {
          const spread = Math.max(...widths) - Math.min(...widths);
          check(
            `${dir}/${view}/${w}px: 7 columns equal width (spread ${spread}px)`,
            spread <= 2,
            JSON.stringify(widths),
          );
        }
      }

      // Month header must align with the body columns.
      if (view === "month") {
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.waitForTimeout(800);
        const aligned = await page.evaluate(() => {
          const grids = [...document.querySelectorAll('div.grid[style*="repeat(7"]')];
          if (grids.length < 2) return null;
          const hx = [...grids[0].children]
            .slice(0, 7)
            .map((c) => Math.round(c.getBoundingClientRect().left));
          const bx = [...grids[1].children]
            .slice(0, 7)
            .map((c) => Math.round(c.getBoundingClientRect().left));
          return hx.every((v, i) => Math.abs(v - bx[i]) <= 1);
        });
        check(
          `${dir}/month: header labels align with body columns`,
          aligned === true,
          `${aligned}`,
        );
      }

      if (view === "month") {
        await page.getByRole("button", { name: /^semaine$|^week$|^أسبوع$/i }).click();
        await page.waitForTimeout(1400);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(700);
    }
  }

  console.log("\n=== Drawer still works after the layout change ===");
  // Assert the desktop width explicitly rather than relying on the loop's last
  // iteration: at 390px the week is an agenda showing only the selected day, so
  // the card being clicked might legitimately not be on screen.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await sql(`update public.profiles set locale='fr' where id='${fx.admin.id}';`);
  await gotoCal();
  await page.getByText("2AS Sciences").first().click();
  await page.waitForTimeout(1800);
  check(
    "clicking a card opens the drawer",
    (await page.getByRole("button", { name: /tout présent|all present/i }).count()) > 0,
  );
  const drawerFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 2,
  );
  check("drawer causes no overflow", drawerFits);

  console.log("\n=== Console ===");
  const loops = errors.filter((e) => /Maximum update depth|too many re-renders/i.test(e));
  check("no render loop", loops.length === 0, loops.join(" | "));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await fx.cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
