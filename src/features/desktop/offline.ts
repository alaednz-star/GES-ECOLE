/**
 * Desktop offline mode, runtime (ADR-010). Desktop build only; the web app never calls this.
 *
 * - The query cache is saved to IndexedDB, so what the user saw stays readable without internet
 *   (30 days, dropped when the app version changes, cleared on sign-out).
 * - The four classroom writes (`OFFLINE_MUTATIONS`) wait for the connection. Their request
 *   functions are registered as mutation defaults, so a write queued before the app was closed is
 *   still sent after it reopens.
 * - Every other write is refused at once while offline (`mustRefuseOffline`), see router.tsx.
 */

import { hydrate, onlineManager, type QueryClient } from "@tanstack/react-query";
import { persistQueryClientSubscribe } from "@tanstack/query-persist-client-core";
import type { PersistedClient, Persister } from "@tanstack/query-persist-client-core";
import { del, get, set } from "idb-keyval";
import { IS_DESKTOP } from "@/lib/desktop";
import { supabaseRestConfig } from "@/integrations/supabase/client";
import { startProbe } from "./connectivity";
import { saveAttendanceEntries } from "@/features/school/queries";
import { saveLessonEntryRequest, saveScoresRequest } from "@/features/pedagogy/queries";
import { sendMessageRequest } from "@/features/communication/queries";
import type { SaveSessionInput } from "@/features/school/session/use-session-attendance";
import { OFFLINE_CACHE_MAX_AGE, OFFLINE_MUTATIONS } from "./offline-model";

const CACHE_KEY = "gestion-ecole.query-cache";
/** Bump with releases whose cached data shapes change; the persisted cache is then discarded. */
const CACHE_BUSTER = "desktop-1";

const persister: Persister = {
  persistClient: (client: PersistedClient) => set(CACHE_KEY, client),
  restoreClient: () => get<PersistedClient>(CACHE_KEY),
  removeClient: () => del(CACHE_KEY),
};

/** Drops the saved cache (sign-out: the next person on this computer must not see it). */
export function clearOfflineCache(queryClient: QueryClient): Promise<void> {
  console.info('[trace] clearOfflineCache', new Error().stack);
  queryClient.clear();
  return del(CACHE_KEY);
}

export function setupDesktopOffline(queryClient: QueryClient): void {
  if (!IS_DESKTOP || typeof window === "undefined") return;

  queryClient.setMutationDefaults(OFFLINE_MUTATIONS.attendance, { mutationFn: saveAttendanceEntries });
  queryClient.setMutationDefaults(OFFLINE_MUTATIONS.sessionAttendance, {
    mutationFn: (input: SaveSessionInput) =>
      saveAttendanceEntries({
        groupId: input.groupId,
        date: input.date,
        markedBy: input.markedBy,
        entries: input.entries,
      }),
  });
  queryClient.setMutationDefaults(OFFLINE_MUTATIONS.lessonEntry, { mutationFn: saveLessonEntryRequest });
  queryClient.setMutationDefaults(OFFLINE_MUTATIONS.scores, { mutationFn: saveScoresRequest });
  queryClient.setMutationDefaults(OFFLINE_MUTATIONS.message, { mutationFn: sendMessageRequest });

  const options = {
    queryClient,
    persister,
    maxAge: OFFLINE_CACHE_MAX_AGE,
    buster: CACHE_BUSTER,
    // Keep every query that HAS data, not only the last successful ones: offline, a refresh fails
    // and the query turns "error" while still holding its data -- the default would then drop it
    // from the saved cache, erasing exactly what offline use depends on.
    dehydrateOptions: { shouldDehydrateQuery: (query: { state: { data: unknown } }) => query.state.data !== undefined },
  };
  // Restore FIRST, then start saving: saving before the restore would overwrite the saved cache
  // with the empty state of a fresh start.
  const restored = restoreCache(queryClient).finally(() => {
    persistQueryClientSubscribe(options);
  });

  // Writes queued in an earlier session are sent once the cache is back and we are online; then
  // everything is refetched so screens show the server's truth.
  void restored.then(() => {
    if (onlineManager.isOnline()) void resumeAndRefresh(queryClient);
  });
  onlineManager.subscribe((online) => {
    if (online) void resumeAndRefresh(queryClient);
  });
  // Detects the connection coming back even when the system never said it was gone.
  const { url, key } = supabaseRestConfig();
  startProbe(url, key);
}

async function restoreCache(queryClient: QueryClient): Promise<void> {
  let saved: PersistedClient | undefined;
  try {
    saved = await persister.restoreClient();
  } catch (error) {
    console.error("[offline] could not read the saved cache", error);
    return;
  }
  console.info('[trace] saved?', !!saved, saved && saved.clientState.queries.length, saved && saved.buster, saved && (Date.now()-saved.timestamp));
  if (!saved) return;
  const expired = !saved.timestamp || Date.now() - saved.timestamp > OFFLINE_CACHE_MAX_AGE;
  if (expired || saved.buster !== CACHE_BUSTER) {
    await persister.removeClient();
    return;
  }
  try {
    hydrate(queryClient, saved.clientState);
    console.info('[trace] hydrated, cache now', queryClient.getQueryCache().getAll().length);
  } catch (error) {
    console.error("[offline] could not restore the saved cache", error);
  }
}

async function resumeAndRefresh(queryClient: QueryClient): Promise<void> {
  await queryClient.resumePausedMutations();
  await queryClient.invalidateQueries();
}
