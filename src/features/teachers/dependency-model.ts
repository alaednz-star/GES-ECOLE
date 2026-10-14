/**
 * What stands between an account and permanent deletion. PURE.
 *
 * No imports, so `node --test` can load it -- the same shape as `roster-model.ts` and
 * `payment-model.ts`.
 *
 * WHY THIS EXISTS AT ALL. The rule was written out three times: once in the database
 * (`entity_is_deletable`), once in the server function that actually deletes, and once in the
 * confirmation dialog that decides whether to disable the button. The two application copies
 * were written as "anything that is not incidental blocks", which is a rule stated by
 * exclusion -- so the moment a fourth severity was added they silently began blocking on it,
 * disagreeing with the database, and the dialog would have refused a deletion the server
 * would have allowed. Naming the blocking severities positively, in one place, is the fix.
 *
 * DELETING A LOGIN IS NOT DELETING A HISTORY. That distinction is the whole point of the
 * severities: `preserved` rows outlive the account on purpose, carrying the email of whoever
 * was removed, and must never be a reason to refuse. `blocking` rows would be destroyed or
 * anonymised by the deletion, which is why they stop it.
 */

export type DependencySeverity = "blocking" | "reassignable" | "incidental" | "preserved";

export interface DependencyLike {
  sourceTable: string;
  relationship: string;
  rowCount: number;
  severity: DependencySeverity | string;
}

/**
 * The severities that genuinely stop a deletion, named rather than inferred.
 *
 * `blocking`      -- the rows would be lost or anonymised with no way back.
 * `reassignable`  -- they can be moved to somebody else first, so move them.
 */
const BLOCKING: readonly string[] = ["blocking", "reassignable"];

/** Dependencies that must be cleared before the account can be deleted. */
export function deletionBlockers<T extends DependencyLike>(
  dependencies: readonly T[] | null | undefined,
): T[] {
  return (dependencies ?? []).filter((d) => d.rowCount > 0 && BLOCKING.includes(d.severity));
}

/**
 * Dependencies that survive the deletion with identity retained.
 *
 * Returned separately so the dialog can SHOW them rather than hide them: an administrator
 * being told "the audit trail is kept" is better served by seeing the two entries that will
 * be kept than by seeing nothing at all.
 */
export function preservedRecords<T extends DependencyLike>(
  dependencies: readonly T[] | null | undefined,
): T[] {
  return (dependencies ?? []).filter((d) => d.rowCount > 0 && d.severity === "preserved");
}

/** True when nothing stands in the way. An unknown severity is treated as safe-by-name only. */
export function canDelete(dependencies: readonly DependencyLike[] | null | undefined): boolean {
  return deletionBlockers(dependencies).length === 0;
}

/** `groups (2), attendance (14)` -- the reason, in the error the administrator reads. */
export function describeBlockers(dependencies: readonly DependencyLike[]): string {
  return deletionBlockers(dependencies)
    .map((b) => `${b.sourceTable} (${b.rowCount})`)
    .join(", ");
}
