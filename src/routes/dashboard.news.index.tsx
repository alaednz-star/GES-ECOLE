/**
 * Actualités (ADR-009): the school's news site, SharePoint-style -- the featured story (newest
 * pinned, else newest), three beside it, then every post in a grid filtered by category. Authors
 * (administrators; teachers for their groups) also see their drafts and scheduled posts.
 */

import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Newspaper, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { NewsCard, NewsEditorDialog } from "@/features/communication/components/news-components";
import { isScheduled, newsLayout } from "@/features/communication/comm-model";
import { useNewsFeed } from "@/features/communication/queries";
import { NEWS_CATEGORIES, type NewsCategory } from "@/features/communication/types";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/news/")({
  head: () => ({
    meta: [{ title: "Actualités — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher", "student"]}>
      <NewsPage />
    </RequireAuth>
  ),
});

function NewsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const feed = useNewsFeed();
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const [tab, setTab] = useState<"news" | "mine">("news");
  const [creating, setCreating] = useState(false);
  const canWrite = user?.role === "admin" || user?.role === "teacher";
  const now = new Date().toISOString();

  const posts = useMemo(() => feed.data ?? [], [feed.data]);
  // Published and visible now; scheduled ones stay in the author's tab.
  const live = useMemo(
    () => posts.filter((p) => p.status === "published" && !isScheduled(p, now)),
    [posts, now],
  );
  const layout = useMemo(() => newsLayout(live), [live]);
  const filtered = useMemo(
    () => (category === "all" ? null : live.filter((p) => p.category === category)),
    [live, category],
  );
  const mine = useMemo(
    () =>
      posts.filter(
        (p) =>
          p.canEdit && (p.status === "draft" || isScheduled(p, now) || p.createdBy === user?.id),
      ),
    [posts, now, user?.id],
  );

  if (feed.error) return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("news.title")}
        description={t("news.subtitle")}
        actions={
          canWrite && (
            <Button className="rounded-xl" onClick={() => setCreating(true)} data-testid="news-add">
              <Plus className="size-4" aria-hidden /> {t("news.add")}
            </Button>
          )
        }
      />

      {canWrite && (
        <div className="flex gap-1 border-b border-border" role="tablist">
          {(["news", "mine"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                tab === k
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`news-tab-${k}`}
            >
              {t(`news.tab.${k}`)}
              {k === "mine" && mine.length > 0 && (
                <span className="ms-1.5 text-xs">({mine.length})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {feed.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Skeleton className="h-80 rounded-2xl" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : tab === "mine" ? (
        mine.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title={t("news.mineEmpty")}
            description={t("news.mineEmptyBody")}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="news-mine">
            {mine.map((p) => (
              <NewsCard key={p.id} post={p} variant="grid" />
            ))}
          </div>
        )
      ) : live.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={t("news.emptyTitle")}
          description={t("news.emptyBody")}
        />
      ) : (
        <>
          {/* SharePoint's top story layout */}
          {layout.hero && (
            <section
              className={cn("grid gap-4", layout.side.length > 0 && "lg:grid-cols-[3fr_2fr]")}
              aria-label={t("news.topStories")}
            >
              <NewsCard post={layout.hero} variant="hero" />
              {layout.side.length > 0 && (
                <div className="surface-card space-y-1 p-2">
                  {layout.side.map((p) => (
                    <NewsCard key={p.id} post={p} variant="side" />
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("news.all")}</h2>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label={t("news.categoryLabel")}
              >
                {(["all", ...NEWS_CATEGORIES] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      category === c
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted",
                    )}
                    data-testid={`news-filter-${c}`}
                  >
                    {c === "all" ? t("news.allCategories") : t(`news.category.${c}`)}
                  </button>
                ))}
              </div>
            </div>
            {(filtered ?? layout.rest).length === 0 ? (
              <p className="rounded-xl bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                {t(filtered ? "news.noneInCategory" : "news.noMore")}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="news-grid">
                {(filtered ?? layout.rest).map((p) => (
                  <NewsCard key={p.id} post={p} variant="grid" />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {creating && (
        <NewsEditorDialog
          post={null}
          onClose={(id) => {
            setCreating(false);
            if (id) void navigate({ to: "/dashboard/news/$postId", params: { postId: id } });
          }}
        />
      )}
    </div>
  );
}
