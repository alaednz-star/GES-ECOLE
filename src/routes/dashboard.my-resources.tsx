import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen, Search, Sparkles, Star } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useSubjectLabel } from "@/features/school/subject-label";
import { subjectColor } from "@/features/school/session/subject-tint";
import { ChapterSection } from "@/features/school/resources/chapter-section";
import { CourseIdentity } from "@/features/school/resources/course-identity";
import { linkFaceOf } from "@/features/school/resources/link-provider";
import { ResourcePreview } from "@/features/school/resources/resource-preview";
import {
  signResourceUrl,
  useMyResources,
  useRecordResourceEvent,
} from "@/features/school/resources/queries";
import { formatBytes } from "@/features/school/resources/resource-icon";
import { ResourceThumb } from "@/features/school/resources/resource-thumb";
import type { ResourceRow } from "@/features/school/resources/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/my-resources")({
  head: () => ({
    meta: [
      { title: "Mes ressources — Gestion École" },
      { name: "description", content: "Les supports partagés par vos enseignants." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["student"]}>
      <MyResourcesPage />
    </RequireAuth>
  ),
});

/**
 * The student's resources, always organised COURS -> CHAPITRE -> RESSOURCES.
 *
 * Never a flat file list: a student looking for last week's worksheet thinks
 * "which chapter of maths?", so the hierarchy is the navigation. "Tout" flattens
 * on request, and the two shortcut rails at the top answer the two other real
 * questions -- what matters most, and what is new.
 *
 * READ-ONLY by construction. There is no mutation on this page beyond recording
 * that a resource was opened, and RLS refuses a write regardless.
 */
/** One shared reference, so "no data yet" never looks like new data. */
const EMPTY_COURSES: never[] = [];

function MyResourcesPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const subjectLabel = useSubjectLabel();
  const { notifyError } = useActionFeedback();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<"chapters" | "all">("chapters");
  const [unopenedOnly, setUnopenedOnly] = useState(false);
  const [preview, setPreview] = useState<ResourceRow | null>(null);

  const coursesQuery = useMyResources(user?.id);
  const recordEvent = useRecordResourceEvent();

  /** Memoised for the same reason as the teacher page: a fresh `[]` per render
   *  would invalidate every derivation below on every render. */
  const courses = useMemo(() => coursesQuery.data ?? EMPTY_COURSES, [coursesQuery.data]);

  const allResources = useMemo(
    () => courses.flatMap((c) => c.chapters.flatMap((ch) => ch.resources)),
    [courses],
  );

  const openedCount = allResources.filter((r) => r.openedByMe).length;

  /**
   * The shortcut rails only earn their space once the outline is long enough to
   * need them.
   *
   * With four resources in one chapter, "À ne pas manquer" and "Ajouts récents"
   * showed the SAME items already visible two rows below -- the page said
   * everything three times and looked padded rather than helpful. Above the
   * threshold the outline no longer fits on one screen and a shortcut is worth
   * the space.
   */
  const railsWorthwhile = allResources.length > 6;

  /**
   * Teacher-flagged -- the "don't miss this" rail.
   *
   * NOT gated behind `railsWorthwhile`, unlike the recent rail. Pinning is an
   * explicit act by a teacher, and suppressing it because the course happens to be
   * small would silently discard the signal. "Recent" is a heuristic and can be
   * gated; "important" was chosen by a person.
   */
  const important = useMemo(() => allResources.filter((r) => r.pinned).slice(0, 4), [allResources]);

  /** Newest few, so "what changed since I last looked?" needs no scrolling. */
  const recent = useMemo(
    () =>
      railsWorthwhile
        ? [...allResources].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
        : [],
    [allResources, railsWorthwhile],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses
      .map((c) => ({
        ...c,
        chapters: c.chapters
          .map((ch) => ({
            ...ch,
            resources: ch.resources.filter((r) => {
              if (unopenedOnly && r.openedByMe) return false;
              if (!q) return true;
              return (
                ch.title.toLowerCase().includes(q) ||
                r.title.toLowerCase().includes(q) ||
                c.groupName.toLowerCase().includes(q)
              );
            }),
          }))
          .filter((ch) => ch.resources.length > 0),
      }))
      .filter((c) => c.chapters.length > 0);
  }, [courses, query, unopenedOnly]);

  /** Opening records progress, then shows the preview. */
  const open = (r: ResourceRow) => {
    recordEvent.mutate({ resourceId: r.id, kind: "view" });
    // A link used to always leave the app, which meant a YouTube lesson dropped the
    // student onto youtube.com with its sidebar of everything else. Anything with an
    // embeddable form is now watched in place; only providers that refuse framing
    // still open a tab.
    if (r.kind === "link" && r.url && !linkFaceOf(r.url).embedUrl) {
      globalThis.open(r.url, "_blank", "noopener,noreferrer");
      return;
    }
    setPreview(r);
  };

  const download = async (r: ResourceRow) => {
    // Hiding the button is a courtesy; `can_download_resource` in the database is
    // what actually decides, and the server refuses to sign an attachment URL
    // without it. This early return only keeps a stale render from a pointless
    // round trip.
    if (!r.allowDownload) return;
    try {
      if (r.kind === "link" && r.url) {
        recordEvent.mutate({ resourceId: r.id, kind: "download" });
        globalThis.open(r.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (!r.storagePath) return;
      const url = await signResourceUrl(r.id, "download");
      // Recorded only once the URL exists, so the count means "downloads the
      // server authorised" rather than "times the button was pressed".
      recordEvent.mutate({ resourceId: r.id, kind: "download" });
      globalThis.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      notifyError(e);
    }
  };

  const header = (
    <PageHeader
      title={t("resources.studentTitle")}
      description={t("resources.studentDescription")}
      actions={
        allResources.length > 0 ? (
          <div className="min-w-40">
            <p
              className={cn(
                "text-end text-sm font-semibold tabular-nums",
                openedCount === allResources.length && "text-success",
              )}
            >
              {openedCount === allResources.length
                ? t("resources.student.allOpened")
                : t("resources.student.progress", {
                    opened: openedCount,
                    total: allResources.length,
                  })}
            </p>
            <Progress value={(openedCount / allResources.length) * 100} className="mt-1.5 h-1.5" />
          </div>
        ) : undefined
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

  if (allResources.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title={t("resources.empty.studentTitle")}
          description={t("resources.empty.studentDescription")}
        />
      </>
    );
  }

  return (
    <>
      {header}

      {/* Two rails before the outline: what matters, and what is new. */}
      {important.length > 0 && (
        <Rail
          icon={Star}
          title={t("resources.student.important")}
          resources={important}
          courses={courses}
          onOpen={open}
        />
      )}
      {recent.length > 0 && (
        <Rail
          icon={Sparkles}
          title={t("resources.student.recent")}
          resources={recent}
          courses={courses}
          onOpen={open}
        />
      )}

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

        <Button
          type="button"
          variant={unopenedOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={unopenedOnly}
          className="h-9 rounded-lg text-xs"
          onClick={() => setUnopenedOnly((v) => !v)}
        >
          {t("resources.onlyUnopened")}
        </Button>

        <div className="flex rounded-lg bg-muted p-0.5">
          {(["chapters", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                // Same 24px measurement as the teacher page's copy of this toggle.
                // The student one matters more: they are the ones on a phone.
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

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("resources.empty.search")}
          description={t("resources.empty.searchDescription")}
        />
      ) : (
        <div className="space-y-5">
          {filtered.map((course) => {
            const accent = subjectColor(course.subjectColor, course.subjectKey);
            const total = course.chapters.reduce((n, ch) => n + ch.resources.length, 0);
            const opened = course.chapters.reduce(
              (n, ch) => n + ch.resources.filter((r) => r.openedByMe).length,
              0,
            );
            return (
              <div key={course.groupId} className="space-y-2">
                {/* The same identity block the teacher sees, so "3AS Sciences /
                    Physique / M. Saadi" means the same thing on both sides. A
                    student needs the teacher's name most: it is how they refer to
                    the course out loud. */}
                <CourseIdentity
                  className="px-1"
                  groupName={course.groupName}
                  subjectName={subjectLabel(course.subjectKey, course.subjectName)}
                  teacherName={course.teacherName}
                  levelName={course.levelName}
                  accent={accent}
                  trailing={
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {t("resources.student.progress", { opened, total })}
                    </span>
                  }
                />
                <div className="space-y-2.5">
                  {course.chapters.map((ch) => (
                    <ChapterSection
                      key={ch.id}
                      chapter={ch}
                      accent={accent}
                      canEdit={false}
                      defaultOpen={view === "all" || filtered.length <= 2}
                      query={query}
                      onAddResource={() => undefined}
                      onEditChapter={() => undefined}
                      onDeleteChapter={() => undefined}
                      onEditResource={() => undefined}
                      onDeleteResource={() => undefined}
                      onToggleVisibility={() => undefined}
                      onOpenResource={open}
                      onDownloadResource={download}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* `canDownload` still defers to each resource's own `allowDownload`. */}
      <ResourcePreview resource={preview} onClose={() => setPreview(null)} canDownload />
    </>
  );
}

/** A horizontal shortcut rail. Scrolls inside itself, never the page. */
function Rail({
  icon: Icon,
  title,
  resources,
  courses,
  onOpen,
}: {
  icon: typeof Star;
  title: string;
  resources: ResourceRow[];
  courses: {
    groupId: string;
    groupName: string;
    subjectColor: string | null;
    subjectKey: string | null;
  }[];
  onOpen: (r: ResourceRow) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold tracking-tight">
        <Icon className="size-4 text-accent" aria-hidden />
        {title}
      </h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {resources.map((r) => {
          const course = courses.find((c) => c.groupId === r.groupId);
          const accent = subjectColor(course?.subjectColor ?? null, course?.subjectKey ?? null);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpen(r)}
              className="focus-ring surface-card flex w-56 shrink-0 items-start gap-2.5 p-3 text-start transition-shadow hover:shadow-card"
            >
              <ResourceThumb
                resource={r}
                accent={accent}
                className="size-9 rounded-xl"
                iconClassName="size-4"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="min-w-0 truncate text-[13px] font-medium">{r.title}</span>
                  {!r.openedByMe && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                      aria-label={t("resources.resource.new")}
                    />
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {course?.groupName ?? ""}
                  {r.sizeBytes ? (
                    <>
                      {" · "}
                      {/* Bidi-isolated, as elsewhere: RTL reorders "2,3 MB". */}
                      <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                        {formatBytes(r.sizeBytes, locale)}
                      </span>
                    </>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
