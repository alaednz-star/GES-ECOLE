/**
 * One session, as a clickable card.
 *
 * The GROUP is the headline, not the subject: parallel sessions in the same slot
 * usually share a subject and differ only by group, so leading with the subject
 * would make three cards look identical.
 *
 * Colours come from `subjects.color` in the database via `subjectTint`, and
 * statuses map onto the existing semantic tokens. No new palette.
 *
 * CONTAINMENT IS THE HARD REQUIREMENT HERE. A month cell is roughly 1/7th of the
 * grid, so every text node needs `truncate` AND an ancestor chain that can
 * actually shrink -- a `min-w-0` on each flex/grid child. Without that a long
 * group name pushes the chip past its column and the card visibly escapes the
 * cell, which is the bug this file exists to prevent.
 */

import { useSubjectLabel } from "../subject-label";
import { subjectTint } from "./subject-tint";
import { STATUS_CLASS, STATUS_DOT, useStatusLabel } from "./status-label";
import type { SessionInstance } from "./types";
import { cn } from "@/lib/utils";

export function SessionCard({
  session,
  onOpen,
  compact = false,
}: {
  session: SessionInstance;
  onOpen: (s: SessionInstance) => void;
  /** Month view: one dense line instead of the full card. */
  compact?: boolean;
}) {
  const subjectLabel = useSubjectLabel();
  const statusLabel = useStatusLabel();
  const tint = subjectTint(session.subjectColor, session.subjectKey);
  const subject = subjectLabel(session.subjectKey, session.subjectName);
  const status = statusLabel(session);

  // Same tooltip in both densities: the compact chip necessarily hides detail,
  // and hovering is the cheapest way to get it back.
  const title = `${session.startTime}–${session.endTime} · ${session.groupName} · ${subject}${
    session.teacherName ? ` · ${session.teacherName}` : ""
  }${session.room ? ` · ${session.room}` : ""} — ${status}`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onOpen(session)}
        title={title}
        className={cn(
          "focus-ring flex w-full min-w-0 items-center gap-1.5 rounded-md py-[3px] pe-1.5 ps-1.5",
          "text-start text-[11px] leading-tight transition-colors hover:brightness-[.97]",
          session.status === "cancelled" && "opacity-55",
        )}
        style={{
          backgroundColor: tint.tint,
          // Logical property: becomes the right edge under RTL automatically.
          borderInlineStart: `2px solid ${tint.color}`,
        }}
      >
        {/* The status dot carries state in FORM as well as colour, so a
            colour-blind reader still gets the subject/status separation. */}
        <span
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[session.status])}
          aria-hidden
        />
        <span className="shrink-0 font-semibold tabular-nums">{session.startTime}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{session.groupName}</span>
      </button>
    );
  }

  const meta = [session.teacherName, session.room].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      title={title}
      className={cn(
        "focus-ring block w-full min-w-0 rounded-lg px-2.5 py-2 text-start",
        "transition-shadow hover:shadow-soft",
        session.status === "cancelled" && "opacity-55",
      )}
      style={{
        backgroundColor: tint.tint,
        border: `1px solid ${tint.border}`,
        borderInlineStart: `3px solid ${tint.color}`,
      }}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {session.startTime}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug"
          style={{ color: tint.color }}
        >
          {session.groupName}
        </span>
      </div>
      <p className="truncate text-[11.5px] font-medium text-secondary-foreground">{subject}</p>
      {meta && <p className="truncate text-[10.5px] text-muted-foreground">{meta}</p>}
      <p
        className={cn(
          "mt-1 flex items-center gap-1 text-[11px] font-medium",
          STATUS_CLASS[session.status],
        )}
      >
        <span
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[session.status])}
          aria-hidden
        />
        <span className="min-w-0 truncate">{status}</span>
      </p>
    </button>
  );
}
