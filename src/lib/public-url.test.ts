import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { publicOriginFor, publicUrlFor } from "./public-url.ts";

const WEB = "https://ecole.example.com";
const TAURI = "http://tauri.localhost";

test("web: links use the page's own origin, as before", () => {
  assert.equal(publicOriginFor({ isDesktop: false, serverOrigin: "", pageOrigin: WEB }), WEB);
  assert.equal(
    publicOriginFor({ isDesktop: false, serverOrigin: "https://other.example", pageOrigin: WEB }),
    WEB,
  );
});

test("desktop: links use the web deployment, never the app's internal origin", () => {
  const origin = publicOriginFor({ isDesktop: true, serverOrigin: WEB, pageOrigin: TAURI });
  assert.equal(origin, WEB);
  assert.equal(origin.includes("tauri.localhost"), false);
});

test("desktop: a trailing slash or a path on the configured address is dropped", () => {
  assert.equal(
    publicOriginFor({ isDesktop: true, serverOrigin: `${WEB}/`, pageOrigin: TAURI }),
    WEB,
  );
  assert.equal(
    publicOriginFor({ isDesktop: true, serverOrigin: `${WEB}/app/`, pageOrigin: TAURI }),
    WEB,
  );
  assert.equal(
    publicOriginFor({ isDesktop: true, serverOrigin: "http://localhost:8080", pageOrigin: TAURI }),
    "http://localhost:8080",
  );
});

test("desktop without a configured web address fails loudly instead of building a dead link", () => {
  assert.throws(
    () => publicOriginFor({ isDesktop: true, serverOrigin: "", pageOrigin: TAURI }),
    /VITE_SERVER_ORIGIN/,
  );
});

test("publicUrlFor: redirect paths are exact, with or without a trailing slash on the origin", () => {
  assert.equal(publicUrlFor(WEB, "/reset-password"), `${WEB}/reset-password`);
  assert.equal(publicUrlFor(`${WEB}/`, "/reset-password"), `${WEB}/reset-password`);
  assert.equal(publicUrlFor(WEB, "/login"), `${WEB}/login`);
  assert.equal(publicUrlFor(WEB, "/register"), `${WEB}/register`);
});

test("publicUrlFor: query strings and fragments are kept as given", () => {
  assert.equal(
    publicUrlFor(WEB, "/reset-password?next=%2Fdashboard&x=1"),
    `${WEB}/reset-password?next=%2Fdashboard&x=1`,
  );
  assert.equal(publicUrlFor(WEB, "/preinscription/abc#top"), `${WEB}/preinscription/abc#top`);
});

test("publicUrlFor: a path that is not absolute is refused", () => {
  assert.throws(() => publicUrlFor(WEB, "reset-password"));
  assert.throws(() => publicUrlFor(WEB, "https://evil.example/x"));
  assert.throws(() => publicUrlFor(WEB, "//evil.example/x")); // protocol-relative: another host
});

test("no screen builds an outgoing link from window.location.origin any more", () => {
  // Inside the desktop app that origin is http://tauri.localhost. Links go through
  // publicUrl() / publicOrigin() (lib/desktop.ts).
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) {
        if (readFileSync(p, "utf8").includes("location.origin")) offenders.push(p);
      }
    }
  };
  walk(path.join(import.meta.dirname, ".."));
  assert.deepEqual(
    offenders.map((p) =>
      path.relative(path.join(import.meta.dirname, ".."), p).replace(/\\/g, "/"),
    ),
    ["lib/desktop.ts"],
  );
});
