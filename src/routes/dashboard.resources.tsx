import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useGroups } from "@/features/school/queries";
import { useSubjectLabel } from "@/features/school/subject-label";
import { subjectColor } from "@/features/school/session/subject-tint";
import { ChapterSection, type DragBinding } from "@/features/school/resources/chapter-section";
import { CourseIdentity } from "@/features/school/resources/course-identity";
import { ChapterDeleteDialog } from "@/features/school/resources/chapter-delete-dialog";
import { DestinationDialog } from "@/features/school/resources/destination-dialog";
import { EngagementPanel } from "@/features/school/resources/engagement-panel";
import { linkFaceOf } from "@/features/school/resources/link-provider";
import { useUploadQueue } from "@/features/school/resources/use-upload-queue";
import { supabase } from "@/integrations/supabase/client";
import { ResourceListView } from "@/features/school/resources/resource-list-view";
import {
  insertRelative,
  moveWithin,
  useDragReorder,
} from "@/features/school/resources/use-drag-reorder";
import {
  ChapterDialog,
  ResourceDialog,
  type GroupOption,
  type ResourceFormValue,
} from "@/features/school/resources/resource-dialogs";
import { ResourcePreview } from "@/features/school/resources/resource-preview";
import {
  findDuplicateFileName,
  RESOURCE_BUCKET,
  UploadCancelledError,
  signResourceUrl,
  statsFor,
  uploadResourceFile,
  useBulkDeleteResources,
  useBulkMoveResources,
  useBulkSetVisibility,
  useCourseResources,
  useDeleteChapter,
  useDeleteResource,
  useDuplicateChapter,
  useDuplicateResource,
  useReorderChapters,
  useReorderResources,
  useSaveChapter,
  useSaveResource,
  useSetChapterPinned,
  useSetChapterResourcesVisibility,
  useSetChapterVisibility,
  useSetResourcePinned,
  useSetResourceVisibility,
  useStorageQuota,
  resourceKeys,
} from "@/features/school/resources/queries";
import { formatBytes } from "@/features/school/resources/resource-icon";
import type {
  ChapterRow,
  ResourceDestination,
  ResourceRow,
} from "@/features/school/resources/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/resources")({
  head: () => ({
    meta: [
      { title: "Ressources pédagogiques — Gestion École" },
      {
        name: "description",
        content: "Partagez cours, exercices et corrigés avec vos élèves.",
      },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <ResourcesPage />
    </RequireAuth>
  ),
});

const ALL = "__all__";

/** One shared reference, so "no data yet" never looks like new data. */
const EMPTY_COURSES: never[] = [];

/**
 * Course resources, organised by chapter.
 *
 * The CHAPTER is the unit, not the file: a teacher thinks "Chapitre 3, les
 * suites", so this is a curriculum outline you can open, not a file manager.
 *
 * Subject colours come from `subjectColor`, the same helper the session calendar
 * uses, so a subject looks identical here and on Présences.
 */
function ResourcesPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const subjectLabel = useSubjectLabel();
  const { notifySuccess, notifyError } = useActionFeedback();
  const qc = useQueryClient();

  const [courseFilter, setCourseFilter] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"chapters" | "list">("chapters");
  const [hiddenOnly, setHiddenOnly] = useState(false);

  const [chapterDialog, setChapterDialog] = useState<{
    open: boolean;
    chapter?: ChapterRow | null;
  }>({ open: false });
  /** `groupId` travels with `chapterId` so the dialog can show the locked context
   *  without looking the chapter up in a list it no longer receives. */
  const [resourceDialog, setResourceDialog] = useState<{
    open: boolean;
    resource?: ResourceRow | null;
    chapterId?: string | undefined;
    groupId?: string | undefined;
  }>({ open: false });
  /** Chapter pending deletion: the dialog decides what happens to its resources. */
  const [deleting, setDeleting] = useState<ChapterRow | null>(null);
  /** A move or a duplicate awaiting a destination. `rows` is what it will act on. */
  const [destination, setDestination] = useState<{
    open: boolean;
    mode: "move" | "duplicate";
    rows: ResourceRow[];
  }>({ open: false, mode: "move", rows: [] });
  const [preview, setPreview] = useState<ResourceRow | null>(null);
  /** Which resource's engagement figures are open. Null closes the panel. */
  const [engagement, setEngagement] = useState<ResourceRow | null>(null);
  /** The group the current batch is uploading into, for retries after submit returns. */
  const [uploadGroupId, setUploadGroupId] = useState<string | null>(null);
  /**
   * The in-flight upload's abort handle, and the submission that produced it.
   *
   * Kept in a ref rather than state because `cancelUpload` must reach the CURRENT
   * controller, and a handler closing over state would abort a stale one -- the same
   * shape of bug the drag-and-drop `targetRef` documents.
   */
  const uploadAbort = useRef<AbortController | null>(null);
  /** The last submission that failed mid-upload, so it can be retried unchanged. */
  const [failedUpload, setFailedUpload] = useState<ResourceFormValue | null>(null);

  const coursesQuery = useCourseResources(courseFilter === ALL ? null : courseFilter);
  const groupsQuery = useGroups();
  const quota = useStorageQuota();
  /**
   * The upload queue. Owned here rather than globally, so closing the dialog can abort
   * everything still in flight -- a tray outliving the dialog would make "close" and
   * "stop" two different acts.
   */
  const uploads = useUploadQueue();

  const saveChapter = useSaveChapter();
  const deleteChapter = useDeleteChapter();
  const reorderChapters = useReorderChapters();
  const reorderResources = useReorderResources();
  const saveResource = useSaveResource();
  const deleteResource = useDeleteResource();
  const setVisibility = useSetResourceVisibility();
  const setChapterVisibility = useSetChapterVisibility();
  const setChapterPinned = useSetChapterPinned();
  const setChapterResources = useSetChapterResourcesVisibility();
  const duplicateChapter = useDuplicateChapter();
  const duplicateResource = useDuplicateResource();
  const setResourcePinned = useSetResourcePinned();
  const bulkVisibility = useBulkSetVisibility();
  const bulkMove = useBulkMoveResources();
  const bulkDelete = useBulkDeleteResources();

  /**
   * Groups the caller may file content into, with the subject and teacher the group
   * already carries. RLS is the real gate -- `can_manage_group` refuses a write
   * either way; narrowing here is so a teacher is never OFFERED a colleague's group
   * and then refused, which is how the flat selector used to mislead.
   *
   * `groups read` is staff-wide, so a teacher can see every group in the school.
   * That is deliberate elsewhere in the product; for filing resources it would be
   * a trap, hence the filter.
   */
  const myGroups = useMemo<GroupOption[]>(() => {
    const all = groupsQuery.data ?? [];
    const mine = user?.role === "teacher" ? all.filter((g) => g.teacherId === user.id) : all;
    return mine.map((g) => ({
      id: g.id,
      name: g.name,
      subjectKey: g.subjectKey,
      subjectName: subjectLabel(g.subjectKey, g.subjectName),
      levelName: g.levelName,
      teacherName: g.teacherName,
    }));
  }, [groupsQuery.data, user?.role, user?.id, subjectLabel]);

  /** The group the page is scoped to, or undefined for "all groups". */
  const selectedGroup = useMemo(
    () => (courseFilter === ALL ? undefined : myGroups.find((g) => g.id === courseFilter)),
    [courseFilter, myGroups],
  );

  /**
   * Memoised, not `?? []` inline.
   *
   * A bare `?? []` builds a NEW array on every render while the query is
   * pending, so the `useMemo`s below see a changed dependency and recompute
   * every time -- the same defect that caused the attendance render loop.
   */
  const courses = useMemo(() => coursesQuery.data ?? EMPTY_COURSES, [coursesQuery.data]);

  /** Search + visibility filter, applied to chapters AND their resources. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses
      .map((c) => ({
        ...c,
        chapters: c.chapters
          .map((ch) => {
            const chapterHit = !q || ch.title.toLowerCase().includes(q);
            const resources = ch.resources.filter((r) => {
              if (hiddenOnly && r.visibility === "published") return false;
              if (!q) return true;
              // A chapter that matches keeps all its resources -- the teacher
              // searched for the chapter, not for a file inside it.
              return chapterHit || r.title.toLowerCase().includes(q);
            });
            return { ...ch, resources };
          })
          .filter((ch) => {
            if (!q && !hiddenOnly) return true;
            return ch.resources.length > 0 || (!!q && ch.title.toLowerCase().includes(q));
          }),
      }))
      .filter((c) => c.chapters.length > 0);
  }, [courses, query, hiddenOnly]);

  const stats = useMemo(() => statsFor(courses), [courses]);

  /* ------------------------------ handlers ------------------------------ */

  const submitChapter = (v: {
    id?: string;
    groupId: string;
    title: string;
    description: string;
    pinned: boolean;
    isPublished: boolean;
    publishAt: string;
  }) => {
    saveChapter.mutate(
      {
        ...v,
        description: v.description,
        // A local `datetime-local` value is stored as an instant.
        publishedAt: v.publishAt ? new Date(v.publishAt).toISOString() : null,
      },
      {
        onSuccess: () => {
          notifySuccess("resources.chapter.saved");
          setChapterDialog({ open: false });
        },
        onError: notifyError,
      },
    );
  };

  /**
   * "+ Créer un nouveau chapitre" from inside the resource dialog.
   *
   * Creates it in the SELECTED group -- never a global chapter -- and resolves the
   * new id so the dialog can select it immediately. The page owns this because the
   * page owns the mutations; the dialog stays free of them.
   */
  const createChapterInline = async (groupId: string, title: string): Promise<string | null> => {
    try {
      const id = await saveChapter.mutateAsync({ groupId, title, description: "" });
      notifySuccess("resources.hier.chapterCreated");
      return id;
    } catch (e) {
      notifyError(e);
      return null;
    }
  };

  /**
   * Saves the dialog.
   *
   * A LINK, or a file being replaced on an existing resource, is one row and behaves
   * as before. Several files is a BATCH: one row per file, all in the chosen chapter,
   * sharing the role and visibility the teacher set once. Each row's title comes from
   * its own filename, because one shared title would be wrong for four of five files.
   *
   * The batch is deliberately not a transaction. A row per successful upload is the
   * useful outcome -- if the fourth of five files fails, the teacher wants the three
   * that worked to exist and the failed one to offer a retry, not to lose all of it.
   */
  const submitResource = async (v: ResourceFormValue) => {
    try {
      // ---- link, or an edit that changes no file: unchanged single-row path.
      if (v.kind === "link" || (v.id && v.files.length === 0)) {
        await saveOneResource(v, {
          storagePath: v.id ? undefined : null,
          mimeType: null,
          sizeBytes: null,
        });
        notifySuccess("resources.resource.saved");
        setResourceDialog({ open: false });
        uploads.clear();
        return;
      }

      if (!v.groupId) throw new Error(t("resources.hier.selectGroup"));
      // Remembered so a per-row retry, which happens after `submitResource` has
      // returned, still knows where the files were going.
      setUploadGroupId(v.groupId);

      // ---- replacing the file on an existing resource: still one row.
      if (v.id) {
        const only = v.files[0];
        if (!only) throw new Error(t("resources.dialog.fileRequired"));
        // Already seeded by the dialog when the file was chosen.
        const finished = await uploads.start(v.groupId);
        const ok = finished.find((f) => f.status === "done");
        if (!ok?.result) {
          const failure = finished.find((f) => f.status === "failed");
          if (failure) throw new Error(failure.error ?? t("resources.upload.failed"));
          // Everything was cancelled; the teacher already knows.
          notifySuccess("resources.upload.cancelled");
          return;
        }
        await saveOneResource(v, {
          storagePath: ok.result.path,
          mimeType: ok.result.mimeType,
          sizeBytes: ok.result.size,
        });
        notifySuccess("resources.resource.saved");
        setResourceDialog({ open: false });
        uploads.clear();
        return;
      }

      // ---- the batch.
      const finished = await uploads.start(v.groupId);
      const succeeded = finished.filter((f) => f.status === "done" && f.result);

      let created = 0;
      for (const item of succeeded) {
        const result = item.result;
        if (!result) continue;
        try {
          await saveOneResource(
            {
              ...v,
              // Single file keeps whatever the teacher typed; a batch names each row
              // from its own file.
              title:
                v.files.length === 1 && v.title.trim() ? v.title : stripExtension(item.file.name),
            },
            { storagePath: result.path, mimeType: result.mimeType, sizeBytes: result.size },
          );
          created += 1;
        } catch (e) {
          // The bytes are already in the bucket and no row points at them. Remove the
          // object rather than leave it counting against the centre quota forever.
          await removeOrphanObject(result.path);
          notifyError(e);
        }
      }

      const failed = finished.filter((f) => f.status === "failed").length;
      const cancelled = finished.filter((f) => f.status === "cancelled").length;

      if (created > 0) {
        notifySuccess(created === 1 ? "resources.resource.saved" : "resources.upload.batchSaved", {
          count: created,
        });
      }
      // The dialog stays OPEN while anything still needs attention, so the retry
      // buttons are reachable. Closing on partial success would hide the failures.
      // Nothing created and something cancelled: say so. The row said "annulé", but
      // the dialog then closes and clears, so without this a cancelled upload gave no
      // feedback at all.
      if (created === 0 && cancelled > 0 && failed === 0) {
        notifySuccess("resources.upload.cancelled");
      }
      if (failed === 0) {
        setResourceDialog({ open: false });
        uploads.clear();
      } else if (created === 0 && cancelled === 0) {
        notifyError(new Error(t("resources.upload.failed")));
      }
    } catch (e) {
      if (e instanceof UploadCancelledError) {
        notifySuccess("resources.upload.cancelled");
        return;
      }
      notifyError(e);
    }
  };

  /**
   * Deletes an object whose row could not be created.
   *
   * Storage RLS decides: the path's leading folder is the group, and only a manager of
   * it may remove anything -- which is exactly who just uploaded.
   */
  const removeOrphanObject = async (path: string) => {
    await supabase.storage.from(RESOURCE_BUCKET).remove([path]);
  };

  /** The filename without its extension -- what a teacher would have typed. */
  const stripExtension = (name: string) => name.replace(/\.[^.]+$/, "");

  /** One row. Shared by every path above so the field mapping exists once. */
  const saveOneResource = async (
    v: ResourceFormValue,
    file: {
      storagePath: string | null | undefined;
      mimeType: string | null;
      sizeBytes: number | null;
    },
  ) => {
    await saveResource.mutateAsync({
      ...(v.id ? { id: v.id } : {}),
      chapterId: v.chapterId,
      title: v.title,
      description: v.description,
      kind: v.kind,
      ...(v.kind === "file"
        ? {
            storagePath: file.storagePath ?? resourceDialog.resource?.storagePath ?? null,
            mimeType: file.mimeType ?? resourceDialog.resource?.mimeType ?? null,
            sizeBytes: file.sizeBytes ?? resourceDialog.resource?.sizeBytes ?? null,
          }
        : { url: v.url }),
      role: v.role,
      pinned: v.pinned,
      allowDownload: v.allowDownload,
      isPublished: v.isPublished,
      // A local `datetime-local` value is stored as an instant.
      publishedAt: v.publishAt ? new Date(v.publishAt).toISOString() : null,
    });
  };

  /**
   * Chapter actions. Each one is a single mutation with the standard feedback pair;
   * RLS refuses anything the caller does not manage, so there is no permission
   * branching here -- an unauthorised attempt surfaces as an error, not as a
   * silently ignored click.
   */
  const confirmDeleteChapter = (chapter: ChapterRow, resources: "cascade" | "unfile") => {
    deleteChapter.mutate(
      { id: chapter.id, groupId: chapter.groupId, resources },
      {
        onSuccess: () => {
          notifySuccess(
            resources === "unfile" ? "resources.chapter.deletedKept" : "resources.chapter.deleted",
          );
          setDeleting(null);
        },
        onError: notifyError,
      },
    );
  };

  const toggleChapterVisibility = (chapter: ChapterRow, isPublished: boolean) => {
    setChapterVisibility.mutate(
      // Publishing clears a pending schedule; the teacher meant now.
      { id: chapter.id, isPublished, ...(isPublished ? { publishedAt: null } : {}) },
      {
        onSuccess: () =>
          notifySuccess(isPublished ? "resources.chapter.published" : "resources.chapter.hidden"),
        onError: notifyError,
      },
    );
  };

  const toggleChapterPinned = (chapter: ChapterRow, pinned: boolean) => {
    setChapterPinned.mutate(
      { id: chapter.id, pinned },
      {
        onSuccess: () =>
          notifySuccess(pinned ? "resources.chapter.pinned" : "resources.chapter.unpinned"),
        onError: notifyError,
      },
    );
  };

  const publishAll = (chapter: ChapterRow, isPublished: boolean) => {
    setChapterResources.mutate(
      { chapterId: chapter.id, isPublished },
      {
        onSuccess: () =>
          notifySuccess(isPublished ? "resources.bulk.published" : "resources.bulk.hidden"),
        onError: notifyError,
      },
    );
  };

  const copyChapter = (chapter: ChapterRow) => {
    duplicateChapter.mutate(
      { id: chapter.id },
      {
        onSuccess: () => notifySuccess("resources.chapter.duplicated"),
        onError: notifyError,
      },
    );
  };

  const toggleResourcePinned = (r: ResourceRow, pinned: boolean) => {
    setResourcePinned.mutate(
      { id: r.id, pinned },
      {
        onSuccess: () =>
          notifySuccess(pinned ? "resources.chapter.pinned" : "resources.chapter.unpinned"),
        onError: notifyError,
      },
    );
  };

  /* ------------------------------ bulk ------------------------------ */

  const runBulkVisibility = (ids: string[], isPublished: boolean) => {
    bulkVisibility.mutate(
      { ids, isPublished },
      {
        onSuccess: () =>
          notifySuccess(isPublished ? "resources.bulk.published" : "resources.bulk.hidden"),
        onError: notifyError,
      },
    );
  };

  const runBulkDelete = (rows: ResourceRow[]) => {
    if (!globalThis.confirm(t("resources.bulk.deleteConfirm", { count: rows.length }))) return;
    bulkDelete.mutate(
      rows.map((r) => r.id),
      {
        onSuccess: () => notifySuccess("resources.bulk.deleted"),
        onError: notifyError,
      },
    );
  };

  const confirmDestination = (dest: ResourceDestination) => {
    const rows = destination.rows;
    if (destination.mode === "duplicate") {
      const first = rows[0];
      if (!first) return;
      duplicateResource.mutate(
        { id: first.id, destination: dest },
        {
          onSuccess: () => {
            notifySuccess("resources.resource.duplicated");
            setDestination((d) => ({ ...d, open: false }));
          },
          onError: notifyError,
        },
      );
      return;
    }
    bulkMove.mutate(
      { ids: rows.map((r) => r.id), destination: dest },
      {
        onSuccess: () => {
          notifySuccess("resources.bulk.moved");
          setDestination((d) => ({ ...d, open: false }));
        },
        onError: notifyError,
      },
    );
  };

  const removeResource = (r: ResourceRow) => {
    if (!globalThis.confirm(t("resources.resource.deleteConfirm", { title: r.title }))) return;
    deleteResource.mutate(
      { id: r.id, storagePath: r.storagePath },
      {
        onSuccess: () => notifySuccess("resources.resource.deleted"),
        onError: notifyError,
      },
    );
  };

  /** Signed URL per click: the bucket is private, so a copied link expires. */
  const openResource = async (r: ResourceRow) => {
    // Same rule as the student page: anything with an embeddable form is previewed in
    // place. A teacher checking what they just posted should not be thrown to
    // youtube.com either -- and it is the only way to see what the student will see.
    if (r.kind === "link" && r.url && !linkFaceOf(r.url).embedUrl) {
      globalThis.open(r.url, "_blank", "noopener,noreferrer");
      return;
    }
    setPreview(r);
  };

  const downloadResource = async (r: ResourceRow) => {
    try {
      if (r.kind === "link" && r.url) {
        globalThis.open(r.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (!r.storagePath) return;
      const url = await signResourceUrl(r.id, "download");
      globalThis.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      notifyError(e);
    }
  };

  /**
   * The locked destination, MEMOISED.
   *
   * As an inline object literal this was a new reference on every render, and the
   * dialog's reset effect depends on it -- so every render wiped the dialog's chosen
   * files. The queue publishing progress caused those renders, which made the bug
   * appear only once files had been selected: pick two files, press save, and the
   * dialog insisted a title was required because it believed nothing was selected.
   */
  const dialogContext = useMemo(
    () =>
      resourceDialog.chapterId && resourceDialog.groupId
        ? { groupId: resourceDialog.groupId, chapterId: resourceDialog.chapterId }
        : undefined,
    [resourceDialog.chapterId, resourceDialog.groupId],
  );

  /**
   * The dialog's view of the queue. Memoised because an inline object would be a new
   * reference on every progress tick, re-rendering the dialog dozens of times a second
   * during an upload.
   */
  const uploadBinding = useMemo(
    () => ({
      items: uploads.items,
      onCancel: uploads.cancel,
      onCancelAll: uploads.cancelAll,
      onRetry: (id: string) => {
        const groupId = resourceDialog.groupId ?? uploadGroupId;
        if (groupId) void uploads.retry(id, groupId);
      },
      onRemove: uploads.remove,
      onFilesChange: uploads.setFiles,
      busy: uploads.busy,
    }),
    [uploads, resourceDialog.groupId, uploadGroupId],
  );

  /** Cache key the optimistic patches target. */
  const cacheKey = resourceKeys.byGroup(courseFilter === ALL ? null : courseFilter);

  /**
   * Chapter drop: reorder within the owning course, optimistically.
   *
   * Cross-COURSE chapter moves are refused -- a chapter belongs to one group, and
   * reparenting it would silently move its resources to another class.
   */
  const onChapterDrop = ({
    activeId,
    overId,
    edge,
  }: {
    activeId: string;
    overId: string | null;
    edge: "before" | "after";
  }) => {
    if (!overId) return;
    const course = courses.find((c) => c.chapters.some((ch) => ch.id === activeId));
    if (!course || !course.chapters.some((ch) => ch.id === overId)) return;
    const ids = course.chapters.map((ch) => ch.id);
    const next = moveWithin(ids, activeId, overId, edge);
    if (next === ids) return;

    const previous = qc.getQueryData(cacheKey);
    qc.setQueryData(cacheKey, (old: typeof courses | undefined) =>
      (old ?? []).map((c) =>
        c.groupId === course.groupId
          ? {
              ...c,
              chapters: next
                .map((id) => c.chapters.find((ch) => ch.id === id))
                .filter((ch): ch is (typeof c.chapters)[number] => !!ch)
                .map((ch, i) => ({ ...ch, position: i })),
            }
          : c,
      ),
    );
    reorderChapters.mutate(
      next.map((id, i) => ({ id, position: i })),
      {
        onError: (e) => {
          qc.setQueryData(cacheKey, previous);
          notifyError(e);
        },
      },
    );
  };

  /**
   * Resource drop: reorder within a chapter, or move to another one.
   *
   * `overContainerId` carries the destination chapter, which is what makes a
   * cross-chapter move work when the target is an empty chapter body with no
   * sibling row to anchor against.
   */
  const onResourceDrop = ({
    activeId,
    overId,
    edge,
    overContainerId,
  }: {
    activeId: string;
    overId: string | null;
    edge: "before" | "after";
    overContainerId: string | null;
  }) => {
    const allChapters = courses.flatMap((c) => c.chapters);
    const from = allChapters.find((ch) => ch.resources.some((r) => r.id === activeId));
    if (!from) return;
    const to = allChapters.find((ch) => ch.id === (overContainerId ?? from.id));
    if (!to) return;
    const sameChapter = from.id === to.id;
    const currentIds = from.resources.map((r) => r.id);
    const targetIds = sameChapter
      ? moveWithin(currentIds, activeId, overId ?? "", edge)
      : insertRelative(
          to.resources.map((r) => r.id),
          activeId,
          overId,
          edge,
        );
    if (sameChapter && targetIds === currentIds) return;

    const moved = from.resources.find((r) => r.id === activeId);
    if (!moved) return;
    const previous = qc.getQueryData(cacheKey);
    qc.setQueryData(cacheKey, (old: typeof courses | undefined) =>
      (old ?? []).map((c) => ({
        ...c,
        chapters: c.chapters.map((ch) => {
          if (ch.id === to.id) {
            const pool = sameChapter
              ? ch.resources
              : [...ch.resources, { ...moved, chapterId: to.id }];
            return {
              ...ch,
              resources: targetIds
                .map((id) => pool.find((r) => r.id === id))
                .filter((r): r is (typeof pool)[number] => !!r)
                .map((r, i) => ({ ...r, position: i, chapterId: to.id })),
            };
          }
          if (!sameChapter && ch.id === from.id) {
            return { ...ch, resources: ch.resources.filter((r) => r.id !== activeId) };
          }
          return ch;
        }),
      })),
    );
    reorderResources.mutate(
      targetIds.map((id, i) => ({
        id,
        position: i,
        ...(id === activeId && !sameChapter ? { chapterId: to.id } : {}),
      })),
      {
        onError: (e) => {
          qc.setQueryData(cacheKey, previous);
          notifyError(e);
        },
      },
    );
  };

  const chapterDrag = useDragReorder(onChapterDrop);
  const resourceDrag = useDragReorder(onResourceDrop);

  /** One binding for every ChapterSection, so a drag can span chapters. */
  const dragBinding: DragBinding = {
    chapterProps: (id) => ({
      draggable: true,
      onDragStart: chapterDrag.handleDragStart(id),
      onDragOver: chapterDrag.handleDragOver(id, null),
      onDrop: chapterDrag.handleDrop,
      onDragEnd: chapterDrag.handleDragEnd,
    }),
    resourceProps: (id, chapterId) => ({
      draggable: true,
      onDragStart: resourceDrag.handleDragStart(id),
      onDragOver: resourceDrag.handleDragOver(id, chapterId),
      onDrop: resourceDrag.handleDrop,
      onDragEnd: resourceDrag.handleDragEnd,
    }),
    bodyProps: (chapterId) => ({
      onDragOver: resourceDrag.handleContainerDragOver(chapterId),
      onDrop: resourceDrag.handleDrop,
    }),
    isChapterDragging: chapterDrag.isDragging,
    isResourceDragging: resourceDrag.isDragging,
    chapterIndicator: chapterDrag.indicator,
    resourceIndicator: resourceDrag.indicator,
  };

  const moveChapter = (chapterId: string, direction: -1 | 1) => {
    const course = courses.find((c) => c.chapters.some((ch) => ch.id === chapterId));
    if (!course) return;
    const list = [...course.chapters];
    const i = list.findIndex((ch) => ch.id === chapterId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j] as ChapterRow, list[i] as ChapterRow];
    reorderChapters.mutate(
      list.map((ch, idx) => ({ id: ch.id, position: idx })),
      { onError: notifyError },
    );
  };

  /* -------------------------------- render -------------------------------- */

  const header = (
    <PageHeader
      title={t("resources.title")}
      description={t("resources.description")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={myGroups.length === 0}
            onClick={() => setChapterDialog({ open: true })}
          >
            <Plus className="size-4" aria-hidden />
            {t("resources.newChapter")}
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            disabled={stats.chapters === 0}
            onClick={() => {
              uploads.clear();
              setResourceDialog({ open: true });
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t("resources.addResource")}
          </Button>
        </div>
      }
    />
  );

  if (coursesQuery.isLoading) {
    return (
      <>
        {header}
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (coursesQuery.error) {
    return (
      <>
        {header}
        <ErrorState
          error={coursesQuery.error}
          onRetry={() => void coursesQuery.refetch()}
          isRetrying={coursesQuery.isFetching}
        />
      </>
    );
  }

  return (
    <>
      {header}

      {/* Selected-group context. Stays on screen while the chapters below are
          browsed, so the answer to "whose course is this?" never scrolls away.
          "Tous les groupes" keeps the existing multi-course view untouched. */}
      {selectedGroup && (
        <div className="surface-card px-4 py-3">
          <CourseIdentity
            groupName={selectedGroup.name}
            subjectName={selectedGroup.subjectName}
            teacherName={selectedGroup.teacherName}
            levelName={selectedGroup.levelName}
            accent={subjectColor(null, selectedGroup.subjectKey)}
          />
        </div>
      )}

      {/* Stats: the same "value above a quiet label" pattern as the attendance
          counters, so the two pages read as one product. */}
      {stats.chapters > 0 && (
        <dl className="surface-card flex flex-wrap items-stretch gap-x-5 gap-y-3 px-4 py-3">
          <Stat value={stats.chapters} label={t("resources.stat.chapters")} />
          <Stat value={stats.resources} label={t("resources.stat.resources")} />
          <Stat value={stats.published} label={t("resources.stat.published")} tone="success" />
          <Stat value={stats.hidden} label={t("resources.stat.hidden")} tone="muted" />
          <div className="min-w-40 border-s border-border ps-5">
            {/* The MEASURED centre total against the real limit, not a sum of the rows
                on screen -- that old number shrank whenever a filter was applied.
                Bidi-isolated: "35 MB / 5 GB" is direction-neutral and RTL reordered
                it, the same fault as the calendar's time ranges. */}
            <dd className="text-lg font-semibold tabular-nums">
              <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                {quota.data
                  ? `${formatBytes(quota.data.usedBytes, locale) ?? "0 B"} / ${formatBytes(quota.data.quotaBytes, locale)}`
                  : (formatBytes(stats.storageBytes, locale) ?? "0 B")}
              </span>
            </dd>
            <dt className="text-[11px] text-muted-foreground">{t("resources.stat.storage")}</dt>
            {quota.data && (
              <Progress
                value={Math.round(quota.data.fraction * 100)}
                className={cn("mt-1.5 h-1", quota.data.fraction > 0.9 && "[&>div]:bg-destructive")}
              />
            )}
          </div>
        </dl>
      )}

      {/* Toolbar mirrors the attendance control bar: one bordered row. */}
      <div className="surface-card flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3 py-2.5">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground start-3"
            aria-hidden
          />
          <Input
            className="h-9 rounded-lg ps-9 text-sm"
            placeholder={t("resources.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="h-9 w-auto min-w-40 max-w-56 rounded-lg text-xs">
            <SelectValue placeholder={t("resources.hier.allGroups")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("resources.hier.allGroups")}</SelectItem>
            {myGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant={hiddenOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={hiddenOnly}
          className="h-9 rounded-lg text-xs"
          onClick={() => setHiddenOnly((v) => !v)}
        >
          {t("resources.onlyHidden")}
        </Button>

        <div className="flex rounded-lg bg-muted p-0.5">
          {(["chapters", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                // min-h-9 on the control itself: measured at 375px this pair was
                // 24px tall, well under the 44px guidance and under any defensible
                // floor. The visual size is unchanged on desktop, where the row is
                // already taller than the text.
                "focus-ring flex min-h-9 items-center rounded-[0.35rem] px-3 text-xs font-medium transition-colors",
                view === v
                  ? "bg-card text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(v === "chapters" ? "resources.viewChapters" : "resources.viewList")}
            </button>
          ))}
        </div>
      </div>

      {myGroups.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={t("resources.empty.noGroups")}
          description={t("resources.empty.noGroupsDescription")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={query || hiddenOnly ? Search : FolderOpen}
          title={query || hiddenOnly ? t("resources.empty.search") : t("resources.empty.title")}
          description={
            query || hiddenOnly
              ? t("resources.empty.searchDescription")
              : t("resources.empty.description")
          }
          action={
            !query && !hiddenOnly ? (
              <Button
                type="button"
                className="mt-1 rounded-xl"
                onClick={() => setChapterDialog({ open: true })}
              >
                <Plus className="size-4" aria-hidden />
                {t("resources.newChapter")}
              </Button>
            ) : undefined
          }
        />
      ) : view === "list" ? (
        <ResourceListView
          courses={filtered}
          canEdit
          onEdit={(resource) =>
            setResourceDialog({
              open: true,
              resource,
              chapterId: resource.chapterId,
              groupId: resource.groupId,
            })
          }
          onDelete={removeResource}
          onToggleVisibility={(r) =>
            setVisibility.mutate(
              { id: r.id, isPublished: !r.isPublished },
              { onError: notifyError },
            )
          }
          onOpen={openResource}
          onDownload={downloadResource}
          onSetPinned={toggleResourcePinned}
          onDuplicate={(resource) =>
            setDestination({ open: true, mode: "duplicate", rows: [resource] })
          }
          onBulkVisibility={runBulkVisibility}
          onBulkMove={(rows) => setDestination({ open: true, mode: "move", rows })}
          onBulkDelete={runBulkDelete}
        />
      ) : (
        <div className="space-y-5">
          {filtered.map((course) => {
            const accent = subjectColor(course.subjectColor, course.subjectKey);
            return (
              <div key={course.groupId} className="space-y-2">
                {/* Course identity, always shown now -- not only when several are on
                    screen. "Which course am I filing into?" is the question this
                    phase exists to answer, and a single-course view needs it most. */}
                <CourseIdentity
                  className="px-1"
                  groupName={course.groupName}
                  subjectName={subjectLabel(course.subjectKey, course.subjectName)}
                  teacherName={course.teacherName}
                  levelName={course.levelName}
                  accent={accent}
                  trailing={
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {course.chapters.length} {t("resources.stat.chapters")}
                      {" · "}
                      {course.resourceCount} {t("resources.stat.resources")}
                    </span>
                  }
                />
                <div className="space-y-2.5">
                  {course.chapters.map((ch) => (
                    <ChapterSection
                      key={ch.id}
                      chapter={ch}
                      accent={accent}
                      canEdit
                      // Open by default: a collapsed outline hides the very thing
                      // the teacher came for. "Liste" flattens instead.
                      defaultOpen
                      query={query}
                      onAddResource={(chapterId) => {
                        uploads.clear();
                        setResourceDialog({ open: true, chapterId, groupId: course.groupId });
                      }}
                      onEditChapter={(chapter) => setChapterDialog({ open: true, chapter })}
                      onDeleteChapter={setDeleting}
                      onSetChapterVisibility={toggleChapterVisibility}
                      onSetChapterPinned={toggleChapterPinned}
                      onPublishAll={publishAll}
                      onDuplicateChapter={copyChapter}
                      onSetResourcePinned={toggleResourcePinned}
                      onShowEngagement={setEngagement}
                      onDuplicateResource={(resource) =>
                        setDestination({ open: true, mode: "duplicate", rows: [resource] })
                      }
                      onEditResource={(resource) =>
                        setResourceDialog({
                          open: true,
                          resource,
                          chapterId: resource.chapterId,
                          groupId: resource.groupId,
                        })
                      }
                      onDeleteResource={removeResource}
                      onToggleVisibility={(r) =>
                        setVisibility.mutate(
                          { id: r.id, isPublished: !r.isPublished },
                          { onError: notifyError },
                        )
                      }
                      onOpenResource={openResource}
                      onDownloadResource={downloadResource}
                      onMove={moveChapter}
                      drag={dragBinding}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ChapterDialog
        open={chapterDialog.open}
        onOpenChange={(v) => setChapterDialog({ open: v })}
        chapter={chapterDialog.chapter}
        groups={myGroups}
        {...(courseFilter !== ALL ? { defaultGroupId: courseFilter } : {})}
        onSubmit={submitChapter}
        isPending={saveChapter.isPending}
      />

      <ResourceDialog
        open={resourceDialog.open}
        onOpenChange={(v) => setResourceDialog({ open: v })}
        resource={resourceDialog.resource}
        groups={myGroups}
        {...(dialogContext ? { context: dialogContext } : {})}
        onCreateChapter={createChapterInline}
        onSubmit={submitResource}
        isPending={saveResource.isPending || uploads.busy}
        uploads={uploadBinding}
      />

      <ChapterDeleteDialog
        chapter={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDeleteChapter}
        isPending={deleteChapter.isPending}
      />

      <DestinationDialog
        open={destination.open}
        mode={destination.mode}
        count={destination.rows.length}
        groups={myGroups}
        {...(destination.rows[0]?.groupId ? { defaultGroupId: destination.rows[0].groupId } : {})}
        {...(destination.rows[0]?.chapterId
          ? { excludeChapterId: destination.rows[0].chapterId }
          : {})}
        onOpenChange={(v) => setDestination((d) => ({ ...d, open: v }))}
        onConfirm={confirmDestination}
        isPending={bulkMove.isPending || duplicateResource.isPending}
      />

      <EngagementPanel resource={engagement} onClose={() => setEngagement(null)} />

      <ResourcePreview resource={preview} onClose={() => setPreview(null)} canDownload />
    </>
  );
}

function Stat({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?: "neutral" | "success" | "muted";
}) {
  return (
    <div className="border-s border-border ps-5 first:border-s-0 first:ps-0">
      <dd
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "success" && value > 0 && "text-success",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </dd>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
    </div>
  );
}
