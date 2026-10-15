/**
 * Where links that leave the app point: e-mail redirects (password reset, account setup, sign-up
 * confirmation) and links people copy or scan (registration, pre-registration).
 *
 * In the browser that is the page's own origin, as before. In the desktop app the page origin is
 * `http://tauri.localhost`, which exists only inside the app: a link built from it would not open
 * anywhere else, and Supabase would not allow it as a redirect. The desktop app uses the web
 * deployment it already talks to for server functions (`VITE_SERVER_ORIGIN`) instead.
 *
 * PURE (no `import.meta.env`, no `window`) so it can be tested directly; `publicOrigin()` and
 * `publicUrl()` in `lib/desktop.ts` feed it the real values.
 */

export interface PublicOriginInput {
  isDesktop: boolean;
  /** The web deployment the desktop app is built against. */
  serverOrigin: string;
  /** The page's own origin (in the desktop app: http://tauri.localhost). */
  pageOrigin: string;
}

/** The origin (scheme, host, port; no path, no trailing slash) links should use. */
export function publicOriginFor({
  isDesktop,
  serverOrigin,
  pageOrigin,
}: PublicOriginInput): string {
  const raw = isDesktop ? serverOrigin : pageOrigin;
  if (!raw) {
    throw new Error(
      isDesktop
        ? "This desktop build has no web address (VITE_SERVER_ORIGIN): links cannot be created."
        : "No page origin: links cannot be created.",
    );
  }
  return new URL(raw).origin;
}

/**
 * `path` (starting with `/`, optionally with `?query` / `#hash`) on `origin`. Built with the URL
 * parser, so a trailing slash on the origin never doubles and the query string is kept as given.
 */
export function publicUrlFor(origin: string, path: string): string {
  // "/x" only: "x" is relative to nothing, and "//host/x" would be read as another host.
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`publicUrlFor: path must start with a single "/" (${path})`);
  }
  return new URL(path, new URL(origin).origin).href;
}
