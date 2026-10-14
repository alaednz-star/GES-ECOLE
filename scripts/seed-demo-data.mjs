/**
 * A complete local demo dataset for manual testing.
 *
 * LOCAL ONLY. It reaches the database through `scripts/e2e/fixtures.mjs`, whose first act is
 * to refuse any Supabase URL that is not 127.0.0.1/localhost, and it writes through
 * `/pg/query`, which only exists on the local stack. There is no code path here that can
 * touch production.
 *
 * WHAT IT DOES NOT DO
 *
 * No schema, no migration, no policy, no trigger. Every row goes in through the same
 * constraints the application obeys, which is the point: if the seed can produce a state,
 * the app can too, and if it cannot, the seed is wrong rather than the database.
 *
 * Specifically it respects, rather than works around:
 *   * `provision_staff` -- the ONLY way a role is granted here. Nothing writes `user_roles`
 *     directly and no client chooses its own role.
 *   * `enforce_group_capacity` -- only APPROVED registrations consume a seat, so every
 *     enrolment is inserted as `pending` and then decided.
 *   * `enforce_one_group_per_subject` -- one active enrolment per (subject, level). This is
 *     what makes the second maths group render as `takenSubject`, and it is why no filler
 *     student appears in both maths groups.
 *   * `t_registration_decided`, `t_resources_notify_publication`,
 *     `t_chapters_notify_publication` -- notifications are NOT inserted by hand. They are
 *     produced by deciding registrations and publishing content, in that order, because a
 *     resource published before anyone is enrolled notifies nobody.
 *   * `validate_teacher_qualification` -- `teacher_subjects` is written before any group is
 *     assigned to a teacher.
 *   * the `avatars` and `course-resources` buckets -- photos and PDFs are uploaded as real
 *     objects on the real paths (`<uid>/…` and `<groupId>/<uuid>/<name>`), never faked with
 *     a hardcoded URL.
 *
 * REPEATABLE
 *
 * Safe to run as often as you like. Demo-owned content (the six groups and everything that
 * hangs off them, plus the filler students) is removed and rebuilt deterministically; the
 * three login accounts are reused and their passwords reset rather than duplicated.
 *
 *   node scripts/seed-demo-data.mjs              # reseed the demo data, leave other rows alone
 *   node scripts/seed-demo-data.mjs --fresh      # also clear OTHER local groups and e2e debris
 *
 * `--fresh` deletes school CONTENT only. It never deletes a human's account -- your own
 * admin login survives it; it simply ends up with no groups.
 *
 * The demo emails end in `@demo.gestion-ecole.local` and no demo group is named `e2e-fixture…`, so the
 * e2e harness's global `cleanupFixtures()` cannot delete any of this.
 */

import { chromium } from "playwright-core";
import { API, SERVICE_ROLE_KEY, sql } from "./e2e/fixtures.mjs";

const FRESH = process.argv.includes("--fresh");
const H = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

const step = (n) => console.log(`\n=== ${n}`);
const done = (n) => console.log(`    ${n}`);
const q = (s) => s.replace(/'/g, "''");

/**
 * The first branded deployment.
 *
 * Colours measured from the raster identity the school supplied, not from a source file --
 * they are the working values until the vector original arrives.
 *
 * `logo_url` is deliberately absent from this constant and never written by the seed. The
 * logo is uploaded through the admin screen and lives in the `branding` bucket, so its URL
 * is per-installation; writing one here would either hardcode a local address or wipe the
 * logo an administrator had just uploaded, every time the seed ran.
 */
const BRAND = {
  name: "Gestion École",
  tagline: "Toute la vie de l'établissement, au même endroit.",
  primary: "#0F4C5C",
  gold: "#C9A227",
  cream: "#FBF8F2",
  /*
    A neutral demonstration description, in three paragraphs in every language (the page puts
    the first in the hero and the rest under "our approach"). A real school replaces it from
    Paramètres > Identité; the seed never overwrites a description an administrator wrote.
  */
  aboutAr: [
    "Gestion École منصة لتنظيم الحياة اليومية للمؤسسة التعليمية: التلاميذ، الأفواج، الحضور والمدفوعات.",
    "نوفر للإدارة والأساتذة أدوات واضحة لمتابعة كل تلميذ وكل حصة دون أوراق متفرقة.",
    "هدفنا أن يتفرغ الفريق التربوي للتعليم، وأن يجد الأولياء والتلاميذ المعلومة في وقتها.",
  ].join("\n\n"),
  aboutFr: [
    "Gestion École organise la vie quotidienne de l’établissement : élèves, groupes, présences et paiements.",
    "L’administration et les enseignants disposent d’outils clairs pour suivre chaque élève et chaque séance, sans papiers éparpillés.",
    "Notre objectif : laisser l’équipe pédagogique se consacrer à l’enseignement, et donner aux familles l’information au bon moment.",
  ].join("\n\n"),
  aboutEn: [
    "Gestion École organises the school's daily life: students, groups, attendance and payments.",
    "Administrators and teachers get clear tools to follow every student and every session, without scattered paperwork.",
    "Our goal: let the teaching team focus on teaching, and give families the right information at the right time.",
  ].join("\n\n"),
};

/* ------------------------------------------------------------------ the dataset */

const ADMIN = {
  email: "admin.demo@demo.gestion-ecole.local",
  password: "AdminDemo2026!",
  fullName: "Nadia Mokrani",
  phone: "0661 22 33 44",
};

/** The first teacher is the documented TEACHER login. The other two exist because a group
 *  needs a qualified owner, and `teachers.id` references a real account. */
const TEACHERS = [
  {
    email: "teacher.demo@demo.gestion-ecole.local",
    password: "TeacherDemo2026!",
    fullName: "Karim Belkacem",
    phone: "0770 11 22 33",
    years: 14,
    bio: "Professeur de mathématiques, quatorze ans en terminale scientifique. Prépare au baccalauréat par séries d'exercices progressives et corrigés détaillés.",
    subjects: ["mathematics"],
    avatar: { from: "#0F766E", to: "#14B8A6" },
  },
  {
    email: "mehdi.demo@demo.gestion-ecole.local",
    password: "TeacherDemo2026!",
    fullName: "Mehdi Saadi",
    phone: "0550 44 55 66",
    years: 9,
    bio: "Professeur de physique. Neuf ans d'expérience, travaux pratiques réguliers et beaucoup d'exercices de mécanique et d'électricité.",
    subjects: ["physics"],
    avatar: { from: "#0E7490", to: "#22D3EE" },
  },
  {
    email: "sarah.demo@demo.gestion-ecole.local",
    password: "TeacherDemo2026!",
    fullName: "Sarah Benali",
    phone: "0664 77 88 99",
    years: 6,
    bio: "Professeure de sciences naturelles, également en charge des cours de langues. Six ans d'expérience, approche par schémas et fiches de révision.",
    subjects: ["natural_sciences", "french", "english"],
    avatar: { from: "#15803D", to: "#4ADE80" },
  },
];

const STUDENT = {
  email: "student.demo@demo.gestion-ecole.local",
  password: "StudentDemo2026!",
  fullName: "Yacine Haddad",
  phone: "0555 12 34 56",
};

/**
 * `fill` is how many FILLER students end up approved, chosen so the admin capacity views
 * read like a real term: comfortable, tight, and one group genuinely full.
 *
 * `weekday` is 0 = Sunday, matching `dash.weekday.0` and `Date.getDay()`.
 */
const GROUPS = [
  {
    key: "maths-a5",
    name: "3AS Sciences — Mathématiques",
    subject: "mathematics",
    teacher: 0,
    room: "A5",
    weekday: 0,
    from: "14:00",
    to: "16:00",
    capacity: 20,
    fill: 13,
  },
  {
    key: "maths-a6",
    name: "3AS Sciences — Mathématiques",
    subject: "mathematics",
    teacher: 0,
    room: "A6",
    weekday: 2,
    from: "16:00",
    to: "18:00",
    capacity: 18,
    fill: 0,
  },
  {
    key: "phys-b2",
    name: "3AS Sciences — Physique",
    subject: "physics",
    teacher: 1,
    room: "B2",
    weekday: 1,
    from: "14:00",
    to: "16:00",
    capacity: 15,
    fill: 12,
  },
  {
    key: "svt-c1",
    name: "3AS Sciences — Sciences Naturelles",
    subject: "natural_sciences",
    teacher: 2,
    room: "C1",
    weekday: 3,
    from: "15:00",
    to: "17:00",
    capacity: 20,
    fill: 20,
  },
  {
    key: "fr-a3",
    name: "3AS Sciences — Français",
    subject: "french",
    teacher: 2,
    room: "A3",
    weekday: 4,
    from: "16:00",
    to: "18:00",
    capacity: 18,
    fill: 8,
  },
  {
    key: "en-a2",
    name: "3AS Sciences — Anglais",
    subject: "english",
    teacher: 2,
    room: "A2",
    weekday: 6,
    from: "10:00",
    to: "12:00",
    capacity: 20,
    fill: 10,
  },
];

const FILLERS = 20;

/** Chapters, and the resources under them. `pub: false` = deliberately unpublished. */
const CONTENT = [
  {
    group: "maths-a5",
    chapters: [
      {
        title: "Fonctions numériques",
        pub: true,
        resources: [
          {
            title: "Cours — Fonctions numériques",
            role: "notes",
            file: "cours-fonctions.pdf",
            download: true,
            pub: true,
          },
          {
            title: "Série d'exercices n°1 — Limites",
            role: "exercises",
            file: "serie-1-limites.pdf",
            download: true,
            pub: true,
          },
        ],
      },
      {
        title: "Dérivation",
        pub: true,
        resources: [
          {
            title: "Vidéo — Règles de dérivation",
            role: "video",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            pub: true,
          },
          // Consultable in the browser but not saveable: the download rule is enforced
          // server-side, so this is a real test of it and not a hidden button.
          {
            title: "Corrigé — Série n°1 (consultation en ligne)",
            role: "solutions",
            file: "corrige-serie-1.pdf",
            download: false,
            pub: true,
          },
        ],
      },
      {
        title: "Probabilités",
        pub: true,
        resources: [
          // Not published: the teacher sees it, the student must not.
          {
            title: "Devoir surveillé n°2 (brouillon)",
            role: "homework",
            file: "ds-2-probabilites.pdf",
            download: true,
            pub: false,
          },
        ],
      },
      {
        // Chapter unpublished with a PUBLISHED resource inside, so the AND rule
        // (chapter published AND resource published) has something to prove.
        title: "Nombres complexes",
        pub: false,
        resources: [
          {
            title: "Notes — Forme trigonométrique",
            role: "notes",
            file: "notes-complexes.pdf",
            download: true,
            pub: true,
          },
        ],
      },
    ],
  },
  {
    group: "phys-b2",
    chapters: [
      {
        title: "Mécanique",
        pub: true,
        resources: [
          {
            title: "Cours — Lois de Newton",
            role: "notes",
            file: "cours-newton.pdf",
            download: true,
            pub: true,
          },
          {
            title: "Vidéo — Chute libre en TP",
            role: "video",
            url: "https://www.youtube.com/watch?v=Xn3wPXPFsHo",
            pub: true,
          },
        ],
      },
      {
        title: "Électricité",
        pub: true,
        resources: [
          {
            title: "Série — Circuits RC",
            role: "exercises",
            file: "serie-circuits-rc.pdf",
            download: true,
            pub: true,
          },
        ],
      },
      { title: "Ondes", pub: false, resources: [] },
    ],
  },
];

/* ------------------------------------------------------------------ file builders */

/** A real, structurally valid single-page PDF with a title. Not a renamed text file. */
function makePdf(title, subtitle) {
  const esc = (t) => t.replace(/([\\()])/g, "\\$1");
  const body =
    `BT /F1 20 Tf 60 770 Td (${esc(title)}) Tj ET\n` +
    `BT /F1 12 Tf 60 742 Td (${esc(subtitle)}) Tj ET\n` +
    `BT /F1 11 Tf 60 700 Td (Document de demonstration - Gestion Ecole, environnement local.) Tj ET\n`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** Renders an avatar PNG. Real image bytes, produced the same way a photo would arrive. */
async function makeAvatar(page, fullName, from, to) {
  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
  await page.setViewportSize({ width: 256, height: 256 });
  await page.setContent(
    `<body style="margin:0"><div style="width:256px;height:256px;display:grid;place-items:center;
      background:linear-gradient(135deg,${from},${to});font-family:Inter,Segoe UI,sans-serif;
      color:#fff;font-size:104px;font-weight:600;letter-spacing:2px">${initials}</div></body>`,
  );
  return page.screenshot({ type: "png" });
}

async function upload(bucket, path, body, contentType) {
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    method: "POST",
    headers: { ...H, "Content-Type": contentType, "x-upsert": "true" },
    body,
  });
  if (!res.ok) throw new Error(`upload ${bucket}/${path}: ${res.status} ${await res.text()}`);
  return path;
}

/* ------------------------------------------------------------------ accounts */

/**
 * Creates the account, or resets the existing one. Never duplicates.
 *
 * The role goes in through `provision_staff` for staff. Students keep the identity
 * `handle_new_user` already gave them, which is the same path a real signup takes.
 */
async function upsertUser({ email, password, fullName, phone, role, years, bio }) {
  const found = await sql(`select id from auth.users where email = '${q(email)}';`);
  let id = found[0]?.id;

  if (id) {
    const res = await fetch(`${API}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, demo: true },
      }),
    });
    if (!res.ok) throw new Error(`reset ${email}: ${res.status} ${await res.text()}`);
  } else {
    const res = await fetch(`${API}/auth/v1/admin/users`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, demo: true },
        app_metadata: { demo: true },
      }),
    });
    if (!res.ok) throw new Error(`create ${email}: ${res.status} ${await res.text()}`);
    id = (await res.json()).id;
  }

  await sql(`update public.profiles
                set full_name = '${q(fullName)}', phone = '${q(phone ?? "")}'
              where id = '${id}';`);

  if (role === "admin" || role === "teacher") {
    await sql(
      `select public.provision_staff('${id}'::uuid, '${role}'::app_role, ${years ?? 0},
         ${bio ? `'${q(bio)}'` : "null"}, '${q(phone ?? "")}');`,
    );
  }

  // `provision_staff` sets password_change_required so a real hire must rotate the temporary
  // password. A documented demo login has to work as documented, so it is cleared here --
  // the only place this seed steps outside the production path, and it changes a UX flag,
  // not an authorisation rule.
  await sql(`update public.profiles set password_change_required = false where id = '${id}';`);
  return id;
}

/* ------------------------------------------------------------------ run */

console.log(`Gestion École -- local demo seed${FRESH ? "  (--fresh)" : ""}`);
console.log(`target: ${API}`);

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  /* ---------------------------------------------------------- reference data */
  step("Reference data (reused, never duplicated)");
  const level = (
    await sql(`select id from public.levels where name = '3ème année secondaire';`)
  )[0];
  if (!level) throw new Error("level '3ème année secondaire' is missing -- run the migrations");
  const stream = (
    await sql(`select id from public.streams
                where level_id = '${level.id}' and code = 'sciences';`)
  )[0];
  if (!stream) throw new Error("stream 'sciences' is missing for that level");
  const subjectRows = await sql(`select key, id, name from public.subjects;`);
  const subjects = Object.fromEntries(subjectRows.map((r) => [r.key, r]));
  for (const k of ["mathematics", "physics", "natural_sciences", "french", "english"]) {
    if (!subjects[k]) throw new Error(`subject '${k}' is missing`);
  }
  done(`level + stream 'Sciences expérimentales' + ${subjectRows.length} subjects found`);

  /* ---------------------------------------------------------- branding */
  step("School identity (the deployment's own branding)");
  /*
    This deployment represents one school, so its identity lives on the `center_settings`
    singleton -- the same row an administrator edits at /dashboard/settings.
    `BrandProvider` reads it and rewrites `--primary`, the sidebar tokens and the brand
    gradient; nothing about the school is hard-coded in React.

    The colours are the values read off the raster reference the school supplied. They are
    APPROXIMATE and are labelled as such until the source brand file arrives -- which is
    also why no logo is set: there is no usable asset in the repository, and inventing one
    would be worse than the fallback mark.
  */
  await sql(`update public.center_settings
                set school_name = '${q(BRAND.name)}',
                    tagline     = '${q(BRAND.tagline)}',
                    primary_color   = '${BRAND.primary}',
                    brand_gold      = '${BRAND.gold}',
                    brand_gold_soft = '${BRAND.cream}',
                    about_ar        = '${q(BRAND.aboutAr)}',
                    about_fr        = '${q(BRAND.aboutFr)}',
                    about_en        = '${q(BRAND.aboutEn)}'
              where id = true;`);
  done(`${BRAND.name} -- navy ${BRAND.primary}, gold ${BRAND.gold}, description in ar/fr/en`);

  /* ---------------------------------------------------------- accounts */
  step("Accounts");
  const adminId = await upsertUser({ ...ADMIN, role: "admin" });
  done(`admin   ${ADMIN.email}`);

  const teacherIds = [];
  for (const t of TEACHERS) {
    const id = await upsertUser({ ...t, role: "teacher", years: t.years, bio: t.bio });
    teacherIds.push(id);
    for (const key of t.subjects) {
      await sql(`insert into public.teacher_subjects (teacher_id, subject_id)
                 values ('${id}', '${subjects[key].id}') on conflict do nothing;`);
    }
    done(`teacher ${t.email.padEnd(28)} ${t.fullName} -- ${t.subjects.join(", ")}`);
  }

  const studentId = await upsertUser({ ...STUDENT, role: "student" });
  await sql(`update public.students
                set gender = 'male', date_of_birth = '2008-04-17',
                    guardian_name = 'Karim Haddad', guardian_phone = '0555 98 76 54',
                    address = 'Cité 200 Logements, Batna',
                    level_id = '${level.id}', stream_id = '${stream.id}',
                    onboarded_at = now()
              where id = '${studentId}';`);
  done(`student ${STUDENT.email.padEnd(28)} ${STUDENT.fullName} -- onboarded, 3AS Sciences`);

  /* ---------------------------------------------------------- clear demo content */
  step("Clearing previous demo content");
  const owned = teacherIds.map((id) => `'${id}'`).join(",");
  if (FRESH) {
    const others = await sql(
      `select count(*)::int n from public.groups where teacher_id not in (${owned});`,
    );
    // Payments first: payments.registration_id is ON DELETE RESTRICT (20260930100100).
    await sql(`delete from public.payments p using public.registrations r, public.groups g
                where p.registration_id = r.id and r.group_id = g.id
                  and g.teacher_id not in (${owned});`);
    await sql(`delete from public.groups where teacher_id not in (${owned});`);
    done(`--fresh: removed ${others[0].n} non-demo group(s) and their content`);
    const debris = await sql(
      `select id from auth.users where email like 'e2e-fixture-%@example.test';`,
    );
    for (const d of debris) {
      await fetch(`${API}/auth/v1/admin/users/${d.id}`, { method: "DELETE", headers: H }).catch(
        () => {},
      );
    }
    done(`--fresh: removed ${debris.length} leftover e2e-fixture account(s)`);
  }
  // Payments first: payments.registration_id is ON DELETE RESTRICT (20260930100100), so a
  // demo group carrying payments would refuse to go. Demo groups only -- nothing else.
  await sql(`delete from public.payments p using public.registrations r, public.groups g
              where p.registration_id = r.id and r.group_id = g.id
                and g.teacher_id in (${owned});`);
  const gone = await sql(
    `with d as (delete from public.groups where teacher_id in (${owned}) returning 1)
     select count(*)::int n from d;`,
  );
  done(`removed ${gone[0].n} demo group(s); registrations, chapters and resources cascaded`);

  // Notifications reference the user, not the group, so deleting groups does not cascade to
  // them and a reseed would keep stacking. Clear the demo audience's own rows so the counts
  // this script reports are the counts this run produced.
  const clearedNotifs = await sql(
    `with d as (
       delete from public.notifications
        where user_id in (select id from auth.users
                           where email like '%@demo.gestion-ecole.local'
                              or email like '%@madrasti.local' -- demo accounts of earlier versions
                              or email like 'demo.eleve.%')
        returning 1)
     select count(*)::int n from d;`,
  );
  done(`cleared ${clearedNotifs[0].n} previous demo notification(s)`);

  const oldFillers = await sql(
    `select id from auth.users
      where email like 'demo.eleve.%@demo.gestion-ecole.local' or email like 'demo.eleve.%@madrasti.local';`,
  );
  for (const f of oldFillers) {
    await fetch(`${API}/auth/v1/admin/users/${f.id}`, { method: "DELETE", headers: H }).catch(
      () => {},
    );
  }
  done(`removed ${oldFillers.length} previous filler student(s)`);

  /* ---------------------------------------------------------- avatars */
  step("Teacher photos (uploaded to the avatars bucket, like any real upload)");
  for (const [i, t] of TEACHERS.entries()) {
    const png = await makeAvatar(page, t.fullName, t.avatar.from, t.avatar.to);
    const path = `${teacherIds[i]}/avatar.png`;
    await upload("avatars", path, png, "image/png");
    const url = `${API}/storage/v1/object/public/avatars/${path}`;
    await sql(`update public.profiles set avatar_url = '${url}' where id = '${teacherIds[i]}';`);
    done(`${t.fullName.padEnd(20)} ${png.length} bytes -> ${path}`);
  }

  /* ---------------------------------------------------------- groups */
  step("Groups");
  const groupIds = {};
  for (const g of GROUPS) {
    const row = (
      await sql(`insert into public.groups
                   (name, subject_id, teacher_id, level_id, stream_id, max_students, price_dzd,
                    status, start_date, end_date)
                 values ('${q(g.name)}', '${subjects[g.subject].id}', '${teacherIds[g.teacher]}',
                         '${level.id}', '${stream.id}', ${g.capacity}, 0, 'active',
                         date_trunc('month', current_date)::date - 30,
                         date_trunc('month', current_date)::date + 210)
                 returning id;`)
    )[0];
    groupIds[g.key] = row.id;
    await sql(`insert into public.group_schedules (group_id, weekday, start_time, end_time, room)
               values ('${row.id}', ${g.weekday}, '${g.from}', '${g.to}', '${g.room}');`);
    done(`${g.name} — salle ${g.room}, jour ${g.weekday} ${g.from}-${g.to}, ${g.capacity} places`);
  }

  /* ---------------------------------------------------------- filler students */
  step(`Filler students (${FILLERS}) -- these make the capacity figures real`);
  const FIRST = [
    "Amine",
    "Meriem",
    "Yasmine",
    "Oussama",
    "Lina",
    "Rayan",
    "Nour",
    "Anis",
    "Salma",
    "Ilyes",
  ];
  const LAST = ["Belkacem", "Zerrouki", "Cherif", "Mansouri", "Bouzid", "Larbi"];
  const fillerIds = [];
  for (let i = 0; i < FILLERS; i++) {
    const fullName = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;
    const id = await upsertUser({
      email: `demo.eleve.${String(i + 1).padStart(2, "0")}@demo.gestion-ecole.local`,
      password: "EleveDemo2026!",
      fullName,
      phone: `0${560 + i} 00 00 00`,
      role: "student",
    });
    await sql(`update public.students
                  set gender = '${i % 2 === 0 ? "male" : "female"}',
                      date_of_birth = '2008-0${(i % 9) + 1}-1${i % 9}',
                      guardian_name = 'Parent ${q(fullName)}',
                      guardian_phone = '0770 00 00 ${String(10 + i).slice(0, 2)}',
                      level_id = '${level.id}', stream_id = '${stream.id}',
                      onboarded_at = now()
                where id = '${id}';`);
    fillerIds.push(id);
  }
  done(`${fillerIds.length} students created, onboarded into 3AS Sciences expérimentales`);

  /* ---------------------------------------------------------- enrolments */
  step("Enrolments -- inserted as pending, then decided, so capacity and notifications behave");
  for (const g of GROUPS) {
    if (g.fill === 0) continue;
    const ids = fillerIds.slice(0, g.fill);
    await sql(`insert into public.registrations (student_id, group_id, status, created_at)
               values ${ids
                 .map(
                   (id) => `('${id}', '${groupIds[g.key]}', 'pending', now() - interval '10 days')`,
                 )
                 .join(",")};`);
    await sql(`update public.registrations
                  set status = 'approved', decided_at = now() - interval '3 days'
                where group_id = '${groupIds[g.key]}' and status = 'pending';`);
    done(`${g.name} — salle ${g.room}: ${g.fill}/${g.capacity} approuvés`);
  }

  step("The demo student's three registration states");
  const reg = async (key, status, note) => {
    const r = (
      await sql(`insert into public.registrations (student_id, group_id, status, created_at)
                 values ('${studentId}', '${groupIds[key]}', 'pending', now() - interval '5 days')
                 returning id;`)
    )[0];
    if (status !== "pending") {
      await sql(`update public.registrations
                    set status = '${status}', decided_at = now() - interval '1 day'
                        ${note ? `, note = '${q(note)}'` : ""}
                  where id = '${r.id}';`);
    }
    return r.id;
  };
  await reg("maths-a5", "approved");
  done("APPROVED  3AS Sciences — Mathématiques (A5)");
  await reg("phys-b2", "pending");
  done("PENDING   3AS Sciences — Physique (B2)");
  await reg(
    "fr-a3",
    "rejected",
    "Groupe complet au moment de la demande. Une place se libérera peut-être après les vacances d'hiver — merci de renvoyer une demande à ce moment-là.",
  );
  done("REJECTED  3AS Sciences — Français (A3), with a note");
  done("TAKEN     3AS Sciences — Mathématiques (A6) now renders as `takenSubject`");

  /* ---------------------------------------------------------- content */
  step("Chapters and resources");
  for (const block of CONTENT) {
    const groupId = groupIds[block.group];
    const teacherId = (
      await sql(`select teacher_id from public.groups where id = '${groupId}';`)
    )[0].teacher_id;

    for (const [ci, ch] of block.chapters.entries()) {
      const chapter = (
        await sql(`insert into public.chapters
                     (group_id, title, position, is_published, published_at, created_by)
                   values ('${groupId}', '${q(ch.title)}', ${ci + 1}, ${ch.pub},
                           ${ch.pub ? "now()" : "null"}, '${teacherId}')
                   returning id;`)
      )[0];
      done(`chapitre ${ch.pub ? "[publié]  " : "[masqué]  "}${ch.title}`);

      for (const [ri, r] of ch.resources.entries()) {
        let storagePath = null;
        let mime = null;
        let size = null;
        if (r.file) {
          const pdf = makePdf(r.title, `${ch.title} — 3AS Sciences expérimentales`);
          storagePath = `${groupId}/${crypto.randomUUID()}/${r.file}`;
          await upload("course-resources", storagePath, pdf, "application/pdf");
          mime = "application/pdf";
          size = pdf.length;
        }
        await sql(`insert into public.resources
                     (chapter_id, group_id, title, kind, storage_path, url, mime_type,
                      size_bytes, position, role, allow_download, is_published, published_at,
                      created_by, file_name)
                   values ('${chapter.id}', '${groupId}', '${q(r.title)}',
                           '${r.file ? "file" : "link"}',
                           ${storagePath ? `'${q(storagePath)}'` : "null"},
                           ${r.url ? `'${q(r.url)}'` : "null"},
                           ${mime ? `'${mime}'` : "null"}, ${size ?? "null"}, ${ri + 1},
                           '${r.role}', ${r.download ?? true}, ${r.pub},
                           ${r.pub ? "now()" : "null"}, '${teacherId}',
                           ${r.file ? `'${q(r.file)}'` : "null"});`);
        done(
          `   ${r.pub ? "publié " : "masqué "}${r.role.padEnd(10)}${r.download === false ? "en ligne seulement  " : ""}${r.title}`,
        );
      }
    }
  }

  /* ---------------------------------------------------------- engagement */
  step("Some engagement, so the teacher's statistics are not empty");
  const opened = await sql(
    /*
      Every OTHER student on each visible resource has opened it, ranked by student id.

      Not `random()`, and not a hash of the ids either: the rows are recreated on every
      reseed so their uuids change, and a hash of a fresh uuid is a fresh coin toss. Ranking
      gives exactly ceil(n/2) events per resource whatever the ids happen to be, so the
      teacher's engagement panel shows the same figures every run -- roughly half opened,
      half not, which is what makes the "who has not opened this?" list worth looking at.
    */
    `insert into public.resource_events (resource_id, student_id, kind, occurred_at)
     select resource_id, student_id, 'view', now() - (rn * interval '5 hours')
       from (
         select r.id as resource_id, reg.student_id,
                row_number() over (partition by r.id order by reg.student_id) as rn
           from public.resources r
           join public.registrations reg
             on reg.group_id = r.group_id and reg.status = 'approved'
          where r.is_published
            and exists (select 1 from public.chapters c
                         where c.id = r.chapter_id and c.is_published)
       ) ranked
      where rn % 2 = 1
     returning 1;`,
  );
  done(`${opened.length} resource view events recorded`);

  /* ---------------------------------------------------------- verify */
  step("Verification");
  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push([name, ok]);
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`);
  };

  const roles = await sql(
    `select p.email, string_agg(ur.role::text, ',') roles,
            (select count(*) from public.teachers t where t.id = p.id)::int as t,
            (select count(*) from public.students s where s.id = p.id)::int as s
       from public.profiles p
       left join public.user_roles ur on ur.user_id = p.id
      where p.email in ('${ADMIN.email}', ${TEACHERS.map((x) => `'${x.email}'`).join(",")},
                        '${STUDENT.email}')
      group by p.id, p.email order by p.email;`,
  );
  for (const r of roles) {
    const expected =
      r.email === ADMIN.email ? "admin" : r.email === STUDENT.email ? "student" : "teacher";
    // An admin has NO teachers row and NO students row: `provision_staff` creates a teacher
    // identity only for the teacher role, and asserts any stale student identity is gone.
    // A teacher has exactly one teachers row, a student exactly one students row.
    const identityOk =
      expected === "admin"
        ? r.t === 0 && r.s === 0
        : expected === "teacher"
          ? r.t === 1 && r.s === 0
          : r.t === 0 && r.s === 1;
    check(
      `${r.email} has exactly the ${expected} role and the right identity rows`,
      r.roles === expected && identityOk,
      `roles=${r.roles} teacher=${r.t} student=${r.s}`,
    );
  }

  const caps = await sql(
    `select g.name, gs.room, g.max_students cap,
            count(r.id) filter (where r.status='approved')::int approved
       from public.groups g
       join public.group_schedules gs on gs.group_id = g.id
       left join public.registrations r on r.group_id = g.id
      where g.teacher_id in (${owned})
      group by g.name, gs.room, g.max_students order by gs.room;`,
  );
  for (const c of caps) {
    check(
      `${c.name} (${c.room}) is ${c.approved}/${c.cap} and within capacity`,
      c.approved <= c.cap,
    );
  }

  const dup = await sql(
    `select count(*)::int n from (
       select 1 from public.registrations
        where status in ('pending','approved') and subject_id is not null and level_id is not null
        group by student_id, subject_id, level_id having count(*) > 1) d;`,
  );
  check(
    "no student holds two active enrolments in one subject+level",
    dup[0].n === 0,
    `${dup[0].n}`,
  );

  const orphans = await sql(
    `select (select count(*) from public.resources r
              where not exists (select 1 from public.chapters c where c.id = r.chapter_id))::int a,
            (select count(*) from public.registrations r
              where not exists (select 1 from public.groups g where g.id = r.group_id))::int b,
            (select count(*) from public.groups g where g.teacher_id is null)::int c;`,
  );
  check(
    "no orphaned resources, registrations or teacherless groups",
    orphans[0].a === 0 && orphans[0].b === 0 && orphans[0].c === 0,
    JSON.stringify(orphans[0]),
  );

  const photos = await sql(
    `select count(*)::int n from public.profiles p
      where p.id in (${owned}) and p.avatar_url is not null;`,
  );
  check("all three teachers have a stored photo", photos[0].n === 3, `${photos[0].n}/3`);
  for (const [i, t] of TEACHERS.entries()) {
    const url = `${API}/storage/v1/object/public/avatars/${teacherIds[i]}/avatar.png`;
    const res = await fetch(url);
    check(`${t.fullName}'s photo is publicly readable`, res.ok, `HTTP ${res.status}`);
  }

  const notif = await sql(
    `select kind::text, count(*)::int n from public.notifications group by kind order by kind;`,
  );
  check(
    "notifications were produced by the triggers, not inserted",
    notif.length > 0,
    notif.map((x) => `${x.kind}=${x.n}`).join(" "),
  );

  const student = await sql(
    `select status::text, count(*)::int n from public.registrations
      where student_id = '${studentId}' group by status order by status;`,
  );
  check(
    "the demo student has approved + pending + rejected",
    student.length === 3,
    student.map((x) => `${x.status}=${x.n}`).join(" "),
  );

  const failures = checks.filter((c) => !c[1]).length;

  /* ---------------------------------------------------------- summary */
  const counts = await sql(
    `select (select count(*) from public.groups where teacher_id in (${owned}))::int groups,
            (select count(*) from public.chapters c join public.groups g on g.id=c.group_id
              where g.teacher_id in (${owned}))::int chapters,
            (select count(*) from public.resources r join public.groups g on g.id=r.group_id
              where g.teacher_id in (${owned}))::int resources,
            (select count(*) from public.registrations r join public.groups g on g.id=r.group_id
              where g.teacher_id in (${owned}))::int registrations,
            (select count(*) from public.notifications)::int notifications,
            (select count(*) from public.resource_events)::int events,
            (select count(*) from public.groups)::int all_groups;`,
  );
  const c = counts[0];
  console.log(`
=== Seeded
    teachers        3   (${TEACHERS.map((t) => t.fullName).join(", ")})
    students        ${FILLERS + 1}  (${FILLERS} filler + 1 demo login)
    groups          ${c.groups}   (of ${c.all_groups} total in this local database)
    registrations   ${c.registrations}
    chapters        ${c.chapters}
    resources       ${c.resources}
    notifications   ${c.notifications}  (produced by triggers)
    view events     ${c.events}

=== Logins
    admin    ${ADMIN.email}  /  ${ADMIN.password}
    teacher  ${TEACHERS[0].email}  /  ${TEACHERS[0].password}
    student  ${STUDENT.email}  /  ${STUDENT.password}
    (also ${TEACHERS[1].email} and ${TEACHERS[2].email}, password ${TEACHERS[1].password})

${failures === 0 ? "All seed checks passed." : `${failures} SEED CHECK FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
}
