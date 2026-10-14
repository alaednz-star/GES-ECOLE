/**
 * The Windows desktop app (ADR-010): constants shared by the web server, which must accept the
 * app's server-function calls, and the app itself.
 *
 * Tauri serves the app's files from this origin on Windows (WebView2, http scheme). Browsers set
 * the Origin header themselves and never let a page forge it, so a website cannot pretend to be
 * the desktop app.
 */
export const DESKTOP_ORIGIN = "http://tauri.localhost";

/** TanStack Start's server-function endpoint prefix (the default `serverFnBase`). */
export const SERVER_FN_PREFIX = "/_serverFn/";

/** True in the desktop build (set by `scripts/build-desktop.mjs`). */
export const IS_DESKTOP = import.meta.env.VITE_DESKTOP === "true";

/** The online server the desktop app sends server-function calls to. */
export const SERVER_ORIGIN: string = import.meta.env.VITE_SERVER_ORIGIN ?? "";
