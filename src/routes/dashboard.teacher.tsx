import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy route.
 *
 * `/dashboard/teacher` and `/dashboard` rendered the same component -- measured
 * byte-for-byte identical output -- so the sidebar offered two entries for one
 * screen. The teacher workspace now lives at `/dashboard`.
 *
 * Redirecting rather than deleting keeps existing bookmarks and any links in
 * already-sent notifications working.
 */
export const Route = createFileRoute("/dashboard/teacher")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
