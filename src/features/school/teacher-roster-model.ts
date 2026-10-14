/**
 * Who belongs on the teacher list. PURE.
 *
 * No imports, so `node --test` can load it -- the same shape as `roster-model.ts`,
 * `payment-model.ts` and the Resources model modules.
 *
 * SEPARATE FROM `roster-model.ts` ON PURPOSE. A teacher list and a student roster answer
 * different questions: a student appears once per GROUP they hold a place in, while a
 * teacher appears once, full stop, and is filtered by employment status rather than by
 * registration status. Forcing both through one filter would mean a shape carrying two sets
 * of half-used fields. What the two genuinely share -- the document header, the filename,
 * the table builder, the printed page -- is shared, and lives in `roster-model.ts`,
 * `roster-export.ts` and `roster-print-document.tsx`.
 *
 * AUTHORIZATION IS NOT DECIDED HERE. The teachers page is admin-only and the caller passes
 * the rows it already holds; this module never asks who is looking.
 */

/** Employment statuses a teacher list can show. Mirrors `EntityStatus`. */
export type TeacherStatus = string;

export interface TeacherRosterSourceRow {
  teacherId: string;
  teacherName: string;
  email?: string | null;
  phone?: string | null;
  subjects?: readonly string[] | null;
  groupCount?: number | null;
  status: TeacherStatus;
}

export interface TeacherRosterRow {
  /** 1-based, assigned after filtering -- numbered as printed, not as queried. */
  index: number;
  teacherId: string;
  teacherName: string;
  email: string | null;
  phone: string | null;
  /** Already joined for display; the source array is kept out of the document layer. */
  subjects: string;
  groupCount: number;
  status: TeacherStatus;
}

/** `null` means every status -- the list as it stands on screen. */
export type TeacherRosterScope = { status: TeacherStatus | null };

export interface TeacherRosterOptions {
  scope: TeacherRosterScope;
  /** Free text, matched against name, email, phone and subjects. Empty means no filter. */
  search?: string;
}

/**
 * The teachers that belong on the document, in the order they will be printed.
 *
 * Sorted by name rather than by insertion: the list is read by a human looking for a person,
 * and `localeCompare` keeps Arabic names in Arabic collation rather than code-point order.
 *
 * Unlike the student roster there is no all-statuses default: an administrator printing a
 * staff list is as likely to want the inactive ones (who taught last year) as not, so the
 * scope is always the caller's explicit choice and `null` shows everyone.
 */
export function buildTeacherRoster(
  source: readonly TeacherRosterSourceRow[] | null | undefined,
  options: TeacherRosterOptions,
): TeacherRosterRow[] {
  if (!source) return [];
  const needle = (options.search ?? "").trim().toLowerCase();

  const matched = source.filter((r) => {
    if (options.scope.status && r.status !== options.scope.status) return false;
    if (!needle) return true;
    return [r.teacherName, r.email ?? "", r.phone ?? "", (r.subjects ?? []).join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  // One row per person. A teacher reaching this list twice is a join artefact, not two
  // members of staff, and printing them twice would misstate the size of the school.
  const seen = new Set<string>();
  const unique = matched.filter((r) => {
    if (seen.has(r.teacherId)) return false;
    seen.add(r.teacherId);
    return true;
  });

  return unique
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName))
    .map((r, i) => ({
      index: i + 1,
      teacherId: r.teacherId,
      teacherName: r.teacherName,
      email: r.email?.trim() || null,
      phone: r.phone?.trim() || null,
      subjects: (r.subjects ?? []).filter((s) => s.trim()).join(", "),
      groupCount: r.groupCount ?? 0,
      status: r.status,
    }));
}
