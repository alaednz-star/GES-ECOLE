/**
 * Profile photo upload: does it work, and can it be abused?
 *
 * The interesting questions are all about the storage policy, so they are asked over
 * the API with real tokens rather than through the UI. The one that matters most is the
 * last: user A must not be able to write into user B's folder, because a public bucket
 * with loose write rules lets anyone replace anyone's face.
 *
 * RUN ALONE -- `cleanup()` is global and happens once, in `finally`.
 *
 *   node scripts/e2e/verify-avatar-upload.mjs
 */
import { sql, API, PUBLISHABLE_KEY, TEST_PASSWORD, withFixtures } from "./fixtures.mjs";

const R = [];
const rec = (n, ok, d = "") => {
  R.push([n, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
};

const signIn = async (email) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return (await r.json()).access_token;
};

/** A 1x1 PNG. Real bytes, so the bucket's MIME sniffing has something to agree with. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const put = async (tok, path, body, contentType) => {
  const res = await fetch(`${API}/storage/v1/object/avatars/${path}`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${tok}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body,
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
};

const fx = await withFixtures({ teacher: true, student: true, admin: true });
const teacherTok = await signIn(fx.teacher.email);
const studentTok = await signIn(fx.student.email);

try {
  console.log("\n--- the bucket exists and is configured ---");
  const bucket = await sql(`select public, file_size_limit,
                                   array_to_string(allowed_mime_types, ',') as mimes
                              from storage.buckets where id = 'avatars';`);
  rec("the avatars bucket exists", bucket.length === 1, JSON.stringify(bucket[0]));
  rec("it is publicly readable", bucket[0]?.public === true);
  rec(
    "2 MB limit",
    Number(bucket[0]?.file_size_limit) === 2 * 1024 * 1024,
    `${bucket[0]?.file_size_limit}`,
  );
  rec(
    "JPEG, PNG and WEBP only",
    bucket[0]?.mimes === "image/jpeg,image/png,image/webp",
    String(bucket[0]?.mimes),
  );
  rec(
    "SVG is NOT accepted -- it is a script container on a public bucket",
    !String(bucket[0]?.mimes).includes("svg"),
  );

  console.log("\n--- a user can upload into their own folder ---");
  const own = await put(teacherTok, `${fx.teacher.id}/photo-a.png`, PNG, "image/png");
  rec("upload into own folder succeeds", own.ok, `HTTP ${own.status} ${own.text.slice(0, 120)}`);
  const stored = await sql(`select count(*)::int c from storage.objects
                             where bucket_id='avatars' and name='${fx.teacher.id}/photo-a.png';`);
  rec("the object is stored", stored[0].c === 1);

  console.log("\n--- and NOT into anyone else's ---");
  const cross = await put(studentTok, `${fx.teacher.id}/hijack.png`, PNG, "image/png");
  rec(
    "a student cannot write into the teacher's folder",
    !cross.ok,
    `HTTP ${cross.status} ${cross.text.slice(0, 120)}`,
  );
  const hijack = await sql(`select count(*)::int c from storage.objects
                             where bucket_id='avatars' and name like '%hijack%';`);
  rec("nothing landed", hijack[0].c === 0, `${hijack[0].c}`);

  const overwrite = await fetch(`${API}/storage/v1/object/avatars/${fx.teacher.id}/photo-a.png`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${studentTok}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: PNG,
  });
  rec(
    "a student cannot OVERWRITE the teacher's existing photo",
    !overwrite.ok,
    `HTTP ${overwrite.status}`,
  );

  const del = await fetch(`${API}/storage/v1/object/avatars`, {
    method: "DELETE",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${studentTok}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: [`${fx.teacher.id}/photo-a.png`] }),
  });
  void del;
  const survived = await sql(`select count(*)::int c from storage.objects
                               where bucket_id='avatars' and name='${fx.teacher.id}/photo-a.png';`);
  rec("nor delete it", survived[0].c === 1, `${survived[0].c}`);

  console.log("\n--- the file type is enforced by the bucket, not just the client ---");
  const svg = await put(
    teacherTok,
    `${fx.teacher.id}/evil.svg`,
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    "image/svg+xml",
  );
  rec("an SVG is refused by storage", !svg.ok, `HTTP ${svg.status} ${svg.text.slice(0, 100)}`);

  const tooBig = await put(
    teacherTok,
    `${fx.teacher.id}/huge.png`,
    Buffer.alloc(3 * 1024 * 1024, 1),
    "image/png",
  );
  rec("an oversized image is refused by storage", !tooBig.ok, `HTTP ${tooBig.status}`);

  console.log("\n--- the photo is readable, and the profile can point at it ---");
  const publicUrl = `${API}/storage/v1/object/public/avatars/${fx.teacher.id}/photo-a.png`;
  const anon = await fetch(publicUrl, { headers: { apikey: PUBLISHABLE_KEY } });
  rec("the stored photo is publicly readable", anon.ok, `HTTP ${anon.status}`);

  const upd = await fetch(`${API}/rest/v1/profiles?id=eq.${fx.teacher.id}`, {
    method: "PATCH",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${teacherTok}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ avatar_url: publicUrl }),
  });
  rec("the owner can point their profile at it", upd.ok, `HTTP ${upd.status}`);
  const persisted = await sql(
    `select avatar_url from public.profiles where id='${fx.teacher.id}';`,
  );
  rec(
    "and it persists -- which is what a refresh reads",
    persisted[0]?.avatar_url === publicUrl,
    String(persisted[0]?.avatar_url).slice(0, 90),
  );

  const foreign = await fetch(`${API}/rest/v1/profiles?id=eq.${fx.teacher.id}`, {
    method: "PATCH",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${studentTok}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ avatar_url: "https://evil.test/x.png" }),
  });
  void foreign;
  const unchanged = await sql(
    `select avatar_url from public.profiles where id='${fx.teacher.id}';`,
  );
  rec(
    "a student cannot repoint someone else's profile photo",
    unchanged[0]?.avatar_url === publicUrl,
    String(unchanged[0]?.avatar_url).slice(0, 90),
  );
} finally {
  /*
    ONLY the fixtures' own folders.

    This used to delete every object in the `avatars` bucket. Every path the suite writes is
    under a fixture user's own id -- the storage policy is the thing being tested and it does
    not allow anything else -- so the wider delete was never needed, and it took the local
    demo teachers' photos with it every run. On a developer's machine it would take theirs.
  */
  const owners = [fx.teacher?.id, fx.student?.id, fx.admin?.id].filter(Boolean);
  const paths = await sql(`select name from storage.objects
                            where bucket_id='avatars'
                              and (${owners.map((id) => `name like '${id}/%'`).join(" or ")});`);
  if (paths.length > 0) {
    await fetch(`${API}/storage/v1/object/avatars`, {
      method: "DELETE",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${await signIn(fx.admin.email)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: paths.map((p) => p.name) }),
    });
  }
  await fx.cleanup();
}

const failures = R.filter((r) => !r[1]).length;
console.log(`\n${failures} FAILURES / ${R.length} checks`);
process.exit(failures > 0 ? 1 : 0);
