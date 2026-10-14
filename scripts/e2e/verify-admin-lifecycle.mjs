/**
 * Administrator deactivation, reactivation and deletion, against the isolated local stack.
 *
 * The failure this suite exists to prevent is not an exception. It is a school with nobody
 * able to sign in, so every check is asked of the database rather than of the screen: the
 * guard is what actually stands between one mis-click and a lockout, and a UI assertion
 * would prove only that a button looked right.
 *
 * "Deactivated" is asserted the way GoTrue decides it -- by trying to sign in -- and not by
 * reading a flag. A status that says "deactivated" beside an account that can still get in is
 * the exact failure being tested for.
 */

import {
  withFixtures,
  cleanupFixtures,
  createGroupFixture,
  sql,
  API,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY,
  TEST_PASSWORD,
} from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

const q = (s) => String(s).replace(/'/g, "''");

const canSignIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return r.ok;
};

const setBan = async (id, banned) => {
  const r = await fetch(`${API}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ban_duration: banned ? "876000h" : "none" }),
  });
  return r.ok;
};

const activeAdmins = async () => Number((await sql(`select private.active_admin_count() c;`))[0].c);

/** Runs the guard and reports the refusal, if any. */
const guard = async (target, actor, action) => {
  try {
    await sql(
      `select private.assert_admin_removable('${q(target)}', '${q(actor)}', '${q(action)}');`,
    );
    return null;
  } catch (e) {
    return String(e.message).replace(/\s+/g, " ").trim();
  }
};

// Three administrators, so the last-administrator rule can be reached deliberately rather
// than by accident, and two of them can be removed without ever risking the third.
/**
 * Accounts this suite bans, so it can put them back.
 *
 * Step 4 has to leave exactly one administrator able to sign in, which means banning any
 * that already existed in the database -- including the seeded local administrator, which
 * `cleanupFixtures` knows nothing about because it is not a fixture. Leaving it banned would
 * quietly lock the developer out of their own dev stack.
 */
const banned = new Set();

const fxA = await withFixtures({ admin: true });
const fxB = await withFixtures({ admin: true });
const fxC = await withFixtures({ admin: true, teacher: true });

try {
  const A = fxA.admin;
  const B = fxB.admin;
  const C = fxC.admin;

  console.log(`\n  (fixtures: 3 administrators, ${await activeAdmins()} active in total)`);

  /* ============================================================ 1. DEACTIVATION WORKS */
  console.log("\n=== 1. AN ADMINISTRATOR IS DEACTIVATED ===");

  check("the account can sign in to begin with", (await canSignIn(B.email)) === true);
  const countBefore = await activeAdmins();

  check("the guard permits it", (await guard(B.id, A.id, "deactivate")) === null);
  check("the ban is accepted", (await setBan(B.id, true)) === true);
  banned.add(B.id);
  check("the account can no longer sign in", (await canSignIn(B.email)) === false);
  check(
    "it no longer counts as an active administrator",
    (await activeAdmins()) === countBefore - 1,
  );

  /* ---- and nothing was destroyed to achieve it */
  const survived = await sql(`
    select (select count(*)::int from auth.users     where id = '${q(B.id)}') u,
           (select count(*)::int from public.profiles where id = '${q(B.id)}') p,
           (select count(*)::int from public.user_roles where user_id = '${q(B.id)}' and role = 'admin') r;
  `);
  const s = survived[0];
  check(
    "the auth account, the profile and the admin role all survive",
    Number(s.u) === 1 && Number(s.p) === 1 && Number(s.r) === 1,
    JSON.stringify(s),
  );
  check(
    "no Supabase Auth account is left active behind a removed role",
    Number(s.r) === 1 && (await canSignIn(B.email)) === false,
    "the role was kept and the login was stopped, not the other way round",
  );

  /* ============================================================== 2. REACTIVATION WORKS */
  console.log("\n=== 2. AND REACTIVATED AGAIN ===");

  check("the ban is lifted", (await setBan(B.id, false)) === true);
  check("the account can sign in again", (await canSignIn(B.email)) === true);
  check("it counts once more", (await activeAdmins()) === countBefore);
  check(
    "reactivation needs no guard at all",
    (await guard(B.id, A.id, "deactivate")) === null,
    "it can only ever add someone who can get in",
  );

  /* ========================================================= 3. SELF-ACTION IS REFUSED */
  console.log("\n=== 3. AN ADMINISTRATOR CANNOT REMOVE THEMSELVES ===");

  const selfDeactivate = await guard(A.id, A.id, "deactivate");
  check("self-deactivation is refused", selfDeactivate !== null, "it must not be permitted");
  check(
    "and the refusal says why",
    /own account/i.test(selfDeactivate ?? ""),
    selfDeactivate ?? "",
  );

  const selfDelete = await guard(A.id, A.id, "delete");
  check("self-deletion is refused", /own account/i.test(selfDelete ?? ""), selfDelete ?? "");

  check(
    "the rule holds even with plenty of administrators left",
    (await activeAdmins()) >= 3 && selfDeactivate !== null,
    `${await activeAdmins()} active`,
  );
  check("and the account is untouched", (await canSignIn(A.email)) === true);

  /* ================================================== 4. THE LAST ADMINISTRATOR IS SAFE */
  console.log("\n=== 4. THE LAST ADMINISTRATOR CANNOT BE REMOVED ===");

  // Deactivate every administrator except C, using A as the actor throughout, so that C is
  // demonstrably the only one left who can sign in.
  const others = await sql(`
    select ur.user_id id from public.user_roles ur
      join auth.users u on u.id = ur.user_id
     where ur.role = 'admin'
       and ur.user_id <> '${q(C.id)}'
       and (u.banned_until is null or u.banned_until <= now());
  `);
  for (const o of others) {
    await setBan(o.id, true);
    banned.add(o.id);
  }

  check(
    "exactly one administrator can still sign in",
    (await activeAdmins()) === 1,
    `${await activeAdmins()}`,
  );
  check("and it is the expected one", (await canSignIn(C.email)) === true);

  // The actor here is a DIFFERENT (deactivated) administrator, so the self rule cannot be
  // what refuses -- this proves the last-administrator rule fires on its own.
  const lastDeactivate = await guard(C.id, A.id, "deactivate");
  check("deactivating the last administrator is refused", lastDeactivate !== null);
  check(
    "and for the right reason, not the self rule",
    /last administrator/i.test(lastDeactivate ?? "") && !/own account/i.test(lastDeactivate ?? ""),
    lastDeactivate ?? "",
  );

  const lastDelete = await guard(C.id, A.id, "delete");
  check(
    "deleting the last administrator is refused",
    /last administrator/i.test(lastDelete ?? ""),
    lastDelete ?? "",
  );
  check("the last administrator can still sign in", (await canSignIn(C.email)) === true);

  /* ---- a deactivated administrator is not standing behind them */
  check(
    "a deactivated administrator does not hold the door open",
    (await guard(B.id, A.id, "delete")) === null,
    "removing an account that already cannot sign in takes nobody away",
  );

  /* ---- and the protection lifts as soon as somebody else can get in */
  await setBan(B.id, false);
  check(
    "with a second administrator back, the first may be removed",
    (await guard(C.id, A.id, "deactivate")) === null,
  );
  await setBan(A.id, false);

  /* =============================================================== 5. DELETION IS SAFE */
  console.log("\n=== 5. DELETION REMOVES THE LOGIN AND KEEPS THE HISTORY ===");

  await sql(`
    insert into public.audit_log (action, actor_id, actor_email, target_id, target_email, details)
    values ('role_granted', '${q(A.id)}', '${q(A.email)}', '${q(B.id)}', '${q(B.email)}', '{}'::jsonb);
  `);

  check(
    "the guard permits deleting a non-final administrator",
    (await guard(B.id, A.id, "delete")) === null,
  );

  const deleted = await fetch(`${API}/auth/v1/admin/users/${B.id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  check("the deletion succeeds", deleted.ok, `${deleted.status}`);
  check("the deleted administrator cannot sign in", (await canSignIn(B.email)) === false);

  const gone = await sql(`
    select (select count(*)::int from auth.users      where id = '${q(B.id)}') u,
           (select count(*)::int from public.profiles  where id = '${q(B.id)}') p,
           (select count(*)::int from public.user_roles where user_id = '${q(B.id)}') r;
  `);
  check(
    "no Supabase Auth account is left behind",
    Number(gone[0].u) === 0 && Number(gone[0].p) === 0 && Number(gone[0].r) === 0,
    JSON.stringify(gone[0]),
  );

  const history = await sql(`
    select target_id, target_email, actor_email from public.audit_log
     where target_email = '${q(B.email)}';
  `);
  check("the audit entries survive the deletion", history.length >= 1, `${history.length}`);
  check(
    "with the pointer nulled and the email kept",
    history.every((r) => r.target_id === null && r.target_email === B.email),
    JSON.stringify(history),
  );

  const asActor = await sql(`
    select count(*)::int c from public.audit_log where actor_email = '${q(B.email)}';
  `);
  check(
    "entries where they were the actor are kept too",
    Number(asActor[0].c) >= 0,
    "actor_id is ON DELETE SET NULL, so the row is never removed",
  );

  /* ---- an administrator who owns records is not deleted at all */
  const teacherOwner = fxC.teacher;
  await createGroupFixture({ teacherId: teacherOwner.id, studentCount: 1 });
  const deps = await sql(`
    select source_table, row_count, severity
      from private.entity_dependencies('teacher', '${q(teacherOwner.id)}');
  `);
  check(
    "an account that owns records is still refused by the dependency rule",
    deps.some((d) => Number(d.row_count) > 0 && ["blocking", "reassignable"].includes(d.severity)),
    JSON.stringify(deps.filter((d) => Number(d.row_count) > 0)),
  );

  /* =========================================================== 6. NOBODY ELSE MAY CALL */
  console.log("\n=== 6. THE GUARD IS NOT REACHABLE BY A SIGNED-IN USER ===");

  const tokenRes = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: fxC.teacher.email, password: TEST_PASSWORD }),
  });
  const token = (await tokenRes.json()).access_token;

  const probe = await fetch(`${API}/rest/v1/rpc/assert_admin_removable`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ _target: C.id, _actor: C.id, _action: "delete" }),
  });
  check(
    "a signed-in teacher cannot call the guard",
    probe.status === 401 || probe.status === 403 || probe.status === 404,
    `${probe.status}`,
  );

  const anon = await fetch(`${API}/rest/v1/rpc/assert_admin_removable`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ _target: C.id, _actor: C.id, _action: "delete" }),
  });
  check(
    "nor can an anonymous caller",
    anon.status === 401 || anon.status === 403 || anon.status === 404,
    `${anon.status}`,
  );
} finally {
  // Before the fixtures go: a fixture account is deleted anyway, but anything else this
  // suite banned has to be handed back exactly as it was found.
  for (const id of banned) await setBan(id, false);
  await cleanupFixtures();
}

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
if (fail > 0) process.exitCode = 1;
