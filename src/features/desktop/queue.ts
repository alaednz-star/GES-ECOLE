/**
 * Desktop offline queue (ADR-010): the one check screens need, kept apart from `offline.ts` so the
 * web bundle never pulls the persistence code in through a screen that imports it.
 */

import { onlineManager } from "@tanstack/react-query";
import { IS_DESKTOP } from "@/lib/desktop";

/** True when a write submitted now will wait for the connection instead of running. */
export function isQueuedOffline(): boolean {
  return IS_DESKTOP && !onlineManager.isOnline();
}
