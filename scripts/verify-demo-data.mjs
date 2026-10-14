/**
 * Signs into the local app as each demo role and checks what that role actually sees.
 *
 * This is the manual walkthrough, automated: real browser sessions, real logins, real
 * queries through RLS. It does not touch the database except to read a couple of ids, so it
 * can be run after `seed-demo-data.mjs` as often as you like.
 *
 * The interesting assertions are the negative ones. Access is gated client-side today
 * (`RequireAuth` renders `<Navigate to="/dashboard">` for a role mismatch), so "a student
 * cannot reach the teachers screen" is verified two ways: the route bounces them, AND the
 * data they would need is refused by RLS if they ask for it directly with their own token.
 * A redirect alone would only prove the menu is tidy.
 *
 *   node scripts/verify-demo-data.mjs
 */

import { chromium } from "playwright-core";
import { API, PUBLISHABLE_KEY, sql } from "./e2e/fixtures.mjs";

const APP = process.env["APP_URL"] ?? "http://localhost:8080";

const ACCOUNTS = {
  admin: { email: "admin.demo@demo.gestion-ecole.local", password: "AdminDemo2026!" },
  teacher: { email: "teacher.demo@demo.gestion-ecole.local", password: "TeacherDemo2026!" },
  student: { email: "student.demo@demo.gestion-ecole.local", password: "StudentDemo2026!" },
};

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};

const login = async (ctx, page, who) => {
  await ctx.clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', ACCOUNTS[who].email);
  await page.fill('input[type="password"]', ACCOUNTS[who].password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.waitForTimeout(1200);
};

const text = async (page, path) => {
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  return { body: await page.locator("main").innerText(), url: page.url() };
};

/** PostgREST with this user's own token -- the real authorisation boundary. */
const asUser = async (who, path) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(ACCOUNTS[who]),
  });
  const tok = (await r.json()).access_token;
  const res = await fetch(`${API}/rest/v1/${path}`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${tok}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/**
 * True when this account can see exactly one `user_roles` row -- its own -- and none of the
 * others. That is the actual guarantee: the policy is `user_id = auth.uid() OR is_admin()`,
 * so a signed-in user reading their own role is the app working, not a leak.
 */
const onlyOwnRole = async (who) => {
  const own = (await sql(`select id from auth.users where email = '${ACCOUNTS[who].email}';`))[0]
    .id;
  const mine = await asUser(who, "user_roles?select=user_id,role");
  const rows = Array.isArray(mine.body) ? mine.body : [];
  return rows.length === 1 && rows[0].user_id === own;
};

const browser = await chromium.launch();

try {
  /* ============================================================ ADMIN */
  console.log("\n--- ADMIN ---");
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let page = await ctx.newPage();
  await login(ctx, page, "admin");
  rec(
    "admin login reaches the dashboard",
    /dashboard/.test(page.url()),
    page.url().replace(APP, ""),
  );

  let v = await text(page, "/dashboard/groups");
  rec(
    "admin sees the six demo groups",
    (v.body.match(/3AS Sciences —/g) ?? []).length >= 6,
    `${(v.body.match(/3AS Sciences —/g) ?? []).length} matches`,
  );
  rec(
    "with real occupancy: the full group reads 20/20",
    /20\s*\/\s*20|20 sur 20/.test(v.body),
    v.body.split("\n").find((l) => /20\s*\/\s*20/.test(l)) ?? "(not found)",
  );

  v = await text(page, "/dashboard/teachers");
  for (const n of ["Karim Belkacem", "Mehdi Saadi", "Sarah Benali"]) {
    rec(`admin sees teacher ${n}`, v.body.includes(n));
  }

  await page.goto(`${APP}/dashboard/students`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const total = await page.locator("main").innerText();
  rec(
    "admin sees the seeded students",
    /2[01]|21/.test(total) || (total.match(/\n/g) ?? []).length > 10,
    "list rendered",
  );
  // `DataTable` shows 10 rows a page, so a 21-student register needs the search box rather
  // than an assumption about alphabetical luck.
  const search = page.locator('main input[type="search"], main input[placeholder*="echerch" i]');
  if ((await search.count()) > 0) {
    await search.first().fill("Yacine");
    await page.waitForTimeout(900);
  }
  v = { body: await page.locator("main").innerText(), url: page.url() };
  rec("and can find the demo student by name", v.body.includes("Yacine Haddad"));

  v = await text(page, "/dashboard/registrations");
  rec(
    "admin sees the student's pending request awaiting a decision",
    /Yacine Haddad/.test(v.body) && /attente/i.test(v.body),
  );
  await ctx.close();

  /* ============================================================ TEACHER */
  console.log("\n--- TEACHER (Karim Belkacem) ---");
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await ctx.newPage();
  await login(ctx, page, "teacher");
  rec(
    "teacher login reaches the dashboard",
    /dashboard/.test(page.url()),
    page.url().replace(APP, ""),
  );

  // The photo the seed uploaded must actually decode in the browser, not merely be a URL.
  const photo = await page.evaluate(() => {
    const img = document.querySelector("header [data-person-avatar] img");
    return img ? { src: img.getAttribute("src"), ok: img.complete && img.naturalWidth > 0 } : null;
  });
  rec(
    "the teacher's uploaded photo renders in the topbar through PersonAvatar",
    !!photo && photo.ok && /storage\/v1\/object\/public\/avatars\//.test(photo.src ?? ""),
    JSON.stringify(photo),
  );

  v = await text(page, "/dashboard/my-groups");
  rec(
    "teacher sees their own maths groups",
    (v.body.match(/Mathématiques/g) ?? []).length >= 1,
    `${(v.body.match(/Mathématiques/g) ?? []).length} matches`,
  );
  rec(
    "and NOT another teacher's physics group",
    !/Physique/.test(v.body),
    v.body.split("\n").find((l) => /Physique/.test(l)) ?? "(absent, correct)",
  );

  v = await text(page, "/dashboard/resources");
  rec("teacher sees their chapters", /Fonctions numériques/.test(v.body));
  rec(
    "including the unpublished ones they own",
    /Nombres complexes/.test(v.body),
    "the draft chapter is visible to its owner",
  );

  // A teacher is not an admin. The route bounces them AND the data refuses them.
  v = await text(page, "/dashboard/teachers");
  rec(
    "teacher cannot reach the admin teachers screen",
    !/\/dashboard\/teachers/.test(v.url),
    `landed on ${v.url.replace(APP, "")}`,
  );
  rec(
    "teacher sees only their OWN role row, never the roster of roles",
    await onlyOwnRole("teacher"),
    "user_roles is `user_id = auth.uid() OR is_admin()` by design -- the app reads its own role",
  );
  // A teacher IS staff, so the staff directory is readable to them on purpose --
  // `teachers read` opens with `private.is_staff()`. Asserting they cannot see colleagues
  // would be asserting a bug. The scoping that actually matters for a teacher is STUDENTS:
  // `students read` gives them only students approved into a group they themselves teach.
  const teacherStaff = await asUser("teacher", "teachers?select=id");
  rec(
    "teacher can read the staff directory, which is intended for staff",
    Array.isArray(teacherStaff.body) && teacherStaff.body.length >= 3,
    `${Array.isArray(teacherStaff.body) ? teacherStaff.body.length : teacherStaff.status} rows`,
  );
  const roster = await asUser("teacher", "students?select=id");
  const ownStudents = (
    await sql(`select count(*)::int n
                 from public.registrations r
                 join public.groups g on g.id = r.group_id
                 join public.profiles p on p.id = g.teacher_id
                where p.email = '${ACCOUNTS.teacher.email}' and r.status = 'approved';`)
  )[0].n;
  const allStudents = (await sql(`select count(*)::int n from public.students;`))[0].n;
  rec(
    "but sees ONLY the students in their own groups, not the whole register",
    Array.isArray(roster.body) && roster.body.length === ownStudents && ownStudents < allStudents,
    `${Array.isArray(roster.body) ? roster.body.length : roster.status} visible / ${ownStudents} own / ${allStudents} total`,
  );
  await ctx.close();

  /* ============================================================ STUDENT */
  console.log("\n--- STUDENT (Yacine Haddad) ---");
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await ctx.newPage();
  await login(ctx, page, "student");
  rec(
    "student login reaches the dashboard",
    /dashboard/.test(page.url()),
    page.url().replace(APP, ""),
  );

  v = await text(page, "/dashboard/registration");
  rec(
    "the catalogue lists the groups for their level",
    (v.body.match(/3AS Sciences —/g) ?? []).length >= 5,
    `${(v.body.match(/3AS Sciences —/g) ?? []).length} matches`,
  );
  rec("the approved group says so", /inscrit à ce groupe/i.test(v.body));
  rec("the pending request says so", /attente de validation/i.test(v.body));
  rec("the refused one says so", /refusée/i.test(v.body));
  rec(
    "and the refusal shows the administration's note",
    /Groupe complet au moment de la demande/.test(v.body),
  );
  rec(
    "the second maths group explains the REAL rule, one enrolment per subject and level",
    /déjà inscrit dans cette matière/i.test(v.body),
  );
  rec(
    "and no invented schedule-overlap wording appears",
    !/chevauche|conflit d.horaire|overlaps/i.test(v.body),
  );
  rec(
    "capacity is stated as class size, never as a fabricated ratio",
    /Groupe de \d+ élèves maximum/.test(v.body) && !/\d+\s*\/\s*\d+\s*élèves/.test(v.body),
    v.body.split("\n").find((l) => /Groupe de \d+ élèves/.test(l)) ?? "(not found)",
  );
  const teacherPhotos = await page.evaluate(
    () =>
      [...document.querySelectorAll("main article [data-person-avatar] img")].filter(
        (i) => i.complete && i.naturalWidth > 0,
      ).length,
  );
  rec(
    "teacher photos render on the catalogue cards",
    teacherPhotos >= 3,
    `${teacherPhotos} decoded images`,
  );
  rec("and no pricing appears", !/DZD|Tarif/i.test(v.body));

  v = await text(page, "/dashboard/my-registrations");
  rec(
    "Mes inscriptions shows all three states",
    /attente/i.test(v.body) && /inscrit/i.test(v.body) && /refus/i.test(v.body),
  );

  v = await text(page, "/dashboard/my-resources");
  rec(
    "student sees published material from their approved group",
    /Fonctions numériques/.test(v.body),
  );
  rec(
    "but NOT the unpublished chapter",
    !/Nombres complexes/.test(v.body),
    "draft chapter correctly hidden",
  );
  rec(
    "nor the unpublished resource inside a published chapter",
    !/Devoir surveillé n°2/.test(v.body),
    "draft resource correctly hidden",
  );
  rec(
    "and nothing from a group they are not enrolled in",
    !/Lois de Newton/.test(v.body),
    "physics material correctly absent",
  );

  v = await text(page, "/dashboard/profile");
  rec("student can open their profile", /Mon profil|ملفي|My profile/i.test(v.body));
  rec(
    "and has a real upload control, not a URL field",
    (await page.locator('input[type="file"]').count()) > 0,
  );

  // Student against admin/teacher surfaces: bounced, and refused at the data layer.
  for (const [path, label] of [
    ["/dashboard/students", "the students register"],
    ["/dashboard/teachers", "the teachers register"],
    ["/dashboard/registrations", "the admin registrations queue"],
  ]) {
    const r = await text(page, path);
    rec(
      `student cannot reach ${label}`,
      !r.url.includes(path),
      `landed on ${r.url.replace(APP, "")}`,
    );
  }

  const foreign = await asUser("student", "registrations?select=id,student_id");
  const own = (await sql(`select id from auth.users where email = '${ACCOUNTS.student.email}';`))[0]
    .id;
  rec(
    "student's own token returns ONLY their own registrations",
    Array.isArray(foreign.body) && foreign.body.every((r) => r.student_id === own),
    `${Array.isArray(foreign.body) ? foreign.body.length : "?"} rows, all own=${
      Array.isArray(foreign.body) ? foreign.body.every((r) => r.student_id === own) : "n/a"
    }`,
  );
  rec(
    "student sees only their OWN role row, and nobody else's",
    await onlyOwnRole("student"),
    "reading your own role is intended; reading anyone else's is what must fail",
  );
  const otherStudents = await asUser("student", "students?select=id");
  rec(
    "and cannot enumerate the other 20 students",
    Array.isArray(otherStudents.body) && otherStudents.body.length <= 1,
    `${Array.isArray(otherStudents.body) ? otherStudents.body.length : otherStudents.status} rows`,
  );
  await ctx.close();
} finally {
  await browser.close();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
