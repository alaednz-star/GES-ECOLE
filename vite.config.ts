// The shared Vite config below already includes the following — do NOT add them
// manually or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import { i18nLocaleSplit } from "./vite.i18n-split";

/*
  SECURITY HEADERS, and why they are declared HERE rather than in `vercel.json`.

  Nitro's `vercel` preset emits a Build Output API v3 deployment: the generated
  `.vercel/output/config.json` carries the `routes` array Vercel actually serves from. Headers
  written into `vercel.json` are not part of that artefact, so whether they survive is a
  property of Vercel's merge behaviour rather than something this repository controls -- and it
  could only be confirmed by deploying. `nitro.routeRules` compiles into the same
  `config.json`, which means the result is verifiable by building and reading the file. That is
  the only reason this lives in the build config.

  HSTS is deliberately absent: Vercel already sends
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, and duplicating a
  header is how contradictory values happen.
*/

/**
 * The Supabase origin, read from the environment rather than written down.
 *
 * The browser talks to this host for auth, PostgREST, storage objects and the school's logo, so
 * it has to appear in `connect-src`, `img-src`, `media-src` and `frame-src`. Hardcoding it would
 * make the CSP wrong the moment this repository is deployed for a different school -- the same
 * reason no colour or logo is hardcoded anywhere else here.
 *
 * `loadEnv` is used, not just `process.env`. A Vite config module is evaluated BEFORE Vite loads
 * any `.env` file, so `process.env.SUPABASE_URL` is undefined locally even though `.env`
 * defines it -- on Vercel it happens to be set, because there the value is a real environment
 * variable. The first version of this file read only `process.env` and silently emitted
 * `connect-src 'self'`, which would have blocked every Supabase request in production. Reading
 * both makes the local build and the Vercel build produce the same policy.
 *
 * AND IT THROWS. There is no safe fallback: a CSP without this origin does not degrade, it
 * breaks authentication, every query and the school's logo at once. Failing the build is the
 * only honest outcome -- a deployment that never happens beats one that serves a bricked app.
 */
function supabaseOrigin(): string {
  const fileEnv = loadEnv(process.env["NODE_ENV"] ?? "production", process.cwd(), "");
  const raw =
    process.env["SUPABASE_URL"] ||
    fileEnv["SUPABASE_URL"] ||
    process.env["VITE_SUPABASE_URL"] ||
    fileEnv["VITE_SUPABASE_URL"] ||
    "";
  let origin: string | null = null;
  try {
    const url = new URL(raw);
    /*
      https everywhere, except a local stack -- which is always plain http on a loopback
      host and can never be anything else.

      The first version of this accepted https only, and it did not merely emit a narrower
      policy: it THREW, so `vite dev` refused to start at all once `.env.local` pointed at
      `http://127.0.0.1:55321`. Local development was impossible. The exception is scoped to
      loopback by hostname, so a remote http URL is still refused -- that one really would
      be mixed content in production.
    */
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "https:" || (loopback && url.protocol === "http:")) origin = url.origin;
  } catch {
    origin = null;
  }
  if (!origin) {
    throw new Error(
      "Cannot build the Content-Security-Policy: no https SUPABASE_URL (or VITE_SUPABASE_URL) " +
        "was found in the environment or in a .env file. Set it before building -- shipping " +
        "without it would emit a policy that blocks every Supabase request.",
    );
  }
  return origin;
}

const SUPABASE = supabaseOrigin();
const SUPABASE_HTTPS = ` ${SUPABASE}`;
const SUPABASE_WSS = ` ${SUPABASE.replace("https://", "wss://")}`;

/*
  The origins `resource-preview.tsx` frames, taken from the allow-list in `link-provider.ts`
  rather than from a template. Every embed URL that file builds normalises to one of these:
  YouTube always becomes `youtube-nocookie.com`, Vimeo becomes `player.vimeo.com`, Google Docs
  and Drive become `/preview` URLs on their own hosts, and Dropbox keeps its original host with
  `raw=1`. OneDrive is intentionally absent -- `linkFaceOf` returns a null `embedUrl` for it and
  offers "open externally" instead, so framing it is not a thing the product does.
*/
const EMBED_FRAME_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://drive.google.com",
  "https://docs.google.com",
  "https://*.dropbox.com",
].join(" ");

/*
  Video embeds delegate these features through the iframe's `allow` attribute, and a
  `Permissions-Policy` that omits them overrides that delegation -- a lesson video would lose
  fullscreen. The two players are named explicitly; everything a school website has no business
  asking for (camera, microphone, geolocation, payment, usb) is denied outright.
*/
const PLAYERS = `"https://www.youtube-nocookie.com" "https://player.vimeo.com"`;

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  // No part of this product is meant to be embedded anywhere, and `X-Frame-Options` below says
  // the same thing to anything that predates CSP.
  "frame-ancestors 'none'",
  /*
    'unsafe-inline' on scripts is a real concession, made on evidence: the SSR document contains
    two inline scripts that TanStack Start emits itself -- the scroll-restoration reader and the
    `$_TSR` hydration/stream barrier. Neither carries a nonce, because nothing in this app
    threads one from the server render into the document. Hashes were rejected as brittle:
    framework-generated inline content changes with the framework version, and a stale hash
    breaks hydration silently on the next upgrade. `'unsafe-eval'` is NOT included -- the
    production bundle does not need it.
  */
  "script-src 'self' 'unsafe-inline'",
  /*
    'unsafe-inline' on styles is unavoidable today. `brand-provider.tsx` writes the school's
    palette into an inline <style data-brand-tokens> -- that element is what makes the branding
    correct at first paint -- and the rendered page also carries 19 elements with `style`
    attributes, which React writes and which no nonce can cover. Removing this would mean
    reworking the branding fix that was just verified in production.
  */
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  "font-src 'self' https://fonts.gstatic.com data:",
  /*
    `blob:` is the avatar picker's local preview (`URL.createObjectURL`); the Supabase origin
    serves the school logo and stored avatars.

    `i.ytimg.com` is YouTube's image host, and it is here because Resources needs it:
    `link-provider.ts` derives a still for a YouTube link from its video id, and
    `resource-thumb.tsx` renders it in place of the type icon. It is the image host only --
    no script, no frame, no connection is granted to it. Named exactly, never a wildcard.
  */
  `img-src 'self' data: blob: https://i.ytimg.com${SUPABASE_HTTPS}`,
  `media-src 'self' blob:${SUPABASE_HTTPS}`,
  // Auth, PostgREST and storage. `wss:` is included because supabase-js ships realtime and can
  // open a socket; no feature uses it today, and a CSP failure there would be silent.
  `connect-src 'self'${SUPABASE_HTTPS}${SUPABASE_WSS}`,
  // Lesson embeds, plus stored PDFs which `resource-preview.tsx` frames from a signed URL.
  `frame-src 'self'${SUPABASE_HTTPS} ${EMBED_FRAME_ORIGINS}`,
].join("; ");

const SECURITY_HEADERS = {
  "content-security-policy": CSP,
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "payment=()",
    "usb=()",
    "autoplay=(self)",
    "accelerometer=(self)",
    "gyroscope=(self)",
    "clipboard-write=(self)",
    `fullscreen=(self ${PLAYERS})`,
    `picture-in-picture=(self ${PLAYERS})`,
    `encrypted-media=(self ${PLAYERS})`,
  ].join(", "),
};

/*
  Nitro options, assembled separately because of a types-versus-behaviour gap in the shared
  config package.

  `@lovable.dev/vite-tanstack-config@2.8.5` declares its `nitro` option as
  `{ preset?, output?, cloudflare? }` -- it does not mention `routeRules`. It nevertheless
  forwards the object to Nitro: building with this in place puts a route carrying
  `content-security-policy` into `.vercel/output/config.json`, which is the artefact Vercel
  serves from. So the behaviour is real and verifiable; only the declaration is incomplete.

  The cast is deliberately the narrowest thing that compiles, and is confined to this one
  option so nothing else in the config loses its types. It is a lie to the type checker about
  one property, recorded here rather than hidden.
*/
const nitro = {
  // NITRO_PRESET=node-server builds a locally runnable server (.output/) to test the
  // production bundle; deployments keep the Vercel preset.
  preset: process.env["NITRO_PRESET"] || "vercel",
  routeRules: {
    // Every response, documents and assets alike. The asset rule Nitro already emits sets
    // cache-control on `/assets/*`; these are additive rather than a replacement.
    "/**": { headers: SECURITY_HEADERS },
  },
} as unknown as { preset: string };

/*
  DESKTOP=1 builds the Windows desktop app's UI (ADR-010): client-only (SPA) mode, a static shell
  Tauri packages from `src-tauri/`. The web/Vercel build is unaffected when the variable is unset.
*/
const DESKTOP = process.env["DESKTOP"] === "1";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    ...(DESKTOP ? { spa: { enabled: true } } : {}),
  },
  // Deploy target. Nitro defaults to `cloudflare-module`, which emits a Workers
  // bundle (wrangler.json) that Vercel cannot serve -- SSR and deep-route
  // refresh would fail. We deploy to Vercel, so pin the preset. The desktop build has no server
  // to deploy: TanStack's own output (dist/client) is what Tauri packages.
  nitro: DESKTOP ? false : nitro,
  // Per-locale translation chunks in the browser bundle (see vite.i18n-split.ts).
  vite: {
    plugins: [i18nLocaleSplit()],
    // A constant in every build, so the web build drops the desktop-only code paths entirely.
    define: { "import.meta.env.VITE_DESKTOP": JSON.stringify(DESKTOP ? "true" : "false") },
  },
});
