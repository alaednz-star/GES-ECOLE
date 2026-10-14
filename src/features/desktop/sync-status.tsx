/**
 * Desktop app (ADR-010): online / offline state, changes waiting to be sent, and the
 * « Synchronisation » panel, where a change the server refused on replay can be retried or
 * discarded. Nothing queued is ever dropped silently.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw, RotateCcw, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/hooks/use-i18n";
import { formatDateTime } from "@/lib/format";
import { toMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { offlineKind, summarize, type MutationSnapshot } from "./offline-model";

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** The offline-capable mutations, re-read whenever the mutation cache changes. */
type CachedMutation = ReturnType<ReturnType<ReturnType<typeof useQueryClient>["getMutationCache"]>["getAll"]>[number];

function useQueuedMutations(): CachedMutation[] {
  const qc = useQueryClient();
  const cache = qc.getMutationCache();
  const [, force] = useState(0);
  useSyncExternalStore(
    (cb) =>
      cache.subscribe(() => {
        force((n) => n + 1);
        cb();
      }),
    () => cache.getAll().length,
    () => 0,
  );
  return cache.getAll().filter((m) => offlineKind(m.options.mutationKey) !== null);
}

export function DesktopSyncStatus() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const online = useOnline();
  const mutations = useQueuedMutations();
  const [open, setOpen] = useState(false);

  const summary = useMemo(
    () =>
      summarize(
        mutations.map<MutationSnapshot>((m) => ({
          key: m.options.mutationKey,
          status: m.state.status,
          isPaused: m.state.isPaused,
          submittedAt: m.state.submittedAt,
        })),
      ),
    [mutations],
  );
  const pending = mutations.filter((m) => m.state.status === "pending");
  const failed = mutations.filter((m) => m.state.status === "error");

  const retry = (m: CachedMutation) => {
    const key = m.options.mutationKey;
    if (!key) return;
    const again = qc.getMutationCache().build(qc, { mutationKey: key });
    qc.getMutationCache().remove(m);
    void again.execute(m.state.variables).catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium",
          !online
            ? "bg-accent-soft text-accent"
            : summary.failed > 0
              ? "bg-destructive/10 text-destructive"
              : summary.pending > 0
                ? "bg-primary-soft text-primary"
                : "text-muted-foreground hover:bg-muted",
        )}
        data-testid="desktop-sync-status"
        data-online={online ? "true" : "false"}
        aria-label={t("desktop.sync.open")}
      >
        {online ? <Wifi className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
        <span className="hidden sm:inline">
          {!online
            ? t("desktop.offline")
            : summary.pending > 0
              ? t("desktop.syncing", { count: summary.pending })
              : summary.failed > 0
                ? t("desktop.failedCount", { count: summary.failed })
                : t("desktop.online")}
        </span>
        {online && summary.pending > 0 && <RefreshCw className="size-3.5 animate-spin" aria-hidden />}
        {!online && summary.pending > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-foreground">{summary.pending}</span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("desktop.sync.title")}</SheetTitle>
            <SheetDescription>{t(online ? "desktop.sync.onlineBody" : "desktop.sync.offlineBody")}</SheetDescription>
          </SheetHeader>

          <section className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold">{t("desktop.sync.pending", { count: pending.length })}</h3>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("desktop.sync.nothingPending")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border" data-testid="desktop-sync-pending">
                {pending.map((m) => (
                  <li key={m.mutationId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>{t(`desktop.kind.${offlineKind(m.options.mutationKey)}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(new Date(m.state.submittedAt).toISOString(), locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold">{t("desktop.sync.failed", { count: failed.length })}</h3>
            {failed.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("desktop.sync.nothingFailed")}</p>
            ) : (
              <ul className="space-y-2" data-testid="desktop-sync-failed">
                {failed.map((m) => (
                  <li key={m.mutationId} className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <p className="font-medium">{t(`desktop.kind.${offlineKind(m.options.mutationKey)}`)}</p>
                    <p className="text-xs text-destructive">{toMessage(m.state.error, t)}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-lg" onClick={() => retry(m)} disabled={!online}>
                        <RotateCcw className="size-4" aria-hidden /> {t("desktop.sync.retry")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg text-destructive"
                        onClick={() => qc.getMutationCache().remove(m)}
                      >
                        <Trash2 className="size-4" aria-hidden /> {t("desktop.sync.discard")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </SheetContent>
      </Sheet>
    </>
  );
}
