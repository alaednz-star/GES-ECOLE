/**
 * Create/edit dialogs for chapters and resources.
 *
 * Uses the existing `Dialog` primitive and the same field patterns as the admin
 * forms, so this reads as the same application rather than a bolted-on module.
 */

import { useEffect, useMemo, useState } from "react";
import { FolderTree, Loader2, Paperclip, Plus, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { formatBytes } from "./resource-icon";
import { UploadList } from "./upload-list";
import type { UploadItem } from "./use-upload-queue";
import { roleOptions } from "./resource-role";
import { useChaptersByGroup } from "./queries";
import type { ChapterRow, ResourceKind, ResourceRole, ResourceRow } from "./types";

/**
 * A group as the dialogs need it: the group plus everything DERIVED from it.
 *
 * Subject and teacher are read-only context, never inputs. `groups.subject_id` and
 * `groups.teacher_id` are the single source of truth, so offering them as separate
 * fields here would invent a second one that could disagree.
 */
export interface GroupOption {
  id: string;
  name: string;
  subjectKey: string | null;
  subjectName: string | null;
  levelName: string | null;
  teacherName: string | null;
}

/** One line of the hierarchy: a small caps label over its value. */
function ContextLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

/**
 * The locked hierarchy, shown when the dialog was opened from inside a chapter.
 *
 * Reading "Ajout dans / 3AS Sciences / Physique / Chapitre 1" is the whole point of
 * the phase: the destination is stated rather than chosen, so there is nothing to
 * get wrong. The chapter travels as `chapter_id`, which the database then uses to
 * derive `group_id` itself.
 */
function AddingToPanel({
  group,
  chapterTitle,
}: {
  group: GroupOption | undefined;
  chapterTitle: string | null;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-xl border border-border bg-muted/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-secondary-foreground">
        <FolderTree className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {t("resources.hier.addingTo")}
      </p>
      <dl className="space-y-2">
        <ContextLine label={t("resources.hier.group")} value={group?.name ?? "\u2014"} />
        <ContextLine
          label={t("resources.hier.subject")}
          value={group?.subjectName ?? t("resources.hier.noSubject")}
        />
        <ContextLine label={t("resources.hier.chapter")} value={chapterTitle ?? "\u2014"} />
      </dl>
    </section>
  );
}

/** Mirrors the bucket's `file_size_limit` and `MAX_FILE_BYTES` in
 *  `storage.server.ts`. Checked here only to fail fast with a readable message --
 *  the bucket and the server function are what actually enforce it. */
const MAX_BYTES = 250 * 1024 * 1024;

/* ------------------------------- CHAPTER ------------------------------- */

/**
 * A chapter always belongs to exactly one group, so the group is the first field
 * and the subject is shown beside it -- derived, not chosen. Preselected when the
 * page is already scoped to a group, so the common path is one fewer decision.
 */
export function ChapterDialog({
  open,
  onOpenChange,
  chapter,
  groups,
  defaultGroupId,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Present when editing. */
  chapter?: ChapterRow | null | undefined;
  groups: GroupOption[];
  defaultGroupId?: string | undefined;
  onSubmit: (v: {
    id?: string;
    groupId: string;
    title: string;
    description: string;
    pinned: boolean;
    isPublished: boolean;
    /** `datetime-local` string, or "" for immediate. */
    publishAt: string;
  }) => void;
  isPending: boolean;
}) {
  const { t } = useI18n();
  const [groupId, setGroupId] = useState(defaultGroupId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pinned, setPinned] = useState(false);
  const [isPublished, setPublished] = useState(true);
  const [publishAt, setPublishAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);

  // Reset per opening: a dialog reused across two chapters must not keep the
  // previous one's text.
  useEffect(() => {
    if (!open) return;
    setGroupId(
      chapter?.groupId ?? defaultGroupId ?? (groups.length === 1 ? (groups[0]?.id ?? "") : ""),
    );
    setTitle(chapter?.title ?? "");
    setDescription(chapter?.description ?? "");
    setPinned(chapter?.pinned ?? false);
    // A NEW chapter defaults to published: a teacher creating one is arranging
    // material they intend to share. Editing keeps whatever it already was.
    setPublished(chapter?.isPublished ?? true);
    setPublishAt(chapter?.publishedAt ? chapter.publishedAt.slice(0, 16) : "");
    setError(null);
  }, [open, chapter, defaultGroupId, groups]);

  const submit = () => {
    if (!groupId) return setError(t("resources.hier.selectGroup"));
    if (!title.trim()) return setError(t("resources.dialog.titleRequired"));
    onSubmit({
      ...(chapter ? { id: chapter.id } : {}),
      groupId,
      title,
      description,
      pinned,
      isPublished,
      publishAt,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {chapter
              ? t("resources.dialog.editChapterTitle")
              : t("resources.dialog.newChapterTitle")}
          </DialogTitle>
          <DialogDescription>{t("resources.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="chapter-group" className="text-xs font-semibold">
                {t("resources.hier.group")}
              </Label>
              {chapter ? (
                // Editing: the group is fixed. Reparenting a chapter would take its
                // resources with it into another course.
                <p className="truncate text-sm font-medium">{group?.name ?? "\u2014"}</p>
              ) : (
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger id="chapter-group" className="h-11 w-full rounded-xl bg-card">
                    <SelectValue placeholder={t("resources.hier.selectGroup")} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t("resources.hier.subject")}</Label>
              <p className="truncate text-sm font-medium text-secondary-foreground">
                {groupId
                  ? (group?.subjectName ?? t("resources.hier.noSubject"))
                  : t("resources.hier.noGroupSelected")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chapter-title">{t("resources.dialog.chapterName")}</Label>
            <Input
              id="chapter-title"
              className="h-11 rounded-xl"
              value={title}
              maxLength={160}
              placeholder={t("resources.dialog.chapterNamePlaceholder")}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="chapter-desc">{t("resources.dialog.chapterDescription")}</Label>
            <Textarea
              id="chapter-desc"
              className="min-h-20 rounded-xl"
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-3 rounded-xl border border-border p-3">
            <ToggleRow
              id="chapter-pinned"
              label={t("resources.chapter.pin")}
              checked={pinned}
              onChange={setPinned}
            />
            <ToggleRow
              id="chapter-published"
              label={t("resources.dialog.publishNow")}
              checked={isPublished}
              onChange={setPublished}
            />
            {isPublished && (
              <div className="space-y-1.5">
                <Label htmlFor="chapter-when" className="text-xs text-muted-foreground">
                  {t("resources.dialog.scheduleFor")}
                </Label>
                <Input
                  id="chapter-when"
                  type="datetime-local"
                  className="h-10 rounded-xl"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                />
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            {t("resources.dialog.cancel")}
          </Button>
          <Button type="button" className="rounded-xl" onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("resources.dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- RESOURCE ------------------------------- */

export interface ResourceFormValue {
  id?: string | undefined;
  chapterId: string;
  /** The chapter's group. Carried so the upload path does not have to rediscover it
   *  from a chapter list the dialog no longer receives. `chapter_id` remains the
   *  authoritative relationship; this is only for choosing the storage folder. */
  groupId: string;
  title: string;
  description: string;
  kind: ResourceKind;
  url: string;
  /**
   * Every chosen file. One entry is the ordinary case; several means the teacher is
   * filing a batch into one chapter, and the page creates a row per file.
   */
  files: File[];
  role: ResourceRole;
  pinned: boolean;
  allowDownload: boolean;
  isPublished: boolean;
  /** `datetime-local` string, or "" for immediate. */
  publishAt: string;
}

/**
 * One dialog, two modes -- deliberately not two components.
 *
 * From inside a chapter (`context` given) the hierarchy is LOCKED and displayed:
 * the teacher already said where this goes by clicking there. From the global
 * button it is a GROUP -> CHAPTER cascade, because nothing has been said yet.
 * Editing sits between the two: the group is fixed, the chapter can move within it.
 *
 * The old flat selector listed every chapter in the school as "Group . Chapter",
 * which made filing into the wrong course a one-click mistake -- and a silent one,
 * because the database derives `group_id` from whichever chapter was chosen.
 */
export function ResourceDialog({
  open,
  onOpenChange,
  resource,
  groups,
  context,
  onCreateChapter,
  onSubmit,
  isPending,
  uploads,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource?: ResourceRow | null | undefined;
  /** Groups the caller may file into. RLS is the real gate; this is the picker. */
  groups: GroupOption[];
  /** Set when launched from a chapter: locks the destination. */
  context?: { groupId: string; chapterId: string } | undefined;
  /** Creates a chapter in the selected group and resolves its id. Owned by the
   *  page, so this component keeps holding no mutations. */
  onCreateChapter?: ((groupId: string, title: string) => Promise<string | null>) | undefined;
  onSubmit: (v: ResourceFormValue) => void;
  isPending: boolean;
  /**
   * The page's upload queue, rendered as per-file rows. The page owns it so that
   * closing this dialog can abort every transfer still running.
   */
  uploads?:
    | {
        items: UploadItem[];
        onCancel: (id: string) => void;
        onCancelAll: () => void;
        /** Seeds the queue as soon as the selection changes. */
        onFilesChange: (files: File[]) => void;
        onRetry: (id: string) => void;
        onRemove: (id: string) => void;
        busy: boolean;
      }
    | undefined;
}) {
  const { t, locale } = useI18n();
  const [groupId, setGroupId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [role, setRole] = useState<ResourceRole>("notes");
  const [newChapter, setNewChapter] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ResourceKind>("file");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  /** Set while a file is dragged over the drop zone, for the visual affordance. */
  const [dragOver, setDragOver] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [isPublished, setPublished] = useState(true);
  const [publishAt, setPublishAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Chapters of the SELECTED group only -- not filtered from a global list. */
  const chaptersQuery = useChaptersByGroup(open ? groupId || null : null);
  const chapters = useMemo(() => chaptersQuery.data ?? [], [chaptersQuery.data]);

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);
  const chapterTitle = chapters.find((c) => c.id === chapterId)?.title ?? null;

  /** Locked when opened from a chapter. Editing keeps the group but frees the
   *  chapter, so a misfiled resource can be moved WITHIN its own course. */
  const lockedGroup = !!context || !!resource;
  const lockedChapter = !!context && !resource;

  useEffect(() => {
    if (!open) return;
    setGroupId(resource?.groupId ?? context?.groupId ?? "");
    setChapterId(resource?.chapterId ?? context?.chapterId ?? "");
    setRole(resource?.role ?? "notes");
    setNewChapter(null);
    setCreating(false);
    setTitle(resource?.title ?? "");
    setDescription(resource?.description ?? "");
    setKind(resource?.kind ?? "file");
    setUrl(resource?.url ?? "");
    setFiles([]);
    setDragOver(false);
    setPinned(resource?.pinned ?? false);
    setAllowDownload(resource?.allowDownload ?? true);
    setPublished(resource?.isPublished ?? true);
    // `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone.
    setPublishAt(resource?.publishedAt ? resource.publishedAt.slice(0, 16) : "");
    setError(null);
  }, [open, resource, context]);

  /** Changing the group invalidates the chapter: keeping it would be exactly the
   *  Group A + Chapter-of-Group-B pairing this dialog exists to prevent. */
  const pickGroup = (id: string) => {
    setGroupId(id);
    setChapterId("");
    setNewChapter(null);
    setError(null);
  };

  const createChapter = async () => {
    const title = (newChapter ?? "").trim();
    if (!onCreateChapter || !groupId || !title) return;
    setCreating(true);
    try {
      const id = await onCreateChapter(groupId, title);
      if (id) {
        setChapterId(id);
        setNewChapter(null);
      }
    } finally {
      setCreating(false);
    }
  };

  const batch = files.length > 1;
  /** Editing an existing resource replaces one file, never several. */
  const editing = !!resource;

  const submit = () => {
    if (!groupId) return setError(t("resources.hier.selectGroup"));
    if (!chapterId) return setError(t("resources.hier.selectChapter"));
    // A batch names each row from its own filename, so one shared title would be
    // wrong for four of five files.
    if (!batch && !title.trim()) return setError(t("resources.dialog.titleRequired"));
    // The chapter must belong to the chosen group. The database derives `group_id`
    // from the chapter regardless, so a mismatch here would not corrupt anything --
    // it would silently file the resource in the other group, which is worse.
    if (chapters.length > 0 && !chapters.some((c) => c.id === chapterId)) {
      return setError(t("resources.hier.selectChapter"));
    }
    if (kind === "link") {
      // https only: a mixed-content http link would be blocked in the preview and
      // silently fail for the student.
      if (!/^https:\/\/.+/i.test(url.trim())) return setError(t("resources.dialog.urlInvalid"));
    } else if (!resource?.storagePath && files.length === 0) {
      return setError(t("resources.dialog.fileRequired"));
    }
    // Per FILE, not per batch: the 250 MB rule is about one file, and the server
    // re-checks the largest member for exactly this reason.
    if (files.some((f) => f.size > MAX_BYTES)) return setError(t("resources.dialog.fileTooLarge"));

    onSubmit({
      ...(resource ? { id: resource.id } : {}),
      chapterId,
      groupId,
      title,
      description,
      kind,
      url,
      files,
      role,
      pinned,
      allowDownload,
      isPublished,
      publishAt,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Closing while bytes are in flight has to STOP them. Abandoning the promise
        // leaves the XHR running, and the object lands in the bucket minutes later
        // with no row pointing at it -- an orphan that still counts against the quota.
        // Closing while anything is in flight STOPS it. Abandoning the requests
        // leaves objects landing in the bucket minutes later with no rows pointing at
        // them -- orphans that still count against the quota.
        if (!v && uploads?.busy) uploads.onCancelAll();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {resource
              ? t("resources.dialog.editResourceTitle")
              : t("resources.dialog.newResourceTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {lockedChapter ? (
            <AddingToPanel group={group} chapterTitle={chapterTitle} />
          ) : (
            <div className="space-y-4 rounded-xl border border-border bg-muted/40 p-3">
              {/* GROUPE -- the primary selector, and the axis everything else hangs
                  off. Fixed when editing: moving a resource to another course is a
                  different operation from correcting its chapter. */}
              <div className="space-y-1.5">
                <Label htmlFor="res-group" className="text-xs font-semibold">
                  {t("resources.hier.group")}
                </Label>
                {lockedGroup ? (
                  <p className="truncate text-sm font-medium">{group?.name ?? "\u2014"}</p>
                ) : (
                  <Select value={groupId} onValueChange={pickGroup}>
                    <SelectTrigger id="res-group" className="h-11 w-full rounded-xl bg-card">
                      <SelectValue placeholder={t("resources.hier.selectGroup")} />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* MATIERE -- derived from the group, never an input. */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">{t("resources.hier.subject")}</Label>
                <p className="truncate text-sm font-medium text-secondary-foreground">
                  {groupId
                    ? (group?.subjectName ?? t("resources.hier.noSubject"))
                    : t("resources.hier.noGroupSelected")}
                </p>
              </div>

              {/* CHAPITRE -- only this group's, straight from a scoped query. */}
              <div className="space-y-1.5">
                <Label htmlFor="res-chapter" className="text-xs font-semibold">
                  {t("resources.hier.chapter")}
                </Label>
                {!groupId ? (
                  <p className="text-sm text-muted-foreground">
                    {t("resources.hier.noGroupSelected")}
                  </p>
                ) : chaptersQuery.isPending ? (
                  <div className="h-11 animate-pulse rounded-xl bg-muted" />
                ) : chapters.length === 0 && newChapter === null ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {t("resources.hier.noChapters")}
                    </p>
                    {onCreateChapter && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => setNewChapter("")}
                      >
                        <Plus className="size-4" aria-hidden />
                        {t("resources.hier.createChapter")}
                      </Button>
                    )}
                  </div>
                ) : newChapter !== null ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      autoFocus
                      className="h-11 min-w-0 flex-1 rounded-xl bg-card"
                      maxLength={160}
                      placeholder={t("resources.hier.newChapterName")}
                      value={newChapter}
                      onChange={(e) => setNewChapter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void createChapter();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-xl"
                      disabled={creating || !newChapter.trim()}
                      onClick={() => void createChapter()}
                    >
                      {creating && <Loader2 className="size-4 animate-spin" aria-hidden />}
                      {t("resources.hier.create")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setNewChapter(null)}
                    >
                      {t("resources.hier.cancel")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Select value={chapterId} onValueChange={setChapterId}>
                      <SelectTrigger id="res-chapter" className="h-11 w-full rounded-xl bg-card">
                        <SelectValue placeholder={t("resources.hier.selectChapter")} />
                      </SelectTrigger>
                      <SelectContent>
                        {chapters.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {onCreateChapter && !resource && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg px-2 text-xs"
                        onClick={() => setNewChapter("")}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        {t("resources.hier.createChapter")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TYPE DE RESSOURCE -- what it is for, not what format it is in. */}
          <div className="space-y-2">
            <Label htmlFor="res-role">{t("resources.dialog.role")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as ResourceRole)}>
              <SelectTrigger id="res-role" className="h-11 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="res-title">{t("resources.dialog.resourceTitle")}</Label>
            <Input
              id="res-title"
              className="h-11 rounded-xl"
              value={title}
              maxLength={200}
              placeholder={t("resources.dialog.resourceTitlePlaceholder")}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* File vs link: a segmented control matching the calendar's, so the
              same interaction means the same thing across the product. */}
          <div className="flex rounded-xl bg-muted p-0.5">
            {(["file", "link"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "focus-ring flex-1 rounded-[0.6rem] px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === k
                    ? "bg-card text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(k === "file" ? "resources.dialog.sourceFile" : "resources.dialog.sourceLink")}
              </button>
            ))}
          </div>

          {kind === "file" ? (
            <div className="space-y-2">
              <Label htmlFor="res-file" className="sr-only">
                {t("resources.dialog.chooseFile")}
              </Label>
              {/* Also a DROP ZONE. Dragging a folderful of scans onto a dialog is how
                  people actually move files, and the label was already the right shape
                  for it. `dragOver` only drives the affordance -- the drop itself is
                  the same path as the picker. */}
              <label
                htmlFor="res-file"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const dropped = [...(e.dataTransfer?.files ?? [])];
                  if (dropped.length === 0) return;
                  const next = editing ? dropped.slice(0, 1) : [...files, ...dropped];
                  setFiles(next);
                  uploads?.onFilesChange(next);
                  if (next.length === 1 && !title.trim()) {
                    setTitle(next[0]!.name.replace(/\.[^.]+$/, ""));
                  }
                }}
                className={cn(
                  "focus-within:ring-ring flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-4 transition-colors",
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <Upload className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {files.length === 1
                      ? files[0]!.name
                      : files.length > 1
                        ? t("resources.upload.fileCount", { count: files.length })
                        : resource?.storagePath
                          ? t("resources.dialog.replaceFile")
                          : t("resources.dialog.chooseFiles")}
                  </span>
                  {/* Direction-neutral: "250 MB max" reorders to "MB max 250" under
                      RTL unless it is isolated. Same fix as the file sizes on the
                      rows and the time ranges in the calendar. */}
                  <span
                    className="block text-xs text-muted-foreground"
                    dir="ltr"
                    style={{ unicodeBidi: "isolate" }}
                  >
                    {files.length > 0
                      ? formatBytes(
                          files.reduce((n, f) => n + f.size, 0),
                          locale,
                        )
                      : formatBytes(MAX_BYTES, locale) + " max"}
                  </span>
                </span>
                {files.length > 0 && (
                  <Paperclip className="size-4 shrink-0 text-primary" aria-hidden />
                )}
              </label>
              <input
                id="res-file"
                type="file"
                // Editing replaces ONE file, so no multiple there: a resource is one
                // file, and letting five be chosen would raise a question the schema
                // cannot answer.
                {...(editing ? {} : { multiple: true })}
                className="sr-only"
                onChange={(e) => {
                  const chosen = [...(e.target.files ?? [])];
                  setFiles(chosen);
                  uploads?.onFilesChange(chosen);
                  // Prefill the title from the filename, but only when there is one
                  // file: a batch takes each row's title from its own name.
                  if (chosen.length === 1 && !title.trim()) {
                    setTitle(chosen[0]!.name.replace(/\.[^.]+$/, ""));
                  }
                }}
              />
              {/* Per-file progress, cancel and retry. Supplied by the page, which owns
                  the queue -- so closing this dialog can still stop every transfer. */}
              {uploads && (
                <UploadList
                  items={uploads.items}
                  onCancel={uploads.onCancel}
                  onRetry={uploads.onRetry}
                  onRemove={uploads.onRemove}
                />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="res-url">{t("resources.dialog.linkUrl")}</Label>
              <Input
                id="res-url"
                type="url"
                inputMode="url"
                dir="ltr"
                className="h-11 rounded-xl"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="res-desc">{t("resources.dialog.chapterDescription")}</Label>
            <Textarea
              id="res-desc"
              className="min-h-16 rounded-xl"
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-3 rounded-xl border border-border p-3">
            <ToggleRow
              id="res-important"
              label={t("resources.dialog.markImportant")}
              checked={pinned}
              onChange={setPinned}
            />
            {kind === "file" && (
              <ToggleRow
                id="res-download"
                label={t("resources.dialog.allowDownload")}
                checked={allowDownload}
                onChange={setAllowDownload}
              />
            )}
            <ToggleRow
              id="res-published"
              label={t("resources.dialog.publishNow")}
              checked={isPublished}
              onChange={setPublished}
            />
            {isPublished && (
              <div className="space-y-1.5">
                <Label htmlFor="res-when" className="text-xs text-muted-foreground">
                  {t("resources.dialog.scheduleFor")}
                </Label>
                <Input
                  id="res-when"
                  type="datetime-local"
                  className="h-10 rounded-xl"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                />
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            {t("resources.dialog.cancel")}
          </Button>
          <Button type="button" className="rounded-xl" onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("resources.dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
