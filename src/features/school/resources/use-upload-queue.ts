/**
 * Uploading several files at once, each with its own progress, cancel and retry.
 *
 * NOT a global upload system. The queue is owned by whichever page created it, which
 * is what lets closing the dialog abort every transfer still running -- a tray that
 * outlives the dialog would need state that outlives it too, and then "closing the
 * dialog" and "stopping the upload" become two different things a teacher has to
 * reason about. One owner, one lifetime.
 *
 * WHY A REF AND A STATE MIRROR
 *
 * The queue is mutated from inside async callbacks that were created several renders
 * ago. Reading it from state there would read a stale snapshot -- the same fault the
 * drag-and-drop `targetRef` documents, and the reason the Phase 5 cancel had to hold
 * its AbortController in a ref. So the ref is the truth and the state is a copy for
 * rendering, published after every mutation.
 *
 * CONCURRENCY
 *
 * Three at a time. Not one, because a teacher uploading five exercise sheets on a slow
 * line waits five times as long for no reason; not unbounded, because a browser opens
 * six connections per host and saturating them starves the rest of the page -- the
 * progress requests included.
 */

import { useCallback, useRef, useState } from "react";
import { UploadCancelledError, uploadResourceFile } from "./queries";

export type UploadStatus = "pending" | "uploading" | "done" | "failed" | "cancelled";

export interface UploadItem {
  /** Stable across retries, so React keys and per-row controls do not jump. */
  id: string;
  file: File;
  status: UploadStatus;
  /** 0..1, only meaningful while `uploading` or once `done`. */
  progress: number;
  /** Set on `failed`; shown on the row rather than as a toast. */
  error: string | null;
  /** Set on `done`: what the caller needs to create the row. */
  result: { path: string; mimeType: string; size: number } | null;
}

/** How many transfers run at once. */
const CONCURRENCY = 3;

interface Entry extends UploadItem {
  controller: AbortController | null;
}

export interface UploadQueue {
  items: UploadItem[];
  /**
   * True while bytes are actually moving.
   *
   * Deliberately NOT "anything is queued": files sit as `pending` from the moment they
   * are chosen, waiting for the teacher to press Save. Counting those as busy disabled
   * the Save button before the upload could start, so nothing could ever begin.
   */
  busy: boolean;
  /** Replaces the queue. Called when the file input changes or files are dropped. */
  setFiles: (files: File[]) => void;
  add: (files: File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Runs the queue to completion and resolves with the finished items. */
  start: (groupId: string) => Promise<UploadItem[]>;
  cancel: (id: string) => void;
  cancelAll: () => void;
  retry: (id: string, groupId: string) => Promise<void>;
}

export function useUploadQueue(): UploadQueue {
  const ref = useRef<Entry[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);

  /** Publishes the ref to state. Strips the controller: it is not render data. */
  const publish = useCallback(() => {
    setItems(
      ref.current.map(({ controller: _controller, ...rest }) => ({
        ...rest,
      })),
    );
  }, []);

  const newEntry = (file: File): Entry => ({
    id: globalThis.crypto.randomUUID(),
    file,
    status: "pending",
    progress: 0,
    error: null,
    result: null,
    controller: null,
  });

  const setFiles = useCallback(
    (files: File[]) => {
      // Anything in flight is abandoned deliberately: the teacher just chose a
      // different set of files, so finishing the old ones would create rows they did
      // not ask for.
      for (const e of ref.current) e.controller?.abort();
      ref.current = files.map(newEntry);
      publish();
    },
    [publish],
  );

  const add = useCallback(
    (files: File[]) => {
      // Same file twice in one batch is a mis-drop, not an intention.
      const seen = new Set(ref.current.map((e) => `${e.file.name}:${e.file.size}`));
      const fresh = files.filter((f) => !seen.has(`${f.name}:${f.size}`));
      ref.current = [...ref.current, ...fresh.map(newEntry)];
      publish();
    },
    [publish],
  );

  const remove = useCallback(
    (id: string) => {
      const entry = ref.current.find((e) => e.id === id);
      entry?.controller?.abort();
      ref.current = ref.current.filter((e) => e.id !== id);
      publish();
    },
    [publish],
  );

  const clear = useCallback(() => {
    for (const e of ref.current) e.controller?.abort();
    ref.current = [];
    publish();
  }, [publish]);

  const cancel = useCallback(
    (id: string) => {
      const entry = ref.current.find((e) => e.id === id);
      if (!entry) return;
      if (entry.status === "pending") {
        // Never started: mark it directly, there is no request to abort.
        entry.status = "cancelled";
        publish();
        return;
      }
      entry.controller?.abort();
    },
    [publish],
  );

  const cancelAll = useCallback(() => {
    for (const e of ref.current) {
      if (e.status === "pending") e.status = "cancelled";
      else e.controller?.abort();
    }
    publish();
  }, [publish]);

  /** Uploads one entry. Never throws: the outcome lives on the entry. */
  const run = useCallback(
    async (entry: Entry, groupId: string, totalBytes: number, largestBytes: number) => {
      if (entry.status === "cancelled") return;
      const controller = new AbortController();
      entry.controller = controller;
      entry.status = "uploading";
      entry.progress = 0;
      entry.error = null;
      publish();

      try {
        const result = await uploadResourceFile(
          groupId,
          entry.file,
          (fraction) => {
            entry.progress = fraction;
            publish();
          },
          controller.signal,
          { totalBytes, largestBytes },
        );
        entry.status = "done";
        entry.progress = 1;
        entry.result = result;
      } catch (e) {
        // A cancel is not a failure, and must not offer a retry.
        entry.status = e instanceof UploadCancelledError ? "cancelled" : "failed";
        entry.error = e instanceof Error ? e.message : String(e);
      } finally {
        entry.controller = null;
        publish();
      }
    },
    [publish],
  );

  /** Drains whatever is pending, `CONCURRENCY` at a time. */
  const drain = useCallback(
    async (groupId: string) => {
      // The quota is asked about the whole batch ONCE, and the per-file rule about the
      // largest member. Asking per file would let ten files each pass against the
      // current usage and collectively blow past the limit.
      const queued = ref.current.filter((e) => e.status === "pending");
      const totalBytes = queued.reduce((n, e) => n + e.file.size, 0);
      const largestBytes = queued.reduce((n, e) => Math.max(n, e.file.size), 0);

      const lanes = Array.from({ length: Math.min(CONCURRENCY, queued.length) }, async () => {
        for (;;) {
          const next = ref.current.find((e) => e.status === "pending");
          if (!next) return;
          // One failure must not stop the others, so `run` swallows and records.
          await run(next, groupId, totalBytes, largestBytes);
        }
      });
      await Promise.all(lanes);
    },
    [run],
  );

  const start = useCallback(
    async (groupId: string) => {
      await drain(groupId);
      return ref.current.map(({ controller: _controller, ...rest }) => ({ ...rest }));
    },
    [drain],
  );

  const retry = useCallback(
    async (id: string, groupId: string) => {
      const entry = ref.current.find((e) => e.id === id);
      if (!entry || entry.status === "uploading") return;
      entry.status = "pending";
      entry.progress = 0;
      entry.error = null;
      entry.result = null;
      publish();
      await drain(groupId);
    },
    [drain, publish],
  );

  return {
    items,
    busy: items.some((i) => i.status === "uploading"),
    setFiles,
    add,
    remove,
    clear,
    start,
    cancel,
    cancelAll,
    retry,
  };
}
