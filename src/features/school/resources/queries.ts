/**
 * Course resources data layer.
 *
 * Follows the conventions already in `features/school/queries.ts`: a `schoolKeys`
 * style key registry rooted so one write invalidates every reader, `must()` for
 * error surfacing, and RLS left as the only authority on what comes back.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { currentAccessToken } from "@/integrations/supabase/access-token";
import { supabaseRestConfig } from "@/integrations/supabase/client";
import { assertUploadAllowedFn, signResourceUrlFn } from "./storage.functions";
import type {
  ChapterOption,
  ChapterRow,
  CourseResources,
  ResourceDestination,
  ResourceEventKind,
  ResourceKind,
  ResourceRole,
  ResourceRow,
  ResourceStats,
  ResourceVisibility,
} from "./types";
import { compareChapters, roleWeight, statsFor, visibilityOf } from "./types";

/*
  Re-exported rather than moved-and-forgotten: these two were defined here, and pages
  import them from here. They now live in `types.ts` because that module has no imports
  at all, which is what lets `node --test` load them -- `queries.ts` reaches the browser
  Supabase client through a `@/` alias the test runner cannot resolve.
*/
export { statsFor, visibilityOf };
import { providerOf, thumbnailFor } from "./link-provider";

/**
 * Where resources go when their chapter is deleted but the teacher wants to keep
 * them. Found-or-created per group by title, because there is no "system chapter"
 * flag in the schema and inventing one for this would be a migration in service of
 * a label. It behaves like any other chapter afterwards -- renameable, orderable --
 * which is the honest consequence of that choice.
 */
export const UNFILED_CHAPTER_TITLE = "Non classé";

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Private bucket. Files are only ever reached through a short-lived signed URL. */
export const RESOURCE_BUCKET = "course-resources";

/**
 * Every key under one root, so a single invalidation refreshes the teacher page,
 * the student page and the stats together. Same reasoning as `attendanceRoot` in
 * `queries.ts`, which documents three bugs caused by naming caches individually.
 */
export const resourceKeys = {
  root: ["resources"] as const,
  byGroup: (groupId: string | null) => ["resources", "group", groupId ?? "all"] as const,
  mine: (studentId: string) => ["resources", "student", studentId] as const,
  /** Chapters of ONE group, for the pickers. Under the same root, so saving a
   *  chapter invalidates this alongside everything else. */
  chaptersOf: (groupId: string) => ["resources", "chapters-of", groupId] as const,
  /** Engagement figures for one resource. Under the root too, so recording a view
   *  refreshes the panel without a second invalidation rule. */
  engagement: (resourceId: string) => ["resources", "engagement", resourceId] as const,
  /** Centre storage usage. Under the root, so an upload refreshes it. */
  quota: ["resources", "quota"] as const,
};

/* ------------------------------ DERIVATION ------------------------------ */

/** `is_published` + `published_at` -> one of three states the UI can render. */
/* --------------------------- SHARED ROW MAPPING --------------------------- */

interface RawResource {
  id: string;
  chapter_id: string;
  group_id: string;
  title: string;
  description: string | null;
  kind: string;
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  position: number;
  role: string;
  link_provider: string | null;
  link_thumbnail_url: string | null;
  pinned: boolean;
  allow_download: boolean;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

function mapResource(r: RawResource): ResourceRow {
  return {
    id: r.id,
    chapterId: r.chapter_id,
    groupId: r.group_id,
    title: r.title,
    description: r.description,
    kind: r.kind as ResourceKind,
    storagePath: r.storage_path,
    url: r.url,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    position: r.position,
    role: r.role as ResourceRole,
    linkProvider: r.link_provider,
    linkThumbnailUrl: r.link_thumbnail_url,
    pinned: r.pinned,
    allowDownload: r.allow_download,
    isPublished: r.is_published,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    visibility: visibilityOf(r.is_published, r.published_at),
  };
}

const CHAPTER_COLUMNS =
  "id, group_id, title, description, position, pinned, is_published, published_at, created_at";

/** PostgREST shape for a chapter row, resources embedded separately. */
interface RawChapter {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  position: number;
  pinned: boolean;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

function mapChapter(c: RawChapter, resources: ResourceRow[]): ChapterRow {
  return {
    id: c.id,
    groupId: c.group_id,
    title: c.title,
    description: c.description,
    position: c.position,
    pinned: c.pinned,
    isPublished: c.is_published,
    publishedAt: c.published_at,
    visibility: visibilityOf(c.is_published, c.published_at),
    createdAt: c.created_at,
    resources,
  };
}

const RESOURCE_COLUMNS =
  "id, chapter_id, group_id, title, description, kind, storage_path, url, mime_type, size_bytes, position, role, link_provider, link_thumbnail_url, pinned, allow_download, is_published, published_at, created_at";

/**
 * Within a chapter: the teacher's manual order first, always.
 *
 * `position` is what drag-and-drop writes, so it has to win -- a teacher who drags
 * the corrigé above the exercises meant it. The pedagogical role only breaks ties
 * between resources that share a position, which is what new uploads do before
 * anyone has arranged them. `resource_role_weight()` in the database encodes the
 * same order for SQL; `createdAt` settles the rest so the sort is total.
 */
function compareResources(a: ResourceRow, b: ResourceRow): number {
  return (
    a.position - b.position ||
    roleWeight(a.role) - roleWeight(b.role) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

/** `groups.teacher_id -> teachers -> profiles`, in one embed rather than a second
 *  round trip. Shaped by PostgREST, so the nesting is what it is. */
interface RawGroup {
  name: string;
  subjects: { key: string; name: string; color: string } | null;
  levels: { name: string } | null;
  teachers: { profiles: { full_name: string } | null } | null;
}

const COURSE_GROUP_EMBED =
  "groups!inner(name, subjects(key, name, color), levels(name), teachers(profiles(full_name)))";

function courseFrom(groupId: string, g: RawGroup | null): CourseResources {
  return {
    groupId,
    groupName: g?.name ?? "\u2014",
    subjectKey: g?.subjects?.key ?? null,
    subjectName: g?.subjects?.name ?? null,
    subjectColor: g?.subjects?.color ?? null,
    levelName: g?.levels?.name ?? null,
    teacherName: g?.teachers?.profiles?.full_name ?? null,
    chapters: [],
    resourceCount: 0,
  };
}

/* ------------------------------ STAFF READ ------------------------------ */

/**
 * Chapters and resources for the groups the caller may manage.
 *
 * RLS decides which groups those are, so a teacher gets their own and an admin
 * gets everything -- this hook filters nothing. `groupId` narrows it further when
 * the user picks a course from the filter.
 */
export function useCourseResources(groupId?: string | null) {
  return useQuery({
    queryKey: resourceKeys.byGroup(groupId ?? null),
    queryFn: async (): Promise<CourseResources[]> => {
      let q = supabase
        .from("chapters")
        .select(
          `${CHAPTER_COLUMNS},
           ${COURSE_GROUP_EMBED},
           resources(${RESOURCE_COLUMNS})`,
        )
        .order("position", { ascending: true });
      if (groupId) q = q.eq("group_id", groupId);
      const rows = must(await q);

      // Counts are a second, narrow query: pulling every event row through the
      // join would grow with enrolment for a number the UI shows as "12 vues".
      const chapterIds = rows.map((r) => r.id);
      const openCounts = new Map<string, number>();
      if (chapterIds.length > 0) {
        const events = await supabase
          .from("resource_events")
          .select("resource_id, resources!inner(chapter_id)")
          // `open` was migrated to `view` in 20260811100000; nothing writes it now.
          .eq("kind", "view")
          .in("resources.chapter_id", chapterIds);
        for (const e of events.data ?? []) {
          openCounts.set(e.resource_id, (openCounts.get(e.resource_id) ?? 0) + 1);
        }
      }

      const byGroup = new Map<string, CourseResources>();
      for (const row of rows) {
        let course = byGroup.get(row.group_id);
        if (!course) {
          course = courseFrom(row.group_id, row.groups as RawGroup | null);
          byGroup.set(row.group_id, course);
        }
        const resources = (row.resources ?? [])
          .map((r) => mapResource(r as RawResource))
          .map((r) => ({ ...r, openCount: openCounts.get(r.id) ?? 0 }))
          .sort(compareResources);
        course.chapters.push(mapChapter(row as unknown as RawChapter, resources));
        course.resourceCount += resources.length;
      }
      for (const course of byGroup.values()) course.chapters.sort(compareChapters);
      return [...byGroup.values()].sort((a, b) => a.groupName.localeCompare(b.groupName));
    },
  });
}

/**
 * Chapters of ONE group, without their resources.
 *
 * The creation dialog needs exactly this and nothing more. It used to read the
 * page's full `useCourseResources` result, which meant the chapter selector could
 * only offer groups the page had already loaded -- and offered every chapter in the
 * school in one flat list. Scoping the query to the chosen group is what makes
 * "chapters of this group, and only this group" true rather than filtered-after.
 *
 * RLS still decides: a teacher gets nothing back for a group they do not manage.
 */
export function useChaptersByGroup(groupId: string | null | undefined) {
  return useQuery({
    queryKey: resourceKeys.chaptersOf(groupId ?? "none"),
    enabled: !!groupId,
    queryFn: async (): Promise<ChapterOption[]> => {
      const rows = must(
        await supabase
          .from("chapters")
          .select("id, group_id, title, position")
          .eq("group_id", groupId as string)
          .order("position", { ascending: true }),
      );
      // No pinned-first here on purpose: a picker reads better in the teacher's own
      // numbering than in the order the student sees.

      return rows.map((r) => ({
        id: r.id,
        groupId: r.group_id,
        title: r.title,
        position: r.position,
      }));
    },
  });
}

/* ----------------------------- STUDENT READ ----------------------------- */

/**
 * What the signed-in student may see: published, due resources in their approved
 * groups, grouped COURS -> CHAPITRE -> RESSOURCES.
 *
 * The visibility rule is enforced by RLS, not here. The client-side filter below
 * only removes chapters left empty by it, so the page does not render a chapter
 * with nothing in it.
 */
export function useMyResources(studentId: string | undefined) {
  return useQuery({
    queryKey: resourceKeys.mine(studentId ?? "anon"),
    enabled: !!studentId,
    queryFn: async (): Promise<CourseResources[]> => {
      const rows = must(
        await supabase
          .from("chapters")
          .select(
            `${CHAPTER_COLUMNS},
             ${COURSE_GROUP_EMBED},
             resources(${RESOURCE_COLUMNS})`,
          )
          .order("position", { ascending: true }),
      );

      // Which of them this student has already opened.
      const seen = new Set<string>();
      const events = await supabase
        .from("resource_events")
        .select("resource_id")
        .eq("student_id", studentId as string);
      for (const e of events.data ?? []) seen.add(e.resource_id);

      const byGroup = new Map<string, CourseResources>();
      for (const row of rows) {
        const resources = (row.resources ?? [])
          .map((r) => mapResource(r as RawResource))
          .map((r) => ({ ...r, openedByMe: seen.has(r.id) }))
          .sort(compareResources);
        // RLS already dropped anything unpublished; an empty chapter is noise.
        if (resources.length === 0) continue;
        let course = byGroup.get(row.group_id);
        if (!course) {
          course = courseFrom(row.group_id, row.groups as RawGroup | null);
          byGroup.set(row.group_id, course);
        }
        course.chapters.push(mapChapter(row as unknown as RawChapter, resources));
        course.resourceCount += resources.length;
      }
      // Pinned chapters first: the teacher said this one matters.
      for (const course of byGroup.values()) course.chapters.sort(compareChapters);
      return [...byGroup.values()].sort((a, b) => a.groupName.localeCompare(b.groupName));
    },
  });
}

/* ------------------------------- MUTATIONS ------------------------------- */

export function useSaveChapter() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      id?: string | undefined;
      groupId: string;
      title: string;
      description?: string | null | undefined;
      position?: number | undefined;
      pinned?: boolean | undefined;
      isPublished?: boolean | undefined;
      publishedAt?: string | null | undefined;
    }) => {
      const payload = {
        group_id: input.groupId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.isPublished !== undefined ? { is_published: input.isPublished } : {}),
        ...(input.publishedAt !== undefined ? { published_at: input.publishedAt } : {}),
      };
      if (input.id) {
        must(await supabase.from("chapters").update(payload).eq("id", input.id).select());
        return input.id;
      }
      // Returns the new id so a caller that just created a chapter in order to file
      // something into it can select it straight away.
      const rows = must(
        await supabase
          .from("chapters")
          .insert({ ...payload, created_by: user?.id ?? null })
          .select("id"),
      );
      return rows[0]?.id ?? null;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/** Persists a reordered chapter list. One round trip per moved row. */
/**
 * Publish or hide a chapter, and with it everything inside.
 *
 * The chapter half of the AND rule: `resources read` requires the chapter to be
 * live too, so hiding a chapter withdraws its resources without touching their own
 * state. That matters -- a teacher who hides a chapter for a week and republishes it
 * gets back exactly the mix of published, hidden and scheduled resources they had.
 */
export function useSetChapterVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      isPublished: boolean;
      /** ISO instant for a scheduled publication, null for immediate. */
      publishedAt?: string | null | undefined;
    }) => {
      must(
        await supabase
          .from("chapters")
          .update({
            is_published: input.isPublished,
            ...(input.publishedAt !== undefined ? { published_at: input.publishedAt } : {}),
          })
          .eq("id", input.id)
          .select(),
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/** Pin or unpin a chapter. RLS (`chapters write`) is the gate. */
export function useSetChapterPinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; pinned: boolean }) => {
      must(
        await supabase
          .from("chapters")
          .update({ pinned: input.pinned })
          .eq("id", input.id)
          .select(),
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/**
 * "Publier tout" / "Masquer tout" for one chapter's resources.
 *
 * Publishing clears any pending schedule: the teacher pressing "publish everything"
 * means now, and leaving a future `published_at` behind would silently keep some of
 * it invisible.
 */
export function useSetChapterResourcesVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { chapterId: string; isPublished: boolean }) => {
      must(
        await supabase
          .from("resources")
          .update({
            is_published: input.isPublished,
            ...(input.isPublished ? { published_at: null } : {}),
          })
          .eq("chapter_id", input.chapterId)
          .select("id"),
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/**
 * Deletes a chapter, having first decided what happens to its resources.
 *
 * `resources.chapter_id` cascades, so a bare delete takes the files with it. The
 * teacher is asked which they meant, and "keep them" reparents to the group's
 * "Non classé" chapter BEFORE the delete -- the reparent has to succeed first, or a
 * failure halfway would leave the resources deleted with nothing to show for it.
 */
export function useDeleteChapter() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      groupId: string;
      /** `cascade` deletes the resources with it; `unfile` keeps them. */
      resources: "cascade" | "unfile";
    }) => {
      if (input.resources === "unfile") {
        const existing = must(
          await supabase
            .from("chapters")
            .select("id")
            .eq("group_id", input.groupId)
            .eq("title", UNFILED_CHAPTER_TITLE)
            .limit(1),
        );
        let target = existing[0]?.id ?? null;
        if (!target) {
          const created = must(
            await supabase
              .from("chapters")
              .insert({
                group_id: input.groupId,
                title: UNFILED_CHAPTER_TITLE,
                // Last in the outline, and hidden: unfiled material has not been
                // arranged yet, so it should not appear to students on its own.
                position: 9999,
                is_published: false,
                created_by: user?.id ?? null,
              })
              .select("id"),
          );
          target = created[0]?.id ?? null;
        }
        if (!target) throw new Error("Impossible de créer le chapitre « Non classé ».");
        // Move first. If this fails, nothing has been destroyed.
        must(
          await supabase
            .from("resources")
            .update({ chapter_id: target })
            .eq("chapter_id", input.id)
            .select("id"),
        );
      }
      const { error } = await supabase.from("chapters").delete().eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/**
 * Duplicates a chapter and its resources into the same group.
 *
 * Stored files are COPIED in the bucket rather than re-uploaded: the browser already
 * sent those bytes once. `storage.copy` is authorised by the same
 * `course resources staff write` policy as an upload, keyed on the destination
 * folder, so a copy into a group the caller does not manage is refused by storage
 * itself rather than by anything here.
 *
 * The copy starts HIDDEN, whatever the original was. A duplicate is a draft.
 */
export function useDuplicateChapter() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const { data: found, error: foundError } = await supabase
        .from("chapters")
        .select(`${CHAPTER_COLUMNS}, resources(${RESOURCE_COLUMNS})`)
        .eq("id", input.id)
        .maybeSingle();
      if (foundError) throw new Error(foundError.message);
      // RLS decides visibility, so "not found" and "not yours" arrive the same way.
      if (!found) throw new Error("Chapitre introuvable.");
      const source = found as unknown as RawChapter & { resources: RawResource[] };
      const created = must(
        await supabase
          .from("chapters")
          .insert({
            group_id: source.group_id,
            title: `${source.title} (copie)`,
            description: source.description,
            position: (source.position ?? 0) + 1,
            pinned: false,
            is_published: false,
            created_by: user?.id ?? null,
          })
          .select("id"),
      );
      const newChapterId = created[0]?.id;
      if (!newChapterId) throw new Error("Duplication impossible.");

      for (const r of (source.resources ?? []) as RawResource[]) {
        let storagePath = r.storage_path;
        if (r.kind === "file" && r.storage_path) {
          const to = `${source.group_id}/${globalThis.crypto.randomUUID()}/${
            r.storage_path.split("/").slice(2).join("/") || "fichier"
          }`;
          const { error } = await supabase.storage.from(RESOURCE_BUCKET).copy(r.storage_path, to);
          if (error) throw new Error(error.message);
          storagePath = to;
        }
        must(
          await supabase
            .from("resources")
            .insert({
              chapter_id: newChapterId,
              group_id: "00000000-0000-0000-0000-000000000000",
              title: r.title,
              description: r.description,
              kind: r.kind as ResourceKind,
              storage_path: storagePath,
              url: r.url,
              mime_type: r.mime_type,
              size_bytes: r.size_bytes,
              role: r.role as ResourceRole,
              link_provider: r.link_provider,
              pinned: r.pinned,
              allow_download: r.allow_download,
              position: r.position,
              is_published: false,
              published_at: null,
              created_by: user?.id ?? null,
            })
            .select("id"),
        );
      }
      return newChapterId;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

export function useReorderChapters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ordered: { id: string; position: number }[]) => {
      for (const c of ordered) {
        must(
          await supabase.from("chapters").update({ position: c.position }).eq("id", c.id).select(),
        );
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

export interface ResourceInput {
  id?: string | undefined;
  chapterId: string;
  title: string;
  description?: string | null | undefined;
  kind: ResourceKind;
  storagePath?: string | null | undefined;
  url?: string | null | undefined;
  mimeType?: string | null | undefined;
  sizeBytes?: number | null | undefined;
  role?: ResourceRole | undefined;
  pinned?: boolean | undefined;
  allowDownload?: boolean | undefined;
  isPublished?: boolean | undefined;
  publishedAt?: string | null | undefined;
  position?: number | undefined;
}

export function useSaveResource() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: ResourceInput) => {
      const payload = {
        chapter_id: input.chapterId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        kind: input.kind,
        storage_path: input.kind === "file" ? (input.storagePath ?? null) : null,
        url: input.kind === "link" ? (input.url?.trim() ?? null) : null,
        // Derived here rather than taken from the form: it is a property of the URL,
        // and a client-supplied value could disagree with the link it describes.
        link_provider: input.kind === "link" ? providerOf(input.url) : null,
        // Same reasoning as `link_provider`: a property of the URL, derived here so a
        // client cannot store a thumbnail that disagrees with the link it belongs to.
        link_thumbnail_url: input.kind === "link" ? thumbnailFor(input.url) : null,
        mime_type: input.mimeType ?? null,
        size_bytes: input.sizeBytes ?? null,
        role: input.role ?? "extra",
        pinned: input.pinned ?? false,
        allow_download: input.allowDownload ?? true,
        is_published: input.isPublished ?? false,
        published_at: input.publishedAt ?? null,
        ...(input.position !== undefined ? { position: input.position } : {}),
        // `group_id` is NOT sent: a trigger derives it from the chapter, because a
        // client-supplied value here would be a permission bug.
        group_id: "00000000-0000-0000-0000-000000000000",
      };
      if (input.id) {
        must(await supabase.from("resources").update(payload).eq("id", input.id).select());
      } else {
        must(
          await supabase
            .from("resources")
            .insert({ ...payload, created_by: user?.id ?? null })
            .select(),
        );
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

export function useDeleteResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (resource: { id: string; storagePath: string | null }) => {
      // The row first: if the object delete fails the user can retry, whereas an
      // orphaned row would keep advertising a file that is gone.
      const { error } = await supabase.from("resources").delete().eq("id", resource.id);
      if (error) throw new Error(error.message);
      if (resource.storagePath) {
        await supabase.storage.from(RESOURCE_BUCKET).remove([resource.storagePath]);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/** Publish / unpublish without opening the edit dialog. */
export function useSetResourceVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; isPublished: boolean }) => {
      must(
        await supabase
          .from("resources")
          .update({ is_published: input.isPublished })
          .eq("id", input.id)
          .select(),
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/** Pin or unpin one resource. Pinning surfaces it in the student's "Important"
 *  rail; it deliberately does not move it inside its chapter. */
export function useSetResourcePinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; pinned: boolean }) => {
      must(
        await supabase
          .from("resources")
          .update({ pinned: input.pinned })
          .eq("id", input.id)
          .select("id"),
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/* -------------------------------- QUOTA -------------------------------- */

/**
 * The centre's storage usage against its limit.
 *
 * Read from the database, not summed in the browser: `center_storage_bytes()`
 * measures `storage.objects`, which is what actually consumes the quota, while a
 * client-side sum of `resources.size_bytes` counts only the rows currently loaded and
 * misses an object whose row was deleted. The header used to show that sum, which
 * meant the number shrank when a filter was applied.
 *
 * Both functions are already granted to `authenticated` and are the same ones the
 * upload path enforces with, so the figure shown is the figure that will refuse the
 * next upload.
 */
export function useStorageQuota() {
  return useQuery({
    queryKey: resourceKeys.quota,
    // Changes only when something is uploaded or deleted, both of which invalidate
    // the root; a minute of staleness is fine for a capacity readout.
    staleTime: 60_000,
    queryFn: async (): Promise<{ usedBytes: number; quotaBytes: number; fraction: number }> => {
      const [used, quota] = await Promise.all([
        supabase.rpc("center_storage_bytes"),
        supabase.rpc("center_storage_quota_bytes"),
      ]);
      if (used.error) throw new Error(used.error.message);
      if (quota.error) throw new Error(quota.error.message);
      const usedBytes = Number(used.data ?? 0);
      const quotaBytes = Number(quota.data ?? 0);
      return {
        usedBytes,
        quotaBytes,
        fraction: quotaBytes > 0 ? Math.min(1, usedBytes / quotaBytes) : 0,
      };
    },
  });
}

/* ------------------------------ ENGAGEMENT ------------------------------ */

export interface ResourceEngagement {
  views: number;
  downloads: number;
  /** Distinct students who viewed, which is the number a teacher acts on. */
  distinctStudents: number;
  lastViewedAt: string | null;
}

export interface StudentEngagement {
  studentId: string;
  studentName: string | null;
  opened: boolean;
  views: number;
  lastViewedAt: string | null;
}

/**
 * How much attention one resource has had, and from whom.
 *
 * Reads the `resource_engagement` / `resource_student_engagement` views rather than
 * the raw log: a client-side count needs every event row, and the attendance module
 * already shipped a `.limit(2000)` that silently under-counted. Both views are staff
 * only, gated by `can_manage_group` inside the view, so this hook returns nothing at
 * all for a student instead of returning their own figures dressed as the class's.
 *
 * Fetched only while a panel is open -- `enabled` -- because a chapter of thirty
 * resources should not fire thirty aggregate queries to render a list.
 */
export function useResourceEngagement(resourceId: string | null | undefined) {
  return useQuery({
    queryKey: resourceKeys.engagement(resourceId ?? "none"),
    enabled: !!resourceId,
    queryFn: async (): Promise<{
      totals: ResourceEngagement;
      students: StudentEngagement[];
    }> => {
      const [agg, per] = await Promise.all([
        supabase
          .from("resource_engagement")
          .select("views, downloads, distinct_students, last_viewed_at")
          .eq("resource_id", resourceId as string)
          .maybeSingle(),
        supabase
          .from("resource_student_engagement")
          .select("student_id, opened, views, last_viewed_at")
          .eq("resource_id", resourceId as string),
      ]);
      if (agg.error) throw new Error(agg.error.message);
      if (per.error) throw new Error(per.error.message);

      // Names come from `profiles`, which a teacher may read for their own students
      // (`profiles read scoped`). Resolved separately rather than embedded, because
      // the view is not a table and carries no foreign key to follow.
      // A view's columns are all nullable to Postgres, even where a join guarantees
      // otherwise; narrow once here rather than at every use.
      const rows = (per.data ?? []).filter(
        (r): r is typeof r & { student_id: string } => typeof r.student_id === "string",
      );
      const ids = rows.map((r) => r.student_id);
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        for (const p of data ?? []) names.set(p.id, p.full_name);
      }

      return {
        totals: {
          views: Number(agg.data?.views ?? 0),
          downloads: Number(agg.data?.downloads ?? 0),
          distinctStudents: Number(agg.data?.distinct_students ?? 0),
          lastViewedAt: agg.data?.last_viewed_at ?? null,
        },
        students: rows
          .map((r) => ({
            studentId: r.student_id,
            studentName: names.get(r.student_id) ?? null,
            opened: r.opened ?? false,
            views: Number(r.views ?? 0),
            lastViewedAt: r.last_viewed_at ?? null,
          }))
          // Those who have not opened it first: that is the list worth acting on.
          .sort(
            (a, b) =>
              Number(a.opened) - Number(b.opened) ||
              (a.studentName ?? "").localeCompare(b.studentName ?? ""),
          ),
      };
    },
  });
}

/* ------------------------------ BULK ACTIONS ------------------------------ */

/**
 * Publish or hide many resources at once.
 *
 * One statement with `.in()`, not a loop: RLS filters the ids the caller may touch,
 * so a selection that reaches across into someone else's group updates only the
 * permitted rows and reports how many. A loop would half-succeed and report nothing.
 */
export function useBulkSetVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[]; isPublished: boolean }) => {
      if (input.ids.length === 0) return 0;
      const rows = must(
        await supabase
          .from("resources")
          .update({
            is_published: input.isPublished,
            ...(input.isPublished ? { published_at: null } : {}),
          })
          .in("id", input.ids)
          .select("id"),
      );
      return rows.length;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/**
 * Deletes many resources, and their stored objects.
 *
 * Rows first, objects second, and only the objects whose rows actually went: RLS may
 * have refused some, and removing a file whose row survived would leave a resource
 * pointing at nothing. The reverse order would orphan bytes in the bucket, which is
 * the cheaper mistake but still counts against the centre quota.
 */
export function useBulkDeleteResources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const deleted = must(
        await supabase.from("resources").delete().in("id", ids).select("id, storage_path"),
      );
      const paths = deleted
        .map((r) => r.storage_path)
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      if (paths.length > 0) {
        // Best effort: the rows are already gone, and a failure here is a quota
        // problem rather than a correctness one.
        await supabase.storage.from(RESOURCE_BUCKET).remove(paths);
      }
      return deleted.length;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/**
 * Moves many resources into one destination chapter.
 *
 * The destination is validated against the DATABASE, not against what the client
 * believes: the chapter is re-read to confirm it exists, is visible to the caller
 * and belongs to the group they named. Only then is `chapter_id` written -- and the
 * `resources_sync_group` trigger re-derives `group_id` from that chapter, so a
 * Group A + Chapter-of-B pairing cannot be persisted even if this check were wrong.
 */
export function useBulkMoveResources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[]; destination: ResourceDestination }) => {
      if (input.ids.length === 0) return 0;
      const { data: chapter, error: chapterError } = await supabase
        .from("chapters")
        .select("id, group_id")
        .eq("id", input.destination.chapterId)
        .maybeSingle();
      if (chapterError) throw new Error(chapterError.message);
      if (!chapter) throw new Error("Chapitre de destination introuvable.");
      if (chapter.group_id !== input.destination.groupId) {
        throw new Error("Ce chapitre n'appartient pas au groupe choisi.");
      }
      const rows = must(
        await supabase
          .from("resources")
          .update({ chapter_id: chapter.id })
          .in("id", input.ids)
          .select("id"),
      );
      return rows.length;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/**
 * Duplicates one resource into a chosen chapter.
 *
 * A stored file is COPIED inside the bucket, not re-uploaded: the bytes are already
 * there, and `storage.copy` is authorised by the destination folder through the same
 * policy an upload uses. Nothing about the storage layout reaches the caller -- the
 * new path is generated here.
 *
 * The copy starts HIDDEN and carries no history: `resource_events` are not copied, so
 * view and download counts start at zero. Inheriting another resource's analytics
 * would make the numbers lies.
 */
export function useDuplicateResource() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { id: string; destination: ResourceDestination }) => {
      const { data: found, error: foundError } = await supabase
        .from("resources")
        .select(RESOURCE_COLUMNS)
        .eq("id", input.id)
        .maybeSingle();
      if (foundError) throw new Error(foundError.message);
      if (!found) throw new Error("Ressource introuvable.");
      const source = found as unknown as RawResource;

      const { data: chapter, error: chapterError } = await supabase
        .from("chapters")
        .select("id, group_id")
        .eq("id", input.destination.chapterId)
        .maybeSingle();
      if (chapterError) throw new Error(chapterError.message);
      if (!chapter) throw new Error("Chapitre de destination introuvable.");
      if (chapter.group_id !== input.destination.groupId) {
        throw new Error("Ce chapitre n'appartient pas au groupe choisi.");
      }

      let storagePath = source.storage_path;
      if (source.kind === "file" && source.storage_path) {
        const name = source.storage_path.split("/").slice(2).join("/") || "fichier";
        const to = `${chapter.group_id}/${globalThis.crypto.randomUUID()}/${name}`;
        const { error } = await supabase.storage
          .from(RESOURCE_BUCKET)
          .copy(source.storage_path, to);
        if (error) throw new Error(error.message);
        storagePath = to;
      }

      const rows = must(
        await supabase
          .from("resources")
          .insert({
            chapter_id: chapter.id,
            group_id: "00000000-0000-0000-0000-000000000000",
            title: `${source.title} (copie)`,
            description: source.description,
            kind: source.kind as ResourceKind,
            storage_path: storagePath,
            url: source.url,
            mime_type: source.mime_type,
            size_bytes: source.size_bytes,
            role: source.role as ResourceRole,
            link_provider: source.link_provider,
            link_thumbnail_url: source.link_thumbnail_url,
            pinned: false,
            allow_download: source.allow_download,
            is_published: false,
            published_at: null,
            created_by: user?.id ?? null,
          })
          .select("id"),
      );
      return rows[0]?.id ?? null;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/**
 * Whether a file of this name already sits in this chapter.
 *
 * `file_name` is kept true by `resources_sync_file_meta`, so this is a column read
 * rather than a path parse. Used to offer Remplacer / Conserver les deux instead of
 * silently creating a second "TD3.pdf" that nobody can tell apart.
 */
export async function findDuplicateFileName(
  chapterId: string,
  fileName: string,
): Promise<{ id: string; title: string; storagePath: string | null } | null> {
  const rows = must(
    await supabase
      .from("resources")
      .select("id, title, storage_path")
      .eq("chapter_id", chapterId)
      .eq("file_name", fileName)
      .limit(1),
  );
  const row = rows[0];
  // The path comes back too: replacing means deleting the old object as well, and a
  // caller without it would leave bytes behind counting against the centre quota.
  return row ? { id: row.id, title: row.title, storagePath: row.storage_path } : null;
}

export function useReorderResources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      ordered: { id: string; position: number; chapterId?: string | undefined }[],
    ) => {
      for (const r of ordered) {
        must(
          await supabase
            .from("resources")
            .update({
              position: r.position,
              ...(r.chapterId ? { chapter_id: r.chapterId } : {}),
            })
            .eq("id", r.id)
            .select(),
        );
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}

/* -------------------------------- STORAGE -------------------------------- */

/**
 * Uploads a file and returns its storage path.
 *
 * The path is `<group_id>/<uuid>/<filename>`, which is what the bucket policies
 * authorise on -- they read the leading folder rather than joining back to
 * `resources`, since the row does not exist yet at upload time.
 *
 * The per-file limit and the centre quota are decided on the server first. The
 * bucket enforces its own size limit and cannot be bypassed, but it knows nothing
 * about a 5 GB centre total -- so that half has to be asked somewhere the browser
 * cannot edit, and asking before the bytes go over the wire is also the only way
 * to fail fast on a 200 MB file.
 */
/** Raised when the caller aborts. Distinguished so a cancel is not reported as a
 *  failure -- the teacher already knows what happened. */
export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadCancelledError";
  }
}

/**
 * Uploads a file and returns its storage path.
 *
 * The path is `<group_id>/<uuid>/<filename>`, which is what the bucket policies
 * authorise on -- they read the leading folder rather than joining back to
 * `resources`, since the row does not exist yet at upload time.
 *
 * The per-file limit and the centre quota are decided on the server first. The
 * bucket enforces its own size limit and cannot be bypassed, but it knows nothing
 * about a 5 GB centre total -- so that half has to be asked somewhere the browser
 * cannot edit, and asking before the bytes go over the wire is also the only way
 * to fail fast on a 200 MB file.
 *
 * USES XHR, NOT `storage.upload()`. The SDK wraps `fetch`, which reports nothing
 * until the request completes, so the old progress bar jumped to 5% and sat there
 * for the length of the upload before snapping to 100%. `XMLHttpRequest` is still
 * the only way a browser will tell you how many bytes have actually left, and it is
 * also what makes a real cancel possible: `abort()` stops the transfer instead of
 * merely abandoning a promise whose bytes keep flowing.
 *
 * The request carries the caller's JWT, so storage RLS applies exactly as before --
 * `course resources staff write` still decides, keyed on the leading folder.
 */
export async function uploadResourceFile(
  groupId: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  /**
   * Batch figures, when this file is one of several. The quota question is about the
   * TOTAL being added and the 250 MB question is about ONE file; asking both with the
   * same number would reject two legal 200 MB videos as one illegal 400 MB one.
   */
  batch?: { totalBytes: number; largestBytes: number },
): Promise<{ path: string; mimeType: string; size: number }> {
  const accessToken = await currentAccessToken();
  if (!accessToken) throw new Error("Session expirée.");
  if (signal?.aborted) throw new UploadCancelledError();
  await assertUploadAllowedFn({
    data: {
      accessToken,
      groupId,
      sizeBytes: batch?.totalBytes ?? file.size,
      largestFileBytes: batch?.largestBytes ?? file.size,
    },
  });

  const id = globalThis.crypto.randomUUID();
  // Keep the original name (students recognise "TD3-suites.pdf") but strip
  // anything that would break a path or a Content-Disposition header.
  const safeName = file.name.replace(/[^\w.\-À-ɏ ]+/g, "_").slice(-120);
  const path = `${groupId}/${id}/${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const { url, key } = supabaseRestConfig();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${url}/storage/v1/object/${RESOURCE_BUCKET}/${encodeURI(path)}`, true);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("cache-control", "3600");
    // Never overwrite: the path carries a fresh uuid, so a collision would mean
    // something is wrong rather than something needs replacing.
    xhr.setRequestHeader("x-upsert", "false");

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);
    const done = () => signal?.removeEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      // `lengthComputable` is false for a stream; fall back to the file size, which
      // we know, rather than reporting nothing.
      const total = e.lengthComputable ? e.total : file.size;
      if (total > 0) onProgress?.(Math.min(1, e.loaded / total));
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      // Storage answers with a JSON body; surface its message rather than a status.
      let message = `HTTP ${xhr.status}`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = body.message ?? body.error ?? message;
      } catch {
        /* not JSON: the status is all there is */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => {
      done();
      // No status and no body: the request never reached the server.
      reject(new Error("Le transfert a échoué. Vérifiez votre connexion."));
    };
    xhr.onabort = () => {
      done();
      reject(new UploadCancelledError());
    };
    xhr.send(file);
  });

  return { path, mimeType: contentType, size: file.size };
}

/**
 * A time-limited URL for a resource, issued by the server or not at all.
 *
 * Takes a resource ID rather than a storage path on purpose. Signing used to
 * happen here in the browser, which meant `allow_download` was enforced by hiding
 * a button: anyone who could read the row could ask Storage for an attachment URL,
 * because Storage cannot tell "preview this" from "save this" -- both need SELECT
 * on the same object. So the decision moved server-side, and the server needs the
 * row's identity to ask the database about it.
 *
 * `can_view_resource` / `can_download_resource` are the authority, evaluated as
 * the caller. Links are returned as-is; the bucket stays private, so a copied URL
 * still expires.
 */
export async function signResourceUrl(
  resourceId: string,
  intent: "view" | "download" = "view",
): Promise<string> {
  const accessToken = await currentAccessToken();
  if (!accessToken) throw new Error("Session expirée.");
  const { url } = await signResourceUrlFn({ data: { accessToken, resourceId, intent } });
  return url;
}

/* --------------------------------- EVENTS --------------------------------- */

/**
 * Records that a student viewed or downloaded a resource.
 *
 * APPEND-ONLY. This used to upsert on a unique (resource, student, kind), which
 * answered "has this student opened it?" but destroyed the history -- a second
 * view overwrote the first. `20260811100000` drops that constraint, so an upsert
 * here would now fail with 42P10 (no unique index matching ON CONFLICT) on every
 * single write; it has to be a plain insert.
 *
 * Failures are swallowed: progress tracking must never block a student from
 * reading their course material.
 */
export function useRecordResourceEvent() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { resourceId: string; kind?: ResourceEventKind | undefined }) => {
      if (!user?.id) return;
      await supabase.from("resource_events").insert({
        resource_id: input.resourceId,
        student_id: user.id,
        kind: input.kind ?? "view",
        occurred_at: new Date().toISOString(),
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: resourceKeys.root }),
  });
}
