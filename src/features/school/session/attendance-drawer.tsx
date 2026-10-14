/**
 * Attendance drawer -- marks one session's register.
 *
 * Opens from a calendar card. Loads the roster only when open, so the calendar
 * itself never pays for student rows.
 *
 * UNSAVED-CHANGES GUARD
 *
 * Audit finding P1-2: navigating away silently discarded a marked register. A
 * drawer has MORE exits than the old page did -- the close button, Escape, the
 * scrim, and switching to another session -- so every one of them routes through
 * `attemptClose`. Radix fires `onOpenChange(false)` for Escape and scrim clicks
 * alike, which is the single choke point the guard needs.
 */

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useSubjectLabel } from "../subject-label";
import type { AttendanceStatus } from "../types";
import { useSaveSessionAttendance, useSessionRoster } from "./use-session-attendance";
import { isQueuedOffline } from "@/features/desktop/queue";
import { buildKeyMap, nextRow, targetRow } from "./keyboard";
import { subjectTint } from "./subject-tint";
import type { SessionInstance } from "./types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUSES: AttendanceStatus[] = ["present", "absent", "late", "excused"];

/** Status → the existing semantic tokens. No new colours enter the system. */
const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: "bg-success-soft text-success border-success/30",
  absent: "bg-destructive/10 text-destructive border-destructive/30",
  late: "bg-accent-soft text-accent border-accent/30",
  excused: "bg-muted text-muted-foreground border-border",
};

interface Props {
  session: SessionInstance | null;
  /** The calendar's active window, so the summary cache patch targets it. */
  window: { from: string; to: string };
  onClose: () => void;
  /**
   * Move to the previous/next session without leaving the drawer.
   *
   * A Saturday with four parallel groups meant close -> hunt for the next card ->
   * click, four times over. The registers are a queue; the drawer should let the
   * teacher walk it.
   */
  onNavigate?: ((direction: -1 | 1) => void) | undefined;
  /** Position in the visible queue, e.g. "2 / 4". */
  queue?: { index: number; total: number } | undefined;
}

export function AttendanceDrawer({ session, window: win, onClose, onNavigate, queue }: Props) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const subjectLabel = useSubjectLabel();
  const { notifySuccess, notifyError } = useActionFeedback();

  const rosterQuery = useSessionRoster(session?.groupId ?? null, session?.date ?? null);
  const save = useSaveSessionAttendance();

  /**
   * ONE stable reference when there is no data yet.
   *
   * `const { data: roster = [] }` would build a NEW array on every render while
   * `data` is undefined, so the effect below would see a changed dependency,
   * call setMarks, re-render, and repeat -- the "Maximum update depth exceeded"
   * loop that `dashboard.attendance.tsx` documents. Memoising keeps one identity.
   */
  const roster = useMemo(() => rosterQuery.data ?? EMPTY_ROSTER, [rosterQuery.data]);

  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});

  /**
   * Seed local marks from what is saved.
   *
   * Keyed on the session as well as the roster: switching sessions used to leave
   * the previous group's marks on screen, because a student enrolled in both
   * kept their entry. The teacher then saved marks they never made.
   */
  useEffect(() => {
    const next: Record<string, AttendanceStatus> = {};
    for (const r of roster) if (r.status) next[r.studentId] = r.status;
    setMarks(next);
    setFocusRow(-1);
  }, [roster, session?.key]);

  /** Only staff may write. RLS is the real boundary; this hides a dead control. */
  const canEdit = user?.role === "admin" || user?.role === "teacher";

  /** Entries that differ from storage -- the diff the mutation sends. */
  const changed = useMemo(() => {
    const saved = new Map(roster.map((r) => [r.studentId, r.status]));
    return Object.entries(marks).filter(
      ([id, status]) => saved.has(id) && saved.get(id) !== status,
    );
  }, [marks, roster]);

  const isDirty = changed.length > 0;
  /** Ids Save would write. Drives the per-row unsaved marker. */
  const changedIds = useMemo(() => new Set(changed.map(([id]) => id)), [changed]);
  const markedCount = Object.keys(marks).length;
  const missing = roster.length - markedCount;

  /**
   * Keyboard marking.
   *
   * A teacher marks the same 14 students every session; reaching for the mouse
   * four times per student is the bulk of the work. `P A R E` mark the focused
   * row and advance, arrows move, `Ctrl/Cmd+S` saves. The original spec listed
   * this as optional -- it is cheap, and it is the difference between a register
   * taking thirty seconds and taking three minutes.
   *
   * -1 means "nothing focused": the drawer does not steal focus on open, so the
   * first keypress selects row 0 rather than acting on a row the user never
   * chose.
   */
  const [focusRow, setFocusRow] = useState(-1);

  /**
   * Moving to a sibling session is an EXIT too -- the roster is replaced, so
   * unsaved marks would vanish exactly as they do on close. Same guard.
   */
  const attemptNavigate = useCallback(
    (direction: -1 | 1) => {
      if (!onNavigate) return;
      if (isDirty && !globalThis.confirm(t("entity.session.drawer.discard"))) return;
      onNavigate(direction);
    },
    [isDirty, onNavigate, t],
  );

  /** Every exit funnels through here, so none of them can discard silently. */
  const attemptClose = useCallback(() => {
    if (isDirty && !globalThis.confirm(t("entity.session.drawer.discard"))) return;
    onClose();
  }, [isDirty, onClose, t]);

  const markAll = () => {
    const next: Record<string, AttendanceStatus> = {};
    for (const r of roster) next[r.studentId] = "present";
    setMarks(next);
  };

  const reset = () => setMarks({});

  /**
   * Focus the first student with no status.
   *
   * "6 élèves sans statut" says how many but not WHERE; on a roster of 30 the
   * remaining few are scattered. This answers "who is left?" in one press.
   */
  const jumpToUnmarked = () => {
    const idx = roster.findIndex((r) => !marks[r.studentId]);
    if (idx >= 0) setFocusRow(idx);
  };

  const toggle = (studentId: string, status: AttendanceStatus) => {
    setMarks((prev) => {
      const next = { ...prev };
      // Clicking the active status again clears it, so a mis-click is undoable
      // without reaching for Réinitialiser and losing the whole register.
      if (next[studentId] === status) delete next[studentId];
      else next[studentId] = status;
      return next;
    });
  };

  const submit = () => {
    if (!session || !user) return;
    if (changed.length === 0) {
      notifyError(new Error(t("entity.session.drawer.noChanges")));
      return;
    }
    save.mutate(
      {
        groupId: session.groupId,
        date: session.date,
        markedBy: user.id,
        entries: changed.map(([studentId, status]) => ({ studentId, status })),
        window: win,
        enrolled: session.enrolled,
        finalMarks: marks,
      },
      {
        onSuccess: () => {
          notifySuccess("entity.session.drawer.saved");
          onClose();
        },
        onError: (e) => notifyError(e),
      },
    );
    // Desktop offline: queued (the session card already shows the new counts), sent when the
    // connection returns.
    if (isQueuedOffline()) {
      notifySuccess("desktop.queued");
      onClose();
    }
  };

  /** Latin shortcuts plus the localised codes. Rules live in `keyboard.ts`. */
  const keyToStatus = useMemo(
    () => buildKeyMap((status) => t(`entity.session.code.${status}`)),
    [t],
  );

  /**
   * Drawer-level key handling.
   *
   * Attached to the content element rather than to `window`, so it cannot fire
   * while the drawer is closed or steal keys from another page. Typing inside a
   * field is excluded -- there is no text input here today, but a future note
   * field must not have its "a" swallowed as "absent".
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canEdit || roster.length === 0) return;
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (el?.isContentEditable) return;

    // Save. Both Ctrl and Meta, so Windows and macOS behave the same.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (isDirty && !save.isPending) submit();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusRow((i) => nextRow(i, e.key === "ArrowDown" ? 1 : -1, roster.length));
      return;
    }

    const status = keyToStatus.get(e.key.toLowerCase());
    if (!status) return;
    e.preventDefault();
    const idx = targetRow(focusRow, roster.length);
    const row = roster[idx];
    if (!row) return;
    // Set, never toggle: a keyboard run down the roster should be idempotent, so
    // pressing P twice on the same student must not clear them.
    setMarks((prev) => ({ ...prev, [row.studentId]: status }));
    setFocusRow(nextRow(idx, 1, roster.length));
  };

  const open = session !== null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Radix routes Escape AND scrim clicks through here.
        if (!next) attemptClose();
      }}
    >
      {/* `side="right"` is the LOGICAL intent "where the drawer lives"; SheetContent
          flips it under RTL itself, so Arabic gets a start-edge drawer with no
          extra work here. Its built-in close button dispatches Radix's
          onOpenChange, which lands on `attemptClose` above -- so the X, Escape
          and the scrim all share one guard. */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[30rem]"
        onKeyDown={onKeyDown}
      >
        {session && (
          <>
            {/* STICKY CONTEXT.
                On a roster of 30 the header and the queue position scrolled out
                of view, so halfway down you no longer knew which session you were
                marking. Pinning them keeps that answer on screen while the roster
                scrolls underneath. */}
            <div className="sticky top-0 z-10 bg-card">
              <DrawerHeader session={session} locale={locale} subjectLabel={subjectLabel} />

              {/* Walk the queue of registers without leaving the drawer. */}
              {onNavigate && queue && queue.total > 1 && (
                <div className="flex items-center gap-2 border-b border-border bg-muted/35 px-5 py-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-lg"
                    aria-label={t("entity.session.drawer.previousSession")}
                    disabled={queue.index <= 0}
                    onClick={() => attemptNavigate(-1)}
                  >
                    <ChevronLeft className="size-4 rtl:hidden" aria-hidden />
                    <ChevronRight className="hidden size-4 rtl:block" aria-hidden />
                  </Button>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {t("entity.session.drawer.queuePosition", {
                      index: queue.index + 1,
                      total: queue.total,
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-lg"
                    aria-label={t("entity.session.drawer.nextSession")}
                    disabled={queue.index >= queue.total - 1}
                    onClick={() => attemptNavigate(1)}
                  >
                    <ChevronRight className="size-4 rtl:hidden" aria-hidden />
                    <ChevronLeft className="hidden size-4 rtl:block" aria-hidden />
                  </Button>
                  {/* Completion as a bar, not only a fraction: "18/24" needs
                      arithmetic, a bar is read at a glance mid-lesson. */}
                  {roster.length > 0 && (
                    <div
                      className="ms-auto h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={markedCount}
                      aria-valuemin={0}
                      aria-valuemax={roster.length}
                      aria-label={t("entity.session.drawer.markedCount", {
                        marked: markedCount,
                        enrolled: roster.length,
                      })}
                    >
                      <div
                        className={cn(
                          "h-full transition-all duration-300",
                          missing === 0 ? "bg-success" : "bg-accent",
                        )}
                        style={{ inlineSize: `${(markedCount / roster.length) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {session.enrolled === 0 ? (
              <ZeroEnrollment t={t} />
            ) : (
              <>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={markAll}
                    >
                      {t("entity.session.drawer.allPresent")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-xl"
                      onClick={reset}
                    >
                      {t("entity.session.drawer.reset")}
                    </Button>
                    {missing > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-xl text-accent hover:text-accent"
                        onClick={jumpToUnmarked}
                      >
                        {t("entity.session.drawer.jumpToUnmarked", { count: missing })}
                      </Button>
                    )}
                    <span
                      className={cn(
                        "ms-auto text-xs font-medium tabular-nums",
                        missing === 0 && roster.length > 0
                          ? "text-success"
                          : "text-muted-foreground",
                      )}
                    >
                      {t("entity.session.drawer.markedCount", {
                        marked: markedCount,
                        enrolled: roster.length,
                      })}
                    </span>
                  </div>
                )}

                <div className="border-b border-border px-5 py-2">
                  <p className="text-[11px] text-muted-foreground">
                    {t("entity.session.drawer.legend")}
                  </p>
                  {/* Shown only to those who can act on it, and only where a
                      keyboard exists -- on a phone it would be noise. */}
                  {canEdit && (
                    <p className="mt-0.5 hidden text-[10.5px] text-muted-foreground/75 sm:block">
                      {t("entity.session.drawer.keyboardHint")}
                    </p>
                  )}
                </div>

                {!canEdit && (
                  <p role="status" className="surface-alert mx-5 mt-4 px-4 py-3 text-sm">
                    {t("entity.session.drawer.readOnly")}
                  </p>
                )}

                <div className="flex-1 space-y-2 p-5">
                  {rosterQuery.isLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 rounded-xl" />
                      ))
                    : roster.map((r, i) => (
                        <div
                          key={r.studentId}
                          // The focused row needs a marker the keyboard user can
                          // actually see; `focus-ring` is for real DOM focus, and
                          // focus stays on the drawer, not on each row.
                          className={cn(
                            "flex items-center gap-3 rounded-xl border p-2.5 transition-colors",
                            i === focusRow
                              ? "border-primary/45 bg-primary-soft/45"
                              : !marks[r.studentId]
                                ? // A dashed edge marks "no status yet", so the
                                  // remaining students are findable by eye rather
                                  // than only by the counter.
                                  "border-dashed border-accent/40"
                                : "border-border/70",
                          )}
                          aria-current={i === focusRow ? "true" : undefined}
                        >
                          <PersonAvatar
                            name={r.fullName}
                            url={r.avatarUrl}
                            className="size-9 shrink-0 text-xs"
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="min-w-0 truncate text-sm font-medium">
                              {r.fullName}
                            </span>
                            {/* Which rows Save would write -- "what did I just
                                change?" without re-reading the roster. */}
                            {changedIds.has(r.studentId) && (
                              <span
                                className="size-1.5 shrink-0 rounded-full bg-primary"
                                title={t("entity.session.drawer.unsavedRow")}
                                aria-label={t("entity.session.drawer.unsavedRow")}
                              />
                            )}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            {STATUSES.map((s) => {
                              const active = marks[r.studentId] === s;
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  disabled={!canEdit}
                                  aria-pressed={active}
                                  aria-label={t(`entity.attendance.status${cap(s)}`)}
                                  onClick={() => {
                                    setFocusRow(i);
                                    toggle(r.studentId, s);
                                  }}
                                  className={cn(
                                    "focus-ring size-8 rounded-lg border text-xs font-semibold transition-colors",
                                    active
                                      ? STATUS_STYLE[s]
                                      : "border-border text-muted-foreground hover:bg-muted",
                                    !canEdit && "cursor-not-allowed opacity-60",
                                  )}
                                >
                                  {t(`entity.session.code.${s}`)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                </div>

                {canEdit && (
                  <footer className="sticky bottom-0 space-y-2 border-t border-border bg-card px-5 py-3.5">
                    {/* A failed save keeps the marks on screen; say so, and put
                        the retry where the failure was noticed rather than only
                        in a toast that has already faded. */}
                    {save.isError && (
                      <div
                        role="alert"
                        className="surface-alert flex items-center gap-2 px-3 py-2 text-xs"
                      >
                        <span className="min-w-0 flex-1">
                          {t("entity.session.drawer.saveFailed")}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 rounded-lg text-xs"
                          onClick={submit}
                          disabled={save.isPending}
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                          {t("entity.session.drawer.retry")}
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "min-w-0 text-xs",
                          // Unsaved work outranks "who is left": it is the state
                          // that can actually be LOST.
                          isDirty
                            ? "font-medium text-primary"
                            : missing > 0
                              ? "text-accent"
                              : "text-success",
                        )}
                      >
                        {isDirty
                          ? t("entity.session.drawer.unsavedCount", { count: changed.length })
                          : missing > 0
                            ? t("entity.session.drawer.missing", { count: missing })
                            : t("entity.session.drawer.ready")}
                      </span>
                      <Button
                        type="button"
                        className="ms-auto shrink-0 rounded-xl"
                        onClick={submit}
                        disabled={!isDirty || save.isPending}
                      >
                        {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                        {save.isPending
                          ? t("entity.session.drawer.saving")
                          : t("entity.session.drawer.save")}
                      </Button>
                    </div>
                  </footer>
                )}
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Shared empty reference -- see the note on `roster` above. */
const EMPTY_ROSTER: never[] = [];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function DrawerHeader({
  session,
  locale,
  subjectLabel,
}: {
  session: SessionInstance;
  locale: string;
  subjectLabel: (k: string | null | undefined, n?: string | null) => string;
}) {
  const tint = subjectTint(session.subjectColor, session.subjectKey);
  // The time range is kept OUT of this joined string and rendered as its own
  // bidi-isolated element below: "14:00 – 16:00" is direction-neutral, so under
  // RTL the browser reorders it to "16:00 – 14:00" and states the wrong times.
  const meta = [formatDate(session.date, locale), session.teacherName, session.room].filter(
    Boolean,
  );

  return (
    <header className="border-b border-border px-5 py-4" style={{ backgroundColor: tint.tint }}>
      <div className="flex items-start justify-between gap-3 pe-8">
        <div className="min-w-0">
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: tint.color }}
          >
            {subjectLabel(session.subjectKey, session.subjectName)}
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold tracking-tight">
            {session.groupName}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <span dir="ltr" style={{ unicodeBidi: "isolate" }} className="tabular-nums">
              {session.startTime} – {session.endTime}
            </span>
            {meta.length > 0 && ` · ${meta.join(" · ")}`}
          </p>
        </div>
      </div>
    </header>
  );
}

/** A group nobody is enrolled in: point at Inscriptions rather than an empty list. */
function ZeroEnrollment({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <UserPlus className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium">{t("entity.session.drawer.noStudents")}</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {t("entity.session.drawer.noStudentsHint")}
      </p>
      <Button asChild variant="outline" size="sm" className="mt-1 rounded-xl">
        <Link to="/dashboard/registrations">{t("entity.session.drawer.goToRegistrations")}</Link>
      </Button>
    </div>
  );
}
