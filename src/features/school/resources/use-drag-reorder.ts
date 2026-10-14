/**
 * Drag-to-reorder, on native HTML5 drag events.
 *
 * NO NEW DEPENDENCY. The project had no drag library and no existing drag
 * pattern, so pulling in dnd-kit or react-beautiful-dnd for two lists would be a
 * lot of surface for the benefit. Native events cover pointer drag in every
 * browser the product targets.
 *
 * Native DnD does not fire on touch. That is acceptable here precisely because
 * the accessible Monter/Descendre menu actions stay -- they are the touch and
 * keyboard path, not a leftover. Drag is the enhancement; the menu is the
 * guarantee.
 */

import { useCallback, useRef, useState } from "react";

/** Where a dropped item would land relative to the row under the pointer. */
export type DropEdge = "before" | "after";

export interface DragState {
  /** Id being dragged, or null. */
  activeId: string | null;
  /** Id currently hovered as a drop target. */
  overId: string | null;
  /** Which side of `overId` the insertion line sits on. */
  edge: DropEdge;
  /** Container (chapter) the pointer is over, for cross-container moves. */
  overContainerId: string | null;
}

const IDLE: DragState = { activeId: null, overId: null, edge: "before", overContainerId: null };

/**
 * Reorders `ids` by moving `activeId` next to `overId`.
 *
 * Pure and exported so the reorder maths is testable and identical for chapters
 * and resources. Returns the same array reference when nothing moves, so callers
 * can skip a pointless write.
 */
export function moveWithin(
  ids: string[],
  activeId: string,
  overId: string,
  edge: DropEdge,
): string[] {
  const from = ids.indexOf(activeId);
  if (from < 0) return ids;
  const without = ids.filter((id) => id !== activeId);
  const target = without.indexOf(overId);
  if (target < 0) return ids;
  const at = edge === "before" ? target : target + 1;
  // No-op guard: dropping an item back where it already was.
  if (at === from) return ids;
  const next = [...without];
  next.splice(at, 0, activeId);
  return next.every((id, i) => id === ids[i]) ? ids : next;
}

/** Inserts `activeId` into `ids` relative to `overId` (cross-container drop). */
export function insertRelative(
  ids: string[],
  activeId: string,
  overId: string | null,
  edge: DropEdge,
): string[] {
  const without = ids.filter((id) => id !== activeId);
  if (!overId) return [...without, activeId];
  const target = without.indexOf(overId);
  if (target < 0) return [...without, activeId];
  const next = [...without];
  next.splice(edge === "before" ? target : target + 1, 0, activeId);
  return next;
}

/**
 * Drag bookkeeping for one list surface.
 *
 * `onDrop` receives the drag as intent -- what moved, onto what, which side, in
 * which container -- and the caller decides how to persist it. This hook holds no
 * data, so the same instance serves chapters and resources.
 */
export function useDragReorder(
  onDrop: (drag: {
    activeId: string;
    overId: string | null;
    edge: DropEdge;
    overContainerId: string | null;
  }) => void,
) {
  const [state, setState] = useState<DragState>(IDLE);
  // Read during dragover without re-rendering on every mousemove.
  const activeRef = useRef<string | null>(null);
  /**
   * The drop TARGET, mirrored outside React state.
   *
   * `drop` can fire in the same tick as the last `dragover`, so React has not
   * necessarily re-rendered and a handler closing over `state` still sees the
   * previous value -- `overId` reads as null and the drop silently does nothing.
   * Reproduced: every drag left the order unchanged. State drives the insertion
   * line (rendering); this ref is the source of truth for the drop (behaviour).
   */
  const targetRef = useRef<{
    overId: string | null;
    edge: DropEdge;
    overContainerId: string | null;
  }>({ overId: null, edge: "before", overContainerId: null });

  const handleDragStart = useCallback(
    (id: string) => (e: React.DragEvent) => {
      activeRef.current = id;
      targetRef.current = { overId: null, edge: "before", overContainerId: null };
      setState({ ...IDLE, activeId: id });
      // `move` gives the correct cursor. Some browsers require data to be set at
      // all before a drag will start, hence the id payload.
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", id);
      } catch {
        /* Safari can throw on synthetic events; the ref already has the id. */
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (id: string, containerId: string | null) => (e: React.DragEvent) => {
      if (!activeRef.current) return;
      // Required, or the browser refuses the drop entirely.
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const box = e.currentTarget.getBoundingClientRect();
      // Midpoint decides the side, so the insertion line follows the pointer
      // rather than snapping only when it passes a whole row.
      const edge: DropEdge = e.clientY < box.top + box.height / 2 ? "before" : "after";
      targetRef.current = { overId: id, edge, overContainerId: containerId };
      setState((s) =>
        s.overId === id && s.edge === edge && s.overContainerId === containerId
          ? s
          : { activeId: activeRef.current, overId: id, edge, overContainerId: containerId },
      );
    },
    [],
  );

  /** Dropping on a container's empty area, e.g. a chapter with no resources. */
  const handleContainerDragOver = useCallback(
    (containerId: string) => (e: React.DragEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      targetRef.current = { overId: null, edge: "after", overContainerId: containerId };
      setState((s) =>
        s.overContainerId === containerId && s.overId === null
          ? s
          : {
              activeId: activeRef.current,
              overId: null,
              edge: "after",
              overContainerId: containerId,
            },
      );
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const activeId = activeRef.current;
      // From the ref, never from state -- see the note on `targetRef`.
      const { overId, edge, overContainerId } = targetRef.current;
      activeRef.current = null;
      targetRef.current = { overId: null, edge: "before", overContainerId: null };
      setState(IDLE);
      if (!activeId) return;
      if (overId === activeId) return;
      onDrop({ activeId, overId, edge, overContainerId });
    },
    [onDrop],
  );

  const handleDragEnd = useCallback(() => {
    activeRef.current = null;
    targetRef.current = { overId: null, edge: "before", overContainerId: null };
    setState(IDLE);
  }, []);

  return {
    state,
    handleDragStart,
    handleDragOver,
    handleContainerDragOver,
    handleDrop,
    handleDragEnd,
    /** True when this row should show the lifted appearance. */
    isDragging: (id: string) => state.activeId === id,
    /** Insertion line position for this row, or null. */
    indicator: (id: string): DropEdge | null =>
      state.activeId && state.overId === id && state.activeId !== id ? state.edge : null,
  };
}
