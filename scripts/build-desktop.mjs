/**
 * Builds the desktop app's UI (ADR-010) into `dist-desktop/`, the folder Tauri packages.
 *
 *   node scripts/build-desktop.mjs            release: the values in `.env`
 *   node scripts/build-desktop.mjs --local    the local stack (`.env.local`, localhost:8080)
 *
 * The app talks to Supabase with the PUBLIC (publishable) key only. The secret key never enters
 * this build: the few operations that need it run on the online server (DESKTOP_SERVER_ORIGIN).
 * Nothing about a particular deployment is written in this repository: the Supabase project
 * and the server come from `.env` (release) or `.env.local` (local), or from the environment.
 *
 * It also writes `src-tauri/tauri.build.conf.json` (not committed): the window's Content
 * Security Policy, allowing exactly this build's Supabase project and server. `tauri build`
 * merges it with `--config` (see `npm run desktop:build`); without it the base policy in
 * tauri.conf.json allows no backend at all, so a build can never talk to the wrong one.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { scanFolder } from "./secret-scan.mjs";

const local = process.argv.includes("--local");

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

const source = readEnv(local ? ".env.local" : ".env");
const supabaseUrl = source["VITE_SUPABASE_URL"];
const publishableKey = source["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? source["VITE_SUPABASE_ANON_KEY"];
const serverOrigin =
  process.env["SERVER_ORIGIN"] ??
  source["DESKTOP_SERVER_ORIGIN"] ??
  (local ? "http://localhost:8080" : undefined);

if (!supabaseUrl || !publishableKey) {
  console.error(
    `Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in ${local ? ".env.local" : ".env"}.`,
  );
  process.exit(1);
}
if (!serverOrigin) {
  console.error(
    "Missing DESKTOP_SERVER_ORIGIN in .env: the web deployment's address (https://…), which runs the server functions.",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  DESKTOP: "1",
  VITE_DESKTOP: "true",
  VITE_SERVER_ORIGIN: serverOrigin,
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  // The build's own CSP check reads these; the desktop CSP itself lives in tauri.conf.json.
  SUPABASE_URL: supabaseUrl,
};
// Make sure no secret can reach the client bundle through the environment. The keys are kept
// aside only to check, after the build, that none of them ended up in it.
const knownSecrets = [
  process.env["SUPABASE_SERVICE_ROLE_KEY"],
  readEnv(".env")["SUPABASE_SERVICE_ROLE_KEY"],
  readEnv(".env.local")["SUPABASE_SERVICE_ROLE_KEY"],
].filter(Boolean);
delete env["SUPABASE_SERVICE_ROLE_KEY"];

console.log(`Desktop build -> ${supabaseUrl} (server functions: ${serverOrigin})`);
rmSync("dist", { recursive: true, force: true });
const r = spawnSync("npx", ["vite", "build"], { stdio: "inherit", env, shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);

rmSync("dist-desktop", { recursive: true, force: true });
cpSync("dist/client", "dist-desktop", { recursive: true });
// TanStack's SPA shell is the app's single entry: Tauri serves it as index.html, and every
// deep link falls back to it.
renameSync("dist-desktop/_shell.html", "dist-desktop/index.html");

// The window's Content Security Policy, for exactly this build's backend.
const api = new URL(supabaseUrl).origin;
const realtime = api.replace(/^http/, "ws");
const server = new URL(serverOrigin).origin;
const csp = {
  "default-src": "'self'",
  "base-uri": "'self'",
  "object-src": "'none'",
  "form-action": "'self'",
  "script-src": "'self' 'unsafe-inline'",
  "style-src": "'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src": "'self' https://fonts.gstatic.com data:",
  "img-src": `'self' data: blob: https://i.ytimg.com ${api}`,
  "media-src": `'self' blob: ${api}`,
  "connect-src": `'self' ipc: http://ipc.localhost ${api} ${realtime} ${server}`,
  "frame-src": `'self' ${api} https://www.youtube-nocookie.com https://player.vimeo.com https://drive.google.com https://docs.google.com https://*.dropbox.com`,
};
writeFileSync(
  "src-tauri/tauri.build.conf.json",
  JSON.stringify({ app: { security: { csp } } }, null, 2) + "\n",
);

// Refuse to package a bundle that contains a secret (scripts/secret-scan.mjs: key material,
// not the word "secret" -- supabase-js itself contains the `sb_secret_` prefix as a string).
const leaks = scanFolder("dist-desktop", knownSecrets);
if (leaks.length) {
  console.error("SECURITY: secret material found in the desktop bundle:");
  for (const l of leaks) console.error(`  ${l.file}: ${l.reason}`);
  rmSync("dist-desktop", { recursive: true, force: true });
  process.exit(1);
}
console.log("dist-desktop ready (no secret material found).");
