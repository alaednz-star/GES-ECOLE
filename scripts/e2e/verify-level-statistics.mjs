/**
 * Level statistics must come from the enrolment chain, not the student record.
 *
 *   student -> registration (approved) -> group (active) -> level
 *
 * The page previously counted `students.level_id` -- the DECLARED onboarding
 * level -- which is null for admin-enrolled students, so every card read
 * "Students: 0" while approved enrolments existed.
 */
import { chromium } from "playwright-core";
import { withFixtures, createGroupFixture, cleanupFixtures } from "./fixtures.mjs";

const APP = "http://localhost:5173";
const API = "http://127.0.0.1:54321";

let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};
const sql = async (query) =>
  (await fetch(`${API}/pg/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })).json();

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const fx = await withFixtures({ admin: true });

try {
  // The definition, expressed once in SQL, to compare the UI against.
  const expected = await sql(`
    select l.name,
      (select count(distinct r.student_id) from public.registrations r
         join public.groups g on g.id = r.group_id
        where g.level_id = l.id and r.status = 'approved' and g.status = 'active')::int students,
      (select count(*) from public.groups g
        where g.level_id = l.id and g.status = 'active')::int groups,
      (select count(distinct g.teacher_id) from public.groups g
        where g.level_id = l.id and g.status = 'active' and g.teacher_id is not null)::int teachers,
      (select coalesce(sum(g.max_students), 0) from public.groups g
        where g.level_id = l.id and g.status = 'active')::int capacity
    from public.levels l
   where exists (select 1 from public.groups g where g.level_id = l.id and g.status = 'active');`);

  check("at least one level has active groups to verify", expected.length > 0, `${expected.length}`);

  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', fx.admin.email);
  await page.fill('input[type="password"]', fx.admin.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.goto(`${APP}/dashboard/levels`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3500);

  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // Read the four metrics per level from the DOM, not by slicing text: level
  // names such as "1ère année primaire" contain digits, and accented labels do
  // not survive being rebuilt into a RegExp.
  const cards = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll("li, article, div").forEach((el) => {
      const heading = el.querySelector("h3, h4, p, span");
      const name = heading?.textContent?.trim();
      if (!name) return;
      const dts = [...el.querySelectorAll("dt, span, p")].map((n) => n.textContent?.trim() ?? "");
      const nums = [...el.querySelectorAll("dd, strong, b")].map((n) =>
        Number((n.textContent ?? "").trim()),
      );
      if (dts.length && nums.length >= 4 && !out[name]) out[name] = nums.slice(0, 4);
    });
    return out;
  });

  for (const e of expected) {
    const at = body.indexOf(e.name);
    check(`${e.name}: card rendered`, at >= 0);
    if (at < 0) continue;

    const found = cards[e.name];
    if (!found) {
      // Structure differs from the assumption; fall back to asserting the four
      // expected values all appear near the level name.
      const segment = body.slice(at, at + 160);
      const all = [e.students, e.groups, e.teachers, e.capacity].every((v) =>
        new RegExp(`(^|\\D)${v}(\\D|$)`).test(segment),
      );
      check(`${e.name}: metrics present (students/groups/teachers/capacity)`, all, segment.slice(0, 120));
      continue;
    }
    const [students, groups, teachers, capacity] = found;
    check(`${e.name}: students = ${e.students}`, students === e.students, `UI ${students}`);
    check(`${e.name}: groups = ${e.groups}`, groups === e.groups, `UI ${groups}`);
    check(`${e.name}: teachers = ${e.teachers}`, teachers === e.teachers, `UI ${teachers}`);
    check(`${e.name}: capacity = ${e.capacity}`, capacity === e.capacity, `UI ${capacity}`);
  }

  // A level with no active groups must read zero, not stale or missing data.
  const zero = await sql(`
    select l.name from public.levels l
     where not exists (select 1 from public.groups g where g.level_id = l.id and g.status = 'active')
     limit 1;`);
  if (zero[0]?.name) {
    const at = body.indexOf(zero[0].name);
    const segment = at >= 0 ? body.slice(at, at + 90) : "";
    check(`${zero[0].name}: empty level reads zero`, /0/.test(segment), segment.slice(0, 60));
  }

  check("no console errors", errors.length === 0, errors.slice(0, 1).join("").slice(0, 160));
} catch (e) {
  fail++;
  console.log("  HARNESS ERROR:", e.message.slice(0, 300));
} finally {
  await fx.cleanup();
  await browser.close();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
