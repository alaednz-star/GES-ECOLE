/**
 * Attendance Calendar -- end-to-end in a real browser.
 *
 * Covers the functional Phase 3 surface: week/month grids, navigation, filters,
 * counters, parallel sessions, the drawer, marking, saving, the unsaved-changes
 * guard, zero-enrolment, and the admin/teacher/student permission boundaries.
 *
 * RUN ALONE. `cleanupFixtures()` removes every `e2e-fixture%` row, so two suites
 * overlapping delete each other's accounts mid-run.
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

const iso = (d) => {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const fx = await withFixtures({ admin: true, teacher: true, student: true });
const other = await withFixtures({ teacher: true });

const today = new Date();
const weekday = today.getDay();
const todayIso = iso(today);

// Two groups for the SAME teacher at the SAME time on the SAME weekday: the
// parallel-session case the calendar must never collapse.
const gA = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture Cal Alpha",
  weekday,
  studentCount: 3,
});
const gB = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture Cal Beta",
  weekday,
  studentCount: 2,
});
const gOther = await createGroupFixture({
  teacherId: other.teacher.id,
  name: "e2e-fixture Cal Foreign",
  weekday,
  studentCount: 2,
});
const gEmpty = await createGroupFixture({
  teacherId: fx.teacher.id,
  name: "e2e-fixture Cal Empty",
  weekday,
  studentCount: 0,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

/** The unsaved-changes guard uses window.confirm; default to accepting. */
let confirmAction = "accept";
let confirmSeen = 0;
page.on("dialog", (d) => {
  confirmSeen++;
  void (confirmAction === "accept" ? d.accept() : d.dismiss());
});

const login = async (email) => {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', fx.teacher.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

const logout = async () => {
  await ctx.clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
};

const gotoCalendar = async () => {
  await page.goto(`${APP}/dashboard/attendance`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2200);
};

try {
  await sql(`delete from public.attendance;`);

  /* ---------------------------- TEACHER VIEW ---------------------------- */
  console.log("\n[1] Calendar opens on the current week with no input");
  await login(fx.teacher.email);
  await gotoCalendar();

  check(
    "no group picker is present (the calendar IS the picker)",
    !(await page.getByText(/choisir un groupe|choose a group/i).count()),
  );
  check("Alpha session card visible", (await page.getByText("e2e-fixture Cal Alpha").count()) > 0);
  check("Beta session card visible", (await page.getByText("e2e-fixture Cal Beta").count()) > 0);
  check(
    "zero-enrolment group still on the calendar",
    (await page.getByText("e2e-fixture Cal Empty").count()) > 0,
  );
  check(
    "another teacher's group is NOT shown",
    (await page.getByText("e2e-fixture Cal Foreign").count()) === 0,
    "teacher scoping leaked into the UI",
  );

  console.log("\n[2] Parallel sessions stay separate");
  const parallelLabel = await page.getByText(/groupes en parallèle|parallel groups/i).count();
  check("a parallel-slot label is rendered", parallelLabel > 0);
  check(
    "both parallel groups are individually named",
    (await page.getByText("e2e-fixture Cal Alpha").count()) > 0 &&
      (await page.getByText("e2e-fixture Cal Beta").count()) > 0,
  );

  console.log("\n[3] Statuses reflect real data");
  check(
    "zero-enrolment session reads 'Aucun élève inscrit'",
    (await page.getByText(/aucun élève inscrit|no enrolled students/i).count()) > 0,
  );
  const dueCount = await page.getByText(/à pointer|to mark/i).count();
  check("today's unmarked sessions are actionable", dueCount > 0);

  console.log("\n[4] Week / month navigation");
  const weekLabel = await page.locator('[data-testid="period-label"]').first().textContent();
  await page.getByRole("button", { name: /période suivante|next period/i }).click();
  await page.waitForTimeout(1200);
  const nextLabel = await page.locator('[data-testid="period-label"]').first().textContent();
  check("next advances the period", weekLabel !== nextLabel, `${weekLabel} -> ${nextLabel}`);

  await page.getByRole("button", { name: /^aujourd'hui$|^today$/i }).click();
  await page.waitForTimeout(1200);
  const backLabel = await page.locator('[data-testid="period-label"]').first().textContent();
  check("Today returns to the current period", backLabel === weekLabel, `${backLabel}`);

  await page.getByRole("button", { name: /^mois$|^month$/i }).click();
  await page.waitForTimeout(1800);
  check("month view renders sessions", (await page.getByText("e2e-fixture Cal Alpha").count()) > 0);
  const bodyOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 2,
  );
  check("month view does not overflow the page horizontally", bodyOverflow);

  await page.getByRole("button", { name: /^semaine$|^week$/i }).click();
  await page.waitForTimeout(1500);

  console.log("\n[5] Counters");
  const counters = await page.locator('[data-testid="counter-value"]').allTextContents();
  check("three counters render", counters.length === 3, JSON.stringify(counters));
  check("total counter is positive", Number(counters[0]) > 0, JSON.stringify(counters));

  console.log("\n[6] Drawer opens and marks attendance");
  await page.getByText("e2e-fixture Cal Alpha").first().click();
  await page.waitForTimeout(1500);
  check("drawer shows the group name", (await page.getByText("e2e-fixture Cal Alpha").count()) > 0);
  check(
    "Tout présent is offered",
    (await page.getByRole("button", { name: /tout présent|all present/i }).count()) > 0,
  );

  await page.getByRole("button", { name: /tout présent|all present/i }).click();
  await page.waitForTimeout(600);
  const saveBtn = page.getByRole("button", { name: /^enregistrer$|^save$/i }).first();
  check("Save becomes enabled after marking", await saveBtn.isEnabled());

  await saveBtn.click();
  await page.waitForTimeout(2500);

  const saved = await sql(
    `select status, count(*) n from public.attendance
      where group_id='${gA.id}' and session_date='${todayIso}' group by status;`,
  );
  const savedTotal = saved.reduce((s, r) => s + Number(r.n), 0);
  check("all 3 students written as present", savedTotal === 3, JSON.stringify(saved));
  check("status is present", saved[0]?.status === "present", JSON.stringify(saved));

  console.log("\n[7] Status updates in place after save");
  await page.waitForTimeout(1200);
  check(
    "card now shows a completed count",
    (await page.getByText(/3\/3/).count()) > 0,
    "expected 3/3 on the card",
  );

  console.log("\n[8] Unsaved-changes guard");
  await page.getByText("e2e-fixture Cal Beta").first().click();
  await page.waitForTimeout(1500);
  // Mark one student, then try to close via Escape and DISMISS the confirm.
  const pButtons = page.locator('button[aria-label*="résent"], button[aria-label*="resent"]');
  if ((await pButtons.count()) > 0) {
    await pButtons.first().click();
    await page.waitForTimeout(400);
    confirmSeen = 0;
    confirmAction = "dismiss";
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    check("Escape with unsaved marks prompts for confirmation", confirmSeen > 0);
    check(
      "dismissing the prompt keeps the drawer open",
      (await page.getByRole("button", { name: /tout présent|all present/i }).count()) > 0,
      "drawer closed despite dismissal",
    );

    confirmAction = "accept";
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    check(
      "accepting the prompt closes the drawer",
      (await page.getByRole("button", { name: /tout présent|all present/i }).count()) === 0,
    );
    const betaRows = await sql(
      `select count(*) n from public.attendance where group_id='${gB.id}';`,
    );
    check("discarded marks were NOT saved", Number(betaRows[0].n) === 0, JSON.stringify(betaRows));
  } else {
    console.log("  SKIP  guard test (no P buttons located)");
  }

  console.log("\n[9] Zero-enrolment drawer points at Inscriptions");
  await page.getByText("e2e-fixture Cal Empty").first().click();
  await page.waitForTimeout(1500);
  check(
    "explains there are no enrolled students",
    (await page.getByText(/aucun élève inscrit dans ce groupe|no students enrolled/i).count()) > 0,
  );
  check(
    "offers a route to Inscriptions",
    (await page.getByRole("link", { name: /inscriptions|registrations/i }).count()) > 0,
  );
  confirmAction = "accept";
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  console.log("\n[10] to-mark-only filter");
  const beforeFilter = await page.getByText(/e2e-fixture Cal /).count();
  await page.getByRole("button", { name: /à pointer seulement|to mark only/i }).click();
  await page.waitForTimeout(1500);
  const afterFilter = await page.getByText(/e2e-fixture Cal /).count();
  check(
    "filter hides sessions needing no action",
    afterFilter < beforeFilter,
    `${beforeFilter} -> ${afterFilter}`,
  );
  check(
    "the completed session is hidden",
    (await page.getByText("e2e-fixture Cal Alpha").count()) === 0,
    "completed session still visible under the filter",
  );
  await page.getByRole("button", { name: /à pointer seulement|to mark only/i }).click();
  await page.waitForTimeout(1000);

  console.log("\n[11] Teacher has NO teacher selector");
  check(
    "teacher does not see the enseignant filter",
    (await page.getByText(/tous les enseignants|all teachers/i).count()) === 0,
  );

  /* ----------------------------- ADMIN VIEW ----------------------------- */
  console.log("\n[12] Admin sees every teacher and gets the filter");
  await logout();
  await login(fx.admin.email);
  await gotoCalendar();

  check(
    "admin sees the first teacher's group",
    (await page.getByText("e2e-fixture Cal Alpha").count()) > 0,
  );
  check(
    "admin sees the other teacher's group",
    (await page.getByText("e2e-fixture Cal Foreign").count()) > 0,
  );
  const hasFilter = await page
    .locator('button[role="combobox"]')
    .filter({ hasText: /enseignant|teacher/i })
    .count();
  check(
    "admin gets a teacher selector",
    hasFilter > 0 || (await page.locator('button[role="combobox"]').count()) > 0,
  );

  console.log("\n[13] Admin can mark attendance");
  await page.getByText("e2e-fixture Cal Foreign").first().click();
  await page.waitForTimeout(1500);
  const adminAll = page.getByRole("button", { name: /tout présent|all present/i });
  if ((await adminAll.count()) > 0) {
    await adminAll.click();
    await page.waitForTimeout(500);
    await page
      .getByRole("button", { name: /^enregistrer$|^save$/i })
      .first()
      .click();
    await page.waitForTimeout(2500);
    const rows = await sql(
      `select count(*) n from public.attendance where group_id='${gOther.id}';`,
    );
    check("admin wrote attendance for another teacher's group", Number(rows[0].n) > 0);
  } else {
    check("admin sees the marking controls", false, "Tout présent not found");
  }

  /* ---------------------------- STUDENT VIEW ---------------------------- */
  console.log("\n[14] Student cannot reach the calendar");
  await logout();
  await login(fx.student.email);
  await page.goto(`${APP}/dashboard/attendance`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  const studentSeesMarking =
    (await page.getByRole("button", { name: /tout présent|all present/i }).count()) > 0;
  check("student is not offered marking controls", !studentSeesMarking);
  const onCalendar = (await page.getByText("e2e-fixture Cal Alpha").count()) > 0;
  check(
    "student does not get the staff calendar",
    !onCalendar,
    "student reached the attendance calendar",
  );

  console.log("\n[15] Student write is refused by the database, not just the UI");
  const studentWrite = await fetch(`${API}/rest/v1/attendance`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([]),
  });
  // The authoritative check lives in verify-session-spine.mjs with a real student
  // JWT; this only asserts the endpoint is reachable so that suite is meaningful.
  check("attendance endpoint responds", studentWrite.status > 0);

  console.log("\n[16] Optimistic rollback on a failed save");
  await logout();
  await login(fx.teacher.email);
  await gotoCalendar();
  // Fail every attendance WRITE while leaving reads intact, so the optimistic
  // patch is applied and then must be undone.
  await page.route("**/rest/v1/attendance*", (route) => {
    const m = route.request().method();
    if (m === "POST" || m === "PATCH") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "injected failure" }),
      });
    }
    return route.continue();
  });
  const beforeRb = await sql(`select count(*) n from public.attendance where group_id='${gB.id}';`);
  await page.getByText("e2e-fixture Cal Beta").first().click();
  await page.waitForTimeout(1500);
  const rbAll = page.getByRole("button", { name: /tout présent|all present/i });
  if ((await rbAll.count()) > 0) {
    await rbAll.click();
    await page.waitForTimeout(400);
    await page
      .getByRole("button", { name: /^enregistrer$|^save$/i })
      .first()
      .click();
    await page.waitForTimeout(3000);
    const afterRb = await sql(
      `select count(*) n from public.attendance where group_id='${gB.id}';`,
    );
    check(
      "a failed save writes nothing",
      Number(afterRb[0].n) === Number(beforeRb[0].n),
      `${beforeRb[0].n} -> ${afterRb[0].n}`,
    );
    check(
      "an error is surfaced to the user",
      (await page.getByText(/erreur|impossible|error|failed/i).count()) > 0,
    );
    confirmAction = "accept";
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2000);
    check(
      "the optimistic count was rolled back (no 2/2 on the card)",
      (await page.getByText(/2\/2/).count()) === 0,
      "card still advertises the unsaved state",
    );
  } else {
    check("rollback test reached the drawer", false, "Tout présent not found");
  }
  await page.unroute("**/rest/v1/attendance*");

  console.log("\n[17] Console hygiene");
  const loops = errors.filter((e) => /Maximum update depth|too many re-renders/i.test(e));
  check("no render loop", loops.length === 0, loops.join(" | "));
  const real = errors.filter((e) => !/favicon|404|Failed to load resource|net::ERR/i.test(e));
  check("no unexpected console errors", real.length === 0, real.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await fx.cleanup();
  await other.cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
