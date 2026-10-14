/**
 * School operations end to end (ADR-007): Salles, Emplois du temps, Documents officiels,
 * Statistiques.
 *
 *   - the four entries are live links
 *   - a room is created, assigned to a group's slot through the group form, and a second group
 *     at the same time in the same room is refused; the room's weekly use is shown
 *   - the timetable shows the slot by room and by teacher, and prints
 *   - attendance and enrollment certificates are issued (numbered, printable) and one is voided
 *   - the statistics page shows its figures and charts; Arabic on a phone
 *
 * LOCAL ONLY (fixtures.mjs refuses any non-loopback API); needs the dev server (BASE_URL,
 * default http://localhost:8080).
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e/verify-operations-ui.mjs
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
const ROOM = `${TAG} Salle ${RUN}`;
const F1 = `${TAG} OPS Anglais ${RUN}`;
const F2 = `${TAG} OPS Maths ${RUN}`;
const GA = `${TAG} OPS Groupe A ${RUN}`;
const GB = `${TAG} OPS Groupe B ${RUN}`;
const STUDENT = `Amine Ops ${RUN}`;

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

async function login(who) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

/** Opens the single group of a formation in the group form and adds a slot with this room. */
async function addSlotWithRoom(programId) {
  await page.goto(`${BASE}/dashboard/programs/${programId}`);
  await page
    .getByRole("button", { name: /Modifier/ })
    .last()
    .waitFor({ timeout: 30000 });
  await page.locator('button[aria-label^="Modifier"]').last().click();
  await dialog().waitFor();
  await dialog().getByRole("button", { name: "Ajouter un créneau" }).click();
  await dialog().getByTestId("slot-room").last().click();
  await page.getByRole("option", { name: new RegExp(ROOM) }).click();
  await dialog().getByRole("button", { name: "Enregistrer" }).click();
}

try {
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`);
  await sql(`update public.profiles set full_name = '${STUDENT}' where id = '${fx.student.id}';`);
  const f1 = await one(
    `insert into public.programs (name, category, status) values ('${F1}', 'language', 'active') returning id::text id;`,
  );
  const f2 = await one(
    `insert into public.programs (name, category, status) values ('${F2}', 'academic_support', 'active') returning id::text id;`,
  );
  const ga =
    await one(`insert into public.groups (name, program_id, max_students, teacher_id, status, start_date)
      values ('${GA}', '${f1.id}', 12, '${fx.teacher.id}', 'active', current_date - 60) returning id::text id;`);
  const gb = await one(`insert into public.groups (name, program_id, max_students, status)
      values ('${GB}', '${f2.id}', 12, 'active') returning id::text id;`);
  const reg = await one(`insert into public.registrations (student_id, group_id, status, decided_at)
      values ('${fx.student.id}', '${ga.id}', 'approved', now()) returning id::text id;`);

  await login(fx.admin);

  /* ------------------------------------------------------------------ 1. sidebar */
  console.log("\n--- 1. the four pages are live ---");
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await sidebar.locator('a[href="/dashboard/payments"]').waitFor({ timeout: 30000 });
  const links = [];
  for (const href of [
    "/dashboard/timetables",
    "/dashboard/rooms",
    "/dashboard/official-documents",
    "/dashboard/statistics",
  ]) {
    links.push(await sidebar.locator(`a[href="${href}"]`).count());
  }
  check(
    "Emplois du temps, Salles, Documents officiels and Statistiques are live links",
    links.every((n) => n === 1),
    JSON.stringify(links),
  );

  /* ------------------------------------------------------------------ 2. rooms */
  console.log("\n--- 2. Salles ---");
  await page.goto(`${BASE}/dashboard/rooms`);
  await page.getByTestId("room-add").click();
  await dialog().waitFor();
  await page.fill("#room-name", ROOM);
  await page.fill("#room-capacity", "15");
  await page.fill("#room-location", "1er étage");
  await dialog().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  const room = await one(
    `select id::text id, capacity, location from public.rooms where name = '${ROOM}';`,
  );
  check(
    "a room is created with its capacity",
    room?.capacity === 15 && room.location === "1er étage",
    JSON.stringify(room),
  );

  await addSlotWithRoom(f1.id);
  await dialog().waitFor({ state: "hidden", timeout: 15000 });
  const slot = await one(
    `select room_id::text room_id, room, weekday, start_time from public.group_schedules where group_id = '${ga.id}';`,
  );
  // Three sessions on the slot's weekday (attendance is only recorded on days the group meets).
  await sql(`insert into public.attendance (group_id, student_id, session_date, status)
      select '${ga.id}', '${fx.student.id}', d, s::public.attendance_status
        from (select current_date - ((extract(dow from current_date)::int - ${slot?.weekday ?? 0} + 7) % 7) as last) x,
             lateral (values (last - 14, 'present'), (last - 7, 'absent'), (last, 'present')) v(d, s);`);
  check(
    "the group form assigns the room to a slot (the slot shows the room's name)",
    slot?.room_id === room.id && slot.room === ROOM,
    JSON.stringify(slot),
  );

  await addSlotWithRoom(f2.id);
  const refused = await page
    .getByText(/already used at that time/)
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const gbSlots = await one(
    `select count(*)::int n from public.group_schedules where group_id = '${gb.id}' and room_id = '${room.id}';`,
  );
  check(
    "a second group in the same room at the same time is refused, with the reason",
    refused && gbSlots.n === 0 && (await dialog().isVisible()),
    JSON.stringify(gbSlots),
  );
  await page.keyboard.press("Escape");

  await page.goto(`${BASE}/dashboard/rooms`);
  const usageCell = page
    .locator(`[data-testid="room-row"][data-room="${room.id}"]`)
    .locator("xpath=ancestor::tr")
    .getByTestId("room-usage");
  await usageCell.waitFor({ timeout: 15000 });
  check(
    "the room shows its weekly use",
    ((await usageCell.textContent()) ?? "").includes("créneaux : 1"),
    (await usageCell.textContent()) ?? "",
  );
  if (SHOTS) await page.locator("main").screenshot({ path: `${SHOTS}/ops-rooms-fr.png` });

  /* ------------------------------------------------------------------ 3. timetable */
  console.log("\n--- 3. Emplois du temps ---");
  await page.goto(`${BASE}/dashboard/timetables?view=room&id=${room.id}`);
  await page.getByTestId("timetable-grid").waitFor({ timeout: 30000 });
  const roomBlocks = await page.getByTestId("timetable-block").allTextContents();
  check(
    "the room's timetable shows the group's slot",
    roomBlocks.length === 1 && roomBlocks[0].includes(GA),
    JSON.stringify(roomBlocks),
  );
  await page.goto(`${BASE}/dashboard/timetables?view=teacher&id=${fx.teacher.id}`);
  await page.getByTestId("timetable-grid").waitFor({ timeout: 30000 });
  check(
    "the teacher's timetable shows the slot with its room",
    ((await page.getByTestId("timetable-block").first().textContent()) ?? "").includes(ROOM),
  );
  if (SHOTS) await page.locator("main").screenshot({ path: `${SHOTS}/ops-timetable-fr.png` });
  await page.getByTestId("timetable-print").click();
  await page.getByTestId("document").waitFor({ timeout: 20000 });
  check(
    "the timetable prints as a document",
    (await page.getByTestId("document").getByTestId("timetable-block").count()) === 1,
  );

  /* ------------------------------------------------------------------ 4. official documents */
  console.log("\n--- 4. Documents officiels ---");
  const issue = async (kindLabel) => {
    await page.goto(`${BASE}/dashboard/official-documents`);
    await page.getByTestId("doc-issue").click();
    await dialog().waitFor();
    await page.click("#doc-kind");
    await page.getByRole("option", { name: kindLabel }).click();
    await page.getByTestId("doc-student").click();
    await page.getByRole("option", { name: new RegExp(STUDENT) }).click();
    await page.getByTestId("doc-confirm").click();
    await page.getByTestId("certificate-body").waitFor({ timeout: 20000 });
    return (await page.getByTestId("certificate-body").textContent()) ?? "";
  };
  const attendanceText = await issue("Attestation d'assiduité");
  const doc = await one(
    `select number, snapshot from public.official_documents where registration_id = '${reg.id}' and kind = 'attendance';`,
  );
  check(
    "an attendance certificate is issued, numbered, with the attendance written out",
    /^ATT-\d{4}-\d{6}$/.test(doc?.number ?? "") &&
      attendanceText.includes(STUDENT) &&
      attendanceText.includes("2 séance(s) sur 3") &&
      attendanceText.includes("67 %") &&
      (await page.getByTestId("doc-number").textContent())?.trim() === doc.number,
    attendanceText,
  );
  if (SHOTS)
    await page.getByTestId("document").screenshot({ path: `${SHOTS}/ops-certificate-fr.png` });
  const enrollmentText = await issue("Attestation d'inscription");
  check(
    "an enrollment certificate is issued",
    enrollmentText.includes(GA) && enrollmentText.includes(F1),
    enrollmentText,
  );
  await page.goto(`${BASE}/dashboard/official-documents`);
  await page
    .getByPlaceholder(/Rechercher/)
    .first()
    .fill(RUN);
  await page.waitForTimeout(400);
  await page.getByTestId("doc-void").first().click();
  const alert = page.getByRole("alertdialog");
  await alert.waitFor();
  await page.fill("#doc-void-reason", "Erreur de saisie");
  await alert.getByRole("button", { name: "Annuler le document" }).click();
  await alert.waitFor({ state: "hidden", timeout: 15000 });
  check(
    "a certificate is voided and kept",
    (
      await one(
        `select count(*)::int n from public.official_documents where registration_id = '${reg.id}' and status = 'voided';`,
      )
    ).n === 1,
  );

  /* ------------------------------------------------------------------ 5. statistics */
  console.log("\n--- 5. Statistiques ---");
  await page.goto(`${BASE}/dashboard/statistics`);
  await page.getByTestId("stats-kpis").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const charts = await page.locator(".recharts-surface").count();
  check(
    "the statistics page shows its figures, charts and tables",
    charts >= 2 &&
      ((await page.getByTestId("stats-fill").textContent()) ?? "").includes(GA) &&
      ((await page.getByTestId("stats-teachers").textContent()) ?? "").includes("E2E Teacher"),
    `charts ${charts}`,
  );
  if (SHOTS) await page.locator("main").screenshot({ path: `${SHOTS}/ops-statistics-fr.png` });

  /* ------------------------------------------------------------------ 6. Arabic on a phone */
  console.log("\n--- 6. Arabic on a phone ---");
  await sql(`update public.profiles set locale = 'ar' where id = '${fx.admin.id}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflows = {};
  for (const path of ["timetables", "rooms", "official-documents", "statistics"]) {
    await page.goto(`${BASE}/dashboard/${path}`);
    await page.locator("main h1").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(700);
    overflows[path] = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }
  check(
    "the four pages read right to left in Arabic and fit a phone",
    (await page.evaluate(() => document.documentElement.dir)) === "rtl" &&
      Object.values(overflows).every((o) => o <= 0),
    JSON.stringify(overflows),
  );

  // The refused room (step 2) is a deliberate 400 from the conflict trigger.
  const unexpected = errors.filter(
    (e) => !/status of 400|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED/.test(e),
  );
  check("no console or page errors", unexpected.length === 0, unexpected.join("\n").slice(0, 800));
} catch (e) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ops-failure.png` }).catch(() => {});
  fail++;
  console.log(`  FAIL  unexpected error -> ${e.stack || e}`);
} finally {
  await browser.close();
  await sql(`update public.profiles set locale = 'fr' where id = '${fx.admin.id}';`).catch(
    () => {},
  );
  await sql(`delete from public.official_documents where student_id = '${fx.student.id}';`).catch(
    () => {},
  );
  await cleanupFixtures();
  await sql(`delete from public.rooms where name like '${TAG}%';`).catch(() => {});
  const left = await one(`select
      (select count(*) from public.programs where name like '${TAG}%')::int programs,
      (select count(*) from public.rooms where name like '${TAG}%')::int rooms,
      (select count(*) from public.profiles where email like '${TAG}-%')::int accounts`);
  console.log(`\nleftovers: ${JSON.stringify(left)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
