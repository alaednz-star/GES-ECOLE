import { useI18n } from "@/hooks/use-i18n";
import type { SessionInstance, SessionStatus } from "./types";

/** Status -> existing semantic token. `styles.css` owns the actual values. */
export const STATUS_CLASS: Record<SessionStatus, string> = {
  complete: "text-success",
  partial: "text-accent",
  due: "text-accent",
  overdue: "text-destructive",
  scheduled: "text-muted-foreground",
  empty: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};

/**
 * Background form of the same tokens, for the status dot.
 *
 * State is encoded in shape AND colour: the dot gives the compact month chip a
 * status signal in ~6px, where a text label would not fit, and it keeps the
 * status readable independently of the subject colour behind it.
 */
export const STATUS_DOT: Record<SessionStatus, string> = {
  complete: "bg-success",
  partial: "bg-accent",
  due: "bg-accent",
  overdue: "bg-destructive",
  scheduled: "bg-muted-foreground/45",
  empty: "bg-muted-foreground/45",
  cancelled: "bg-muted-foreground/45",
};

/**
 * The label for a session's status, with counts interpolated where the wording
 * uses them (`complete` and `partial` read "6/14 pointés").
 *
 * Lives outside the component file so that file exports components only, which
 * is what React Fast Refresh needs to hot-reload reliably.
 */
export function useStatusLabel() {
  const { t } = useI18n();
  return (s: SessionInstance): string =>
    t(`entity.session.status.${s.status}`, {
      marked: s.attendance.marked,
      enrolled: s.enrolled,
    });
}
