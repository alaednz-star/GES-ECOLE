/**
 * Who belongs on a roster. PURE.
 *
 * No imports, so `node --test` can load it -- the same reason `payment-model.ts` and the
 * Resources model modules are shaped this way.
 *
 * AUTHORIZATION IS NOT DECIDED HERE. A teacher's session already sees only their own groups'
 * registrations, because RLS says so; this module never asks who is looking. What it does is
 * decide which of the rows already in hand belong on the document, so the printed page and
 * the exported file cannot disagree with the list on screen.
 */

/** Registration statuses a roster can show. Mirrors `RegistrationStatus`. */
export type RosterStatus = string;

export interface RosterSourceRow {
  studentId: string;
  studentName: string;
  groupId: string;
  groupName: string;
  subjectName?: string | null;
  levelName?: string | null;
  status: RosterStatus;
}

export interface RosterRow {
  /** 1-based, assigned after filtering -- a roster is numbered as printed, not as queried. */
  index: number;
  studentId: string;
  studentName: string;
  groupName: string;
  subjectName: string | null;
  levelName: string | null;
  status: RosterStatus;
}

/** `null` means every group the viewer can see. */
export type RosterScope = { groupId: string | null };

export interface RosterOptions {
  scope: RosterScope;
  /** Free text, matched against student, group, subject and level. Empty means no filter. */
  search?: string;
  /**
   * Only `approved` registrations by default: a roster is the list of children who hold a
   * place, and printing pending requests as though they were enrolled is how a class list
   * ends up wrong on the first day.
   */
  statuses?: readonly RosterStatus[];
}

const DEFAULT_STATUSES = ["approved"] as const;

/**
 * The rows that belong on the document, in the order they will be printed.
 *
 * Sorted by name rather than by insertion: a roster is read by a human looking for a child,
 * and `localeCompare` keeps Arabic names in Arabic collation rather than code-point order.
 */
export function buildRoster(
  source: readonly RosterSourceRow[] | null | undefined,
  options: RosterOptions,
): RosterRow[] {
  if (!source) return [];
  const statuses = options.statuses ?? DEFAULT_STATUSES;
  const needle = (options.search ?? "").trim().toLowerCase();

  const matched = source.filter((r) => {
    if (!statuses.includes(r.status)) return false;
    if (options.scope.groupId && r.groupId !== options.scope.groupId) return false;
    if (!needle) return true;
    return [r.studentName, r.groupName, r.subjectName ?? "", r.levelName ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  // De-duplicate by student WITHIN a single group. The same child legitimately appears twice
  // across an all-groups roster -- two subjects, two places -- and collapsing that would
  // under-count the class they are actually in.
  const seen = new Set<string>();
  const unique = matched.filter((r) => {
    const key = `${r.studentId}::${r.groupId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) || a.studentName.localeCompare(b.studentName),
    )
    .map((r, i) => ({
      index: i + 1,
      studentId: r.studentId,
      studentName: r.studentName,
      groupName: r.groupName,
      subjectName: r.subjectName ?? null,
      levelName: r.levelName ?? null,
      status: r.status,
    }));
}

export interface RosterDocumentMeta {
  /** The school's own name, or null when branding has not resolved. */
  schoolName: string | null;
  /** Localised document title, e.g. "Liste des élèves". */
  title: string;
  /** The group's name, or null for an all-groups roster. */
  groupName: string | null;
  /** `YYYY-MM-DD`, the day the document was produced. */
  generatedOn: string;
  count: number;
  /** Drives `bidirectional` in the Word document and `dir` in the print view. */
  rtl: boolean;
}

/**
 * Everything the header of a generated document needs, decided once.
 *
 * Print, PDF and Word all read this, so the three cannot drift into describing the same
 * list differently -- which is exactly the sort of difference nobody notices until a
 * printed list and an emailed list disagree.
 *
 * `rows` is only ever counted, so it is typed as an opaque array: the teacher list passes
 * its own rows through this same function rather than growing a second header format.
 */
export function rosterMeta(input: {
  schoolName: string | null | undefined;
  title: string;
  /** The subtitle under the title: a group's name for a roster, the scope for another list. */
  groupName: string | null | undefined;
  rows: readonly unknown[];
  locale: string;
  today?: Date;
}): RosterDocumentMeta {
  const d = input.today ?? new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return {
    schoolName: input.schoolName?.trim() || null,
    title: input.title,
    groupName: input.groupName?.trim() || null,
    // Local calendar date, not `toISOString()`, which shifts to UTC and can name yesterday.
    generatedOn: `${d.getFullYear()}-${month}-${day}`,
    count: input.rows.length,
    rtl: input.locale === "ar",
  };
}

/**
 * A filename that survives every filesystem.
 *
 * Arabic school names are legal in a filename but travel badly through email gateways and
 * older Windows shares, so anything outside a conservative set becomes a hyphen. The date
 * keeps successive exports from overwriting each other.
 */
export function rosterFilename(
  meta: RosterDocumentMeta,
  extension: string,
  /**
   * Which list this is, as a stable ASCII token. Optional, and omitted for the student
   * roster so its filenames are unchanged. The teacher list passes one because its scope is
   * a translated word: in Arabic every character of it is stripped by the slug rules below,
   * and two different documents would otherwise land on the same name.
   */
  kind?: string,
): string {
  const parts = [
    meta.schoolName ?? kind ?? "roster",
    ...(kind ? [kind] : []),
    meta.groupName ?? "all",
    meta.generatedOn,
  ];
  const slug = parts
    .join("-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
  return `${slug || "roster"}.${extension}`;
}
