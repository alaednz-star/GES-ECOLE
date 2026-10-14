/**
 * Subject colour → inline style, derived from the DATABASE.
 *
 * `subjects.color` already exists and `useGroups` already reads it, so the
 * calendar has no business inventing a second palette. `styles.css` states the
 * rule for the whole project: "Tokens only. Never hardcode colors in
 * components." The tint and border here are computed from the stored colour via
 * `color-mix`, which keeps one source of truth per subject.
 *
 * The fallback cycle applies ONLY when a subject has no stored colour, so a
 * custom subject added through the UI still renders distinguishably instead of
 * defaulting to grey.
 */

/**
 * Fallback hues, used only when `subjects.color` is null.
 *
 * Assigned by a hash of the subject key rather than by array position, so a
 * subject keeps the same colour as others are added or removed -- position-based
 * assignment would reshuffle the whole calendar when one subject is created.
 */
const FALLBACK_CYCLE = ["#2f6fed", "#7a5bef", "#0d9b74", "#d97a2b", "#c2478f"] as const;

/** Stable, order-independent index for a subject. */
function hashIndex(seed: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100_000;
  return h % buckets;
}

export function subjectColor(
  storedColor: string | null | undefined,
  subjectKey: string | null | undefined,
): string {
  if (storedColor) return storedColor;
  const seed = subjectKey ?? "unknown";
  return FALLBACK_CYCLE[hashIndex(seed, FALLBACK_CYCLE.length)] as string;
}

export interface SubjectTint {
  /** Full-strength colour: text, dots, the card's edge marker. */
  color: string;
  /** Very light wash for a card background. */
  tint: string;
  /** Slightly stronger than the tint, for a 1px border. */
  border: string;
}

/**
 * Card styling for a subject.
 *
 * `color-mix(in oklch, ...)` mixes against the card token rather than plain
 * white, so tints stay correct if the surface changes (dark mode is already
 * prepared in `styles.css`, even though the toggle is not shipped).
 */
export function subjectTint(
  storedColor: string | null | undefined,
  subjectKey: string | null | undefined,
): SubjectTint {
  const color = subjectColor(storedColor, subjectKey);
  return {
    color,
    tint: `color-mix(in oklch, ${color} 8%, var(--color-card))`,
    border: `color-mix(in oklch, ${color} 22%, var(--color-card))`,
  };
}

/** Maps a session status onto the existing semantic tokens -- no new hues. */
export const STATUS_TOKEN: Record<string, string> = {
  complete: "text-success",
  partial: "text-accent",
  due: "text-accent",
  overdue: "text-destructive",
  scheduled: "text-muted-foreground",
  empty: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};
