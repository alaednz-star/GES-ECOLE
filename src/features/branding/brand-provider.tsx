/**
 * One place the school's identity enters the application.
 *
 * Everything downstream -- the `Brand` component, the sidebar, the auth layout, and every
 * screen that already uses `--primary` without knowing branding exists -- reads from here
 * or from the custom properties this emits. No page imports a colour, a name or a logo.
 *
 * FAILURE IS NOT AN ERROR STATE. If the query fails or has not resolved,
 * `resolveBrand(null)` returns the product's own identity (Gestion École) and the interface renders normally.
 * There is no loading branch and no error branch on purpose: a school's logo is not worth
 * a spinner in front of the dashboard, and branding must never be able to stand between a
 * user and signing in.
 *
 * SSR AND HYDRATION. The root loader resolves `center_settings` on the server and hands
 * the row down as `initialData`, so the server render and the first client render both see
 * the SCHOOL -- they agree, which is what hydration requires, and they agree on the right
 * answer. The `<style>` below is therefore part of the initial HTML, which is what makes
 * the custom properties correct at first paint rather than one commit later.
 *
 * Before this, both renders saw `undefined` and fell back to `resolveBrand(null)`: the
 * platform's name, the platform's logo and the platform's teal, replaced a round trip
 * later. On a single-tenant deployment that put another organisation's brand on the
 * school's own front page for the length of that round trip.
 *
 * If the server cannot answer, `initialData` is absent and the old client-only path runs
 * unchanged -- the flash returns, nothing breaks.
 */

import { createContext, useEffect, useMemo, type ReactNode } from "react";
import { usePublicSchool } from "@/features/branding/branding-queries";
import { brandStyleSheet, resolveBrand, type Brand, type BrandingRow } from "@/lib/brand";

export interface BrandContextValue {
  brand: Brand;
  /** True once a real answer has arrived, so a consumer can avoid swapping a logo in late. */
  isResolved: boolean;
}

export const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider({
  children,
  initialData,
}: {
  children: ReactNode;
  /** Resolved on the server by the root loader, so the first paint is already branded. */
  initialData?: BrandingRow | null;
}) {
  // The PUBLIC projection, with or without a session. The landing page, the login screen
  // and the dashboard are then branded by one query rather than by two code paths that
  // would drift -- and a parent who has never signed in sees the school, not the platform.
  const { data, isSuccess } = usePublicSchool(initialData);

  const value = useMemo<BrandContextValue>(
    () => ({ brand: resolveBrand(data), isResolved: isSuccess }),
    [data, isSuccess],
  );

  const css = brandStyleSheet(value.brand);

  /*
    The tab icon.

    `__root.tsx` declares `/favicon.ico` in its `links`, which is static per route and
    resolved at render time by TanStack Start -- there is no route-level hook that can
    depend on a query. So the element is repointed once, here, and only when the school
    actually has one. `isBrandAssetUrl` has already refused anything that is not a plain
    https URL, and the effect is a no-op on the server.
  */
  const favicon = value.brand.faviconUrl;
  useEffect(() => {
    if (!favicon || typeof document === "undefined") return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const previous = link.href;
    link.href = favicon;
    // Restored on unmount so a hot reload or a provider remount cannot strand the tab on
    // a school icon after the branding is cleared.
    return () => {
      link.href = previous;
    };
  }, [favicon]);

  return (
    <BrandContext.Provider value={value}>
      {/*
        The override rides one <style> element rather than inline styles on <html>, so it
        cascades to portals -- Radix dialogs, sheets and the toaster render outside the
        React tree's DOM parent and would otherwise keep the platform palette.

        `brandStyleSheet` builds this string from validated `#RRGGBB` values only, and
        strips anything containing a brace, a semicolon or an angle bracket. The database
        refuses those shapes on write as well; this is the second gate, not the first.
      */}
      {css ? <style data-brand-tokens="" dangerouslySetInnerHTML={{ __html: css }} /> : null}
      {children}
    </BrandContext.Provider>
  );
}
