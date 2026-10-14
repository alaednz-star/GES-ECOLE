/**
 * Desktop app (ADR-010): the connection state comes from real requests.
 *
 * `navigator.onLine` only says a network adapter is up. On Wi-Fi without internet, behind a
 * captive portal, or when the database is unreachable, it still says "online", and the app would
 * keep retrying instead of serving its offline cache. So every Supabase request reports its
 * outcome here: a network failure switches the app offline at once, a response switches it back.
 * While offline, `startProbe` checks every 10 s whether the database answers again.
 *
 * Tiny on purpose: the Supabase client imports it, so it must not pull the offline machinery in.
 */

import { onlineManager } from "@tanstack/react-query";
import { IS_DESKTOP } from "@/lib/desktop";

export function reportNetworkResult(reachable: boolean): void {
  if (!IS_DESKTOP) return;
  if (reachable !== onlineManager.isOnline()) onlineManager.setOnline(reachable);
}

/** A network failure (fetch rejects with a TypeError), as opposed to an HTTP error response. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/** While offline, asks the database's health endpoint every 10 s; stops once it answers. */
export function startProbe(url: string, key: string): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = async () => {
    try {
      const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: "no-store" });
      if (r.ok || r.status < 500) reportNetworkResult(true);
    } catch {
      // Still unreachable.
    }
  };
  const sync = (online: boolean) => {
    if (!online && !timer) timer = setInterval(() => void tick(), 10_000);
    if (online && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  sync(onlineManager.isOnline());
  const unsubscribe = onlineManager.subscribe(sync);
  return () => {
    unsubscribe();
    if (timer) clearInterval(timer);
  };
}
