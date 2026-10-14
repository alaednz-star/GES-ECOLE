/**
 * One chapter, collapsible, with its resources.
 *
 * The chapter is the unit of this page -- not the file. A teacher thinks
 * "Chapitre 3, les suites", so the chapter carries the title, the count and the
 * actions, and resources are rows inside it rather than a flat file list.
 */

import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { faceOf, formatBytes } from "./resource-icon";
import { ResourceThumb } from "./resource-thumb";
import { RoleBadge } from "./role-badge";
import type { ChapterRow, ResourceRow } from "./types";

const VISIBILITY_STYLE: Record<string, string> = {
  published: "text-success",
  scheduled: "text-accent",
  hidden: "text-muted-foreground",
};

export interface ChapterSectionProps {
  chapter: ChapterRow;
  /** Subject colour, taken from the DB via the existing subject system. */
  accent: string;
  canEdit: boolean;
  defaultOpen?: boolean | undefined;
  onAddResource: (chapterId: string) => void;
  onEditChapter: (chapter: ChapterRow) => void;
  onDeleteChapter: (chapter: ChapterRow) => void;
  /** Publication and pinning of the chapter itself. Absent for the student view. */
  onSetChapterVisibility?: ((chapter: ChapterRow, isPublished: boolean) => void) | undefined;
  onSetChapterPinned?: ((chapter: ChapterRow, pinned: boolean) => void) | undefined;
  onPublishAll?: ((chapter: ChapterRow, isPublished: boolean) => void) | undefined;
  onDuplicateChapter?: ((chapter: ChapterRow) => void) | undefined;
  onDuplicateResource?: ((resource: ResourceRow) => void) | undefined;
  onSetResourcePinned?: ((resource: ResourceRow, pinned: boolean) => void) | undefined;
  onShowEngagement?: ((resource: ResourceRow) => void) | undefined;
  onEditResource: (resource: ResourceRow) => void;
  onDeleteResource: (resource: ResourceRow) => void;
  onToggleVisibility: (resource: ResourceRow) => void;
  onOpenResource: (resource: ResourceRow) => void;
  onDownloadResource: (resource: ResourceRow) => void;
  onMove?: ((chapterId: string, direction: -1 | 1) => void) | undefined;
  /** Highlights matched text when a search is active. */
  query?: string | undefined;
  /**
   * Drag wiring, supplied by the page so one drag session can span chapters.
   * Absent for the student view, which does not reorder anything.
   */
  drag?: DragBinding | undefined;
}

/**
 * What a draggable surface needs from the page.
 *
 * The page owns the drag session because a resource can be dropped into a
 * DIFFERENT chapter -- state living inside one ChapterSection could not see the
 * others.
 */
export interface DragBinding {
  chapterProps: (chapterId: string) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  resourceProps: (
    resourceId: string,
    chapterId: string,
  ) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  /** Drop zone for a chapter body, so an empty chapter can still receive. */
  bodyProps: (chapterId: string) => {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  isChapterDragging: (id: string) => boolean;
  isResourceDragging: (id: string) => boolean;
  chapterIndicator: (id: string) => "before" | "after" | null;
  resourceIndicator: (id: string) => "before" | "after" | null;
}

export function ChapterSection({
  chapter,
  accent,
  canEdit,
  defaultOpen = true,
  onAddResource,
  onEditChapter,
  onDeleteChapter,
  onSetChapterVisibility,
  onSetChapterPinned,
  onPublishAll,
  onDuplicateChapter,
  onDuplicateResource,
  onSetResourcePinned,
  onShowEngagement,
  onEditResource,
  onDeleteResource,
  onToggleVisibility,
  onOpenResource,
  onDownloadResource,
  onMove,
  query,
  drag,
}: ChapterSectionProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `chapter-${chapter.id}`;

  const chapterDrag = drag?.chapterProps(chapter.id);
  const chapterLine = drag?.chapterIndicator(chapter.id) ?? null;

  return (
    <section
      className={cn(
        "surface-card relative overflow-hidden transition-shadow",
        // Lifted, not tilted: a shadow reads as "picked up" without the jitter a
        // rotation introduces mid-list.
        drag?.isChapterDragging(chapter.id) && "opacity-60 shadow-elevated",
      )}
      {...(chapterDrag ? { onDragOver: chapterDrag.onDragOver, onDrop: chapterDrag.onDrop } : {})}
    >
      {/* Insertion line, drawn inside the card so it cannot shift the layout. */}
      {chapterLine && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary",
            chapterLine === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        {/* The real handle. Drag lives on the grip rather than the whole header so
            the collapse button still works normally. Monter/Descendre in the menu
            remains the keyboard and touch path -- native DnD does not fire on
            touch, and it must never be the only way to reorder. */}
        {canEdit && onMove && chapterDrag && (
          <span
            draggable={chapterDrag.draggable}
            onDragStart={chapterDrag.onDragStart}
            onDragEnd={chapterDrag.onDragEnd}
            title={t("resources.reorder.dragHint")}
            aria-hidden
            className="hidden shrink-0 cursor-grab touch-none px-0.5 py-2 text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing sm:block"
          >
            <GripVertical className="size-4" />
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          // min-h-11 is the 44px guidance figure. Measured at 375px this button was
          // 20px tall: the text set its height, and the padding lives on the row
          // around it rather than on the control. Expanding a chapter is the main
          // thing a student does on a phone.
          className="focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg text-start"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90 rtl:rotate-90",
            )}
            aria-hidden
          />
          <span
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {/* Pinned and publication state belong on the chapter line: they are
                  what a teacher scans for when something is not reaching students. */}
              {chapter.pinned && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  <Pin className="size-3" aria-hidden />
                  {t("resources.chapter.pinnedBadge")}
                </span>
              )}
              <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere] line-clamp-2 sm:truncate">
                <Highlight text={chapter.title} query={query} />
              </span>
              {canEdit && chapter.visibility !== "published" && (
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap text-[11px] font-medium",
                    VISIBILITY_STYLE[chapter.visibility],
                  )}
                >
                  {chapter.visibility === "scheduled" && chapter.publishedAt
                    ? t("resources.visibility.scheduledFor", {
                        date: formatDate(chapter.publishedAt, locale),
                      })
                    : t(`resources.visibility.${chapter.visibility}`)}
                </span>
              )}
            </span>
            {chapter.description && (
              <span className="block truncate text-xs text-muted-foreground">
                {chapter.description}
              </span>
            )}
          </span>
          <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground sm:inline">
            {t("resources.chapter.count", { count: chapter.resources.length })}
          </span>
        </button>

        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              aria-label={t("resources.addResource")}
              onClick={() => onAddResource(chapter.id)}
            >
              <Plus className="size-4" aria-hidden />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg"
                  aria-label={t("resources.chapter.rename")}
                >
                  <Ellipsis className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => onEditChapter(chapter)}>
                  <Pencil className="size-4" aria-hidden />
                  {t("resources.chapter.rename")}
                </DropdownMenuItem>

                {onSetChapterPinned && (
                  <DropdownMenuItem onClick={() => onSetChapterPinned(chapter, !chapter.pinned)}>
                    {chapter.pinned ? (
                      <PinOff className="size-4" aria-hidden />
                    ) : (
                      <Pin className="size-4" aria-hidden />
                    )}
                    {t(chapter.pinned ? "resources.chapter.unpin" : "resources.chapter.pin")}
                  </DropdownMenuItem>
                )}

                {onSetChapterVisibility && (
                  <DropdownMenuItem
                    onClick={() => onSetChapterVisibility(chapter, !chapter.isPublished)}
                  >
                    {chapter.isPublished ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                    {t(
                      chapter.isPublished
                        ? "resources.chapter.hideChapter"
                        : "resources.chapter.publishChapter",
                    )}
                  </DropdownMenuItem>
                )}

                {onMove && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onMove(chapter.id, -1)}>
                      {t("resources.chapter.moveUp")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onMove(chapter.id, 1)}>
                      {t("resources.chapter.moveDown")}
                    </DropdownMenuItem>
                  </>
                )}

                {onPublishAll && chapter.resources.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onPublishAll(chapter, true)}>
                      <Eye className="size-4" aria-hidden />
                      {t("resources.chapter.publishAll")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPublishAll(chapter, false)}>
                      <EyeOff className="size-4" aria-hidden />
                      {t("resources.chapter.hideAll")}
                    </DropdownMenuItem>
                  </>
                )}

                {onDuplicateChapter && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDuplicateChapter(chapter)}>
                      <Copy className="size-4" aria-hidden />
                      {t("resources.chapter.duplicate")}
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDeleteChapter(chapter)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t("resources.chapter.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {open && (
        <div
          id={bodyId}
          className="border-t border-border"
          {...(drag ? drag.bodyProps(chapter.id) : {})}
        >
          {chapter.resources.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("resources.chapter.empty")}</p>
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => onAddResource(chapter.id)}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("resources.chapter.addFirst")}
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {chapter.resources.map((r) => (
                <ResourceRowItem
                  key={r.id}
                  resource={r}
                  accent={accent}
                  canEdit={canEdit}
                  query={query}
                  chapterId={chapter.id}
                  drag={drag}
                  onEdit={onEditResource}
                  onDelete={onDeleteResource}
                  onToggleVisibility={onToggleVisibility}
                  onOpen={onOpenResource}
                  onDownload={onDownloadResource}
                  {...(onDuplicateResource ? { onDuplicate: onDuplicateResource } : {})}
                  {...(onSetResourcePinned ? { onSetPinned: onSetResourcePinned } : {})}
                  {...(onShowEngagement ? { onShowEngagement } : {})}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ResourceRowItem({
  resource,
  accent,
  canEdit,
  query,
  chapterId,
  drag,
  onEdit,
  onDelete,
  onToggleVisibility,
  onOpen,
  onDownload,
  onDuplicate,
  onSetPinned,
  onShowEngagement,
}: {
  resource: ResourceRow;
  accent: string;
  canEdit: boolean;
  query?: string | undefined;
  chapterId: string;
  drag?: DragBinding | undefined;
  onEdit: (r: ResourceRow) => void;
  onDelete: (r: ResourceRow) => void;
  onToggleVisibility: (r: ResourceRow) => void;
  onOpen: (r: ResourceRow) => void;
  onDownload: (r: ResourceRow) => void;
  onDuplicate?: ((r: ResourceRow) => void) | undefined;
  onSetPinned?: ((r: ResourceRow, pinned: boolean) => void) | undefined;
  onShowEngagement?: ((r: ResourceRow) => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const face = faceOf(resource.kind, resource.mimeType);
  const size = formatBytes(resource.sizeBytes, locale);

  // The size is rendered separately, bidi-isolated: "1,1 MB" is
  // direction-neutral and RTL would reorder it to "MB 1,1".
  const meta = [
    t(face.labelKey),
    canEdit && resource.openCount !== undefined
      ? t("resources.resource.views", { count: resource.openCount })
      : null,
  ].filter(Boolean);

  const rowDrag = drag?.resourceProps(resource.id, chapterId);
  const line = drag?.resourceIndicator(resource.id) ?? null;

  return (
    <li
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40 sm:px-4",
        drag?.isResourceDragging(resource.id) && "opacity-50",
      )}
      {...(rowDrag ? { onDragOver: rowDrag.onDragOver, onDrop: rowDrag.onDrop } : {})}
    >
      {line && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary",
            line === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
      {/* Handle only for staff, and only where a pointer exists. */}
      {canEdit && rowDrag && (
        <span
          draggable={rowDrag.draggable}
          onDragStart={rowDrag.onDragStart}
          onDragEnd={rowDrag.onDragEnd}
          title={t("resources.reorder.dragHint")}
          aria-hidden
          className="hidden shrink-0 cursor-grab touch-none py-2 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing sm:block"
        >
          <GripVertical className="size-3.5" />
        </span>
      )}
      <button
        type="button"
        onClick={() => onOpen(resource)}
        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start"
      >
        <ResourceThumb
          resource={resource}
          accent={accent}
          className="size-9 rounded-xl"
          iconClassName="size-4"
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* What it is FOR, before what it is. */}
            <RoleBadge role={resource.role} />
            <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere] line-clamp-2 sm:truncate">
              <Highlight text={resource.title} query={query} />
            </span>
            {resource.pinned && (
              <Star
                className="size-3.5 shrink-0 fill-accent text-accent"
                aria-label={t("resources.resource.important")}
              />
            )}
            {/* Student view only: a dot for "not opened yet". */}
            {resource.openedByMe === false && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                aria-label={t("resources.resource.new")}
              />
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              {meta.join(" · ")}
              {size ? (
                <>
                  {" · "}
                  <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                    {size}
                  </span>
                </>
              ) : null}
            </span>
            {canEdit && (
              <span className={cn("font-medium", VISIBILITY_STYLE[resource.visibility])}>
                {resource.visibility === "scheduled" && resource.publishedAt
                  ? t("resources.visibility.scheduledFor", {
                      date: formatDate(resource.publishedAt, locale),
                    })
                  : t(`resources.visibility.${resource.visibility}`)}
              </span>
            )}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {/* Download only when the teacher allowed it. The signed URL is minted
            per click, so hiding the button is convenience -- storage RLS is the
            actual boundary. */}
        {resource.kind === "file" && resource.allowDownload && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t("resources.resource.download")}
            onClick={() => onDownload(resource)}
          >
            <Download className="size-4" aria-hidden />
          </Button>
        )}
        {canEdit && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              aria-label={
                resource.isPublished
                  ? t("resources.resource.unpublish")
                  : t("resources.resource.publish")
              }
              onClick={() => onToggleVisibility(resource)}
            >
              {resource.isPublished ? (
                <Eye className="size-4" aria-hidden />
              ) : (
                <EyeOff className="size-4 text-muted-foreground" aria-hidden />
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg"
                  aria-label={t("resources.resource.edit")}
                >
                  <Ellipsis className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => onEdit(resource)}>
                  <Pencil className="size-4" aria-hidden />
                  {t("resources.resource.edit")}
                </DropdownMenuItem>
                {onSetPinned && (
                  <DropdownMenuItem onClick={() => onSetPinned(resource, !resource.pinned)}>
                    {resource.pinned ? (
                      <PinOff className="size-4" aria-hidden />
                    ) : (
                      <Pin className="size-4" aria-hidden />
                    )}
                    {t(resource.pinned ? "resources.chapter.unpin" : "resources.chapter.pin")}
                  </DropdownMenuItem>
                )}
                {onDuplicate && (
                  <DropdownMenuItem onClick={() => onDuplicate(resource)}>
                    <Copy className="size-4" aria-hidden />
                    {t("resources.resource.duplicate")}
                  </DropdownMenuItem>
                )}
                {onShowEngagement && (
                  <DropdownMenuItem onClick={() => onShowEngagement(resource)}>
                    <BarChart3 className="size-4" aria-hidden />
                    {t("resources.engagement.title")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(resource)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t("resources.resource.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </li>
  );
}

/** Marks the searched substring, so a match is visible without re-reading. */
function Highlight({ text, query }: { text: string; query?: string | undefined }) {
  const q = query?.trim();
  if (!q || q.length < 2) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-accent-soft px-0.5 text-accent">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}
