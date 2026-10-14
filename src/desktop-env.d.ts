/**
 * Build-time variables of the desktop app (ADR-010), set by `scripts/build-desktop.mjs`.
 * Declared so they can be read with dot access, which Vite replaces with a constant at build time:
 * the web build then drops every desktop-only branch (and the modules they import).
 */
interface ImportMetaEnv {
  readonly VITE_DESKTOP?: string;
  readonly VITE_SERVER_ORIGIN?: string;
}
