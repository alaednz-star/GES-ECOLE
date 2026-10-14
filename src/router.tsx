import { MutationCache, QueryClient, onlineManager } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isRetriableError } from "./lib/errors";
import { IS_DESKTOP } from "./lib/desktop";
import {
  OFFLINE_CACHE_MAX_AGE,
  mustRefuseOffline,
  offlineRefusal,
} from "./features/desktop/offline-model";

/** Retry transient failures only; a 403 or a validation error will never succeed. */
const MAX_QUERY_RETRIES = 3;

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Desktop app offline (ADR-010): a write that cannot wait for the connection is refused at
    // once instead of hanging. The four classroom writes are exempt -- they queue.
    mutationCache: new MutationCache({
      onMutate: (_variables, mutation) => {
        if (IS_DESKTOP && mustRefuseOffline(onlineManager.isOnline(), mutation.options.mutationKey)) {
          throw offlineRefusal();
        }
      },
    }),
    defaultOptions: {
      queries: {
        // Reference data (levels, subjects) changes rarely; without this every
        // mount and every window focus refetched it.
        staleTime: 60_000,
        // The desktop app keeps its cache (saved to disk) for offline use.
        gcTime: IS_DESKTOP ? OFFLINE_CACHE_MAX_AGE : 5 * 60_000,
        // Desktop: show what is cached right away and fetch when the network allows.
        ...(IS_DESKTOP ? { networkMode: "offlineFirst" as const } : {}),
        retry: (failureCount, error) => failureCount < MAX_QUERY_RETRIES && isRetriableError(error),
        // Exponential backoff, capped so a slow network never stalls the UI.
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        // Writes are not idempotent across the board, so retry only failures
        // that cannot have been applied (connection lost, deadlock).
        retry: (failureCount, error) => failureCount < 1 && isRetriableError(error),
        retryDelay: 1000,
      },
    },
  });

  // Desktop build only: the offline module (and its storage libraries) never reaches the web bundle.
  if (IS_DESKTOP && typeof window !== "undefined") {
    void import("./features/desktop/offline").then((m) => m.setupDesktopOffline(queryClient));
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
