/**
 * Course resources: chapters, resources, and per-student progress.
 *
 * Types only -- no React, no Supabase -- so this stays importable anywhere.
 */

export type ResourceKind = "file" | "link";

/**
 * What a resource is FOR, as opposed to what format it is in. Mirrors the
 * `resource_role` enum added in `20260811100000`; the database is the authority on
 * the set of values, this union is the compile-time echo of it.
 */
export type ResourceRole = "notes" | "exercises" | "solutions" | "video" | "homework" | "extra";

/**
 * Pedagogical reading order: notes before exercises before their solutions.
 * Identical to `resource_role_weight()` in the database, which exists so SQL can
 * sort the same way -- if one changes, both must.
 */
export const RESOURCE_ROLES: readonly ResourceRole[] = [
  "notes",
  "exercises",
  "solutions",
  "video",
  "homework",
  "extra",
] as const;

/** Position of a role in the pedagogical order. Unknown values sort last. */
export function roleWeight(role: ResourceRole | null | undefined): number {
  const i = role ? RESOURCE_ROLES.indexOf(role) : -1;
  return i === -1 ? RESOURCE_ROLES.length : i;
}
/** `open` was migrated to `view` in 20260811100000 and nothing writes it any more;
 *  the enum value survives in Postgres only because a value in use cannot be
 *  removed. Kept off this union so no new call site can reach for it. */
export type ResourceEventKind = "view" | "download";

/**
 * Derived visibility. Not a stored column: `is_published` and `published_at` are
 * two separate intentions ("hidden" vs "scheduled for Monday") and a teacher
 * toggling one must not lose the other.
 */
export type ResourceVisibility = "published" | "scheduled" | "hidden";

export interface ResourceRow {
  id: string;
  chapterId: string;
  groupId: string;
  title: string;
  description: string | null;
  kind: ResourceKind;
  /** Path in the private `course-resources` bucket. Null for links. */
  storagePath: string | null;
  /** External URL. Null for files. */
  url: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  position: number;
  /** Pedagogical purpose. Drives the badge and the default within-chapter order. */
  role: ResourceRole;
  /** Derived from `url` on save. Null for files. Decides how a link is previewed. */
  linkProvider: string | null;
  /**
   * Derived from `url` on save. Null for files, and null for any provider whose
   * thumbnail cannot be known without a network call -- see `link-provider.ts`.
   */
  linkThumbnailUrl: string | null;
  pinned: boolean;
  allowDownload: boolean;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  /** Derived, see `ResourceVisibility`. */
  visibility: ResourceVisibility;
  /** Distinct students who opened it. Staff view only. */
  openCount?: number | undefined;
  /** Whether the SIGNED-IN student has opened it. Student view only. */
  openedByMe?: boolean | undefined;
}

export interface ChapterRow {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  position: number;
  /** Pinned chapters sort ahead of the rest, within their group. */
  pinned: boolean;
  isPublished: boolean;
  publishedAt: string | null;
  /** Derived from the two fields above, exactly as resources are. */
  visibility: ResourceVisibility;
  createdAt: string;
  resources: ResourceRow[];
}

/**
 * Chapter order for students and staff alike: pinned first, then the manual
 * position, then title so the sort is total.
 *
 * Pinning deliberately does NOT reorder resources inside a chapter -- see
 * `compareResources`. A pinned chapter is a chapter promoted; a pinned resource is
 * a resource surfaced in a separate rail. Conflating the two would mean a teacher
 * could not pin something without also disturbing the reading order.
 */
export function compareChapters(a: ChapterRow, b: ChapterRow): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.position - b.position || a.title.localeCompare(b.title);
}

/**
 * A chapter without its resources, for the pickers.
 *
 * The creation dialog needs the chapters of ONE group and nothing else; loading
 * every chapter in the school with its resources to fill a selector is what the
 * flat selector used to do.
 */
export interface ChapterOption {
  id: string;
  groupId: string;
  title: string;
  position: number;
}

/** Where a bulk move or a duplication is going. Group travels with the chapter so
 *  the destination can be validated without a second lookup. */
export interface ResourceDestination {
  groupId: string;
  chapterId: string;
}

/** A group with its chapters -- the COURS -> CHAPITRE -> RESSOURCES spine. */
export interface CourseResources {
  groupId: string;
  groupName: string;
  subjectKey: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  levelName: string | null;
  /**
   * Resolved through `groups.teacher_id -> teachers -> profiles`, not stored on the
   * chapter. A group has exactly one teacher, so a copy here would only be able to
   * go stale.
   */
  teacherName: string | null;
  chapters: ChapterRow[];
  /** Resources whose chapter was deleted are impossible (cascade), so this is
   *  only the flat count across chapters -- handy for the header stats. */
  resourceCount: number;
}

/** Header figures. Derived, never stored. */
export interface ResourceStats {
  chapters: number;
  resources: number;
  published: number;
  scheduled: number;
  hidden: number;
  /** Total bytes of uploaded files, for the quota readout. */
  storageBytes: number;
}

/**
 * The three states a resource can be in, derived from two columns.
 *
 * `is_published` + `published_at` rather than a `visibility` enum was a deliberate
 * modelling choice, and this is the function that makes the two shapes equivalent:
 * unpublished is hidden, published with a future date is scheduled, anything else is
 * live. Pure, so the rule is stated once and cannot drift between the teacher page,
 * the student page and the stats.
 */
export function visibilityOf(isPublished: boolean, publishedAt: string | null): ResourceVisibility {
  if (!isPublished) return "hidden";
  if (publishedAt && new Date(publishedAt) > new Date()) return "scheduled";
  return "published";
}

/** Roll-up of every chapter and resource a teacher can see, for the header counters. */
export function statsFor(courses: CourseResources[]): ResourceStats {
  let chapters = 0,
    resources = 0,
    published = 0,
    scheduled = 0,
    hidden = 0,
    storageBytes = 0;
  for (const c of courses) {
    chapters += c.chapters.length;
    for (const ch of c.chapters) {
      for (const r of ch.resources) {
        resources += 1;
        if (r.visibility === "published") published += 1;
        else if (r.visibility === "scheduled") scheduled += 1;
        else hidden += 1;
        storageBytes += r.sizeBytes ?? 0;
      }
    }
  }
  return { chapters, resources, published, scheduled, hidden, storageBytes };
}
