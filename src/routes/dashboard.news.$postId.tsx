/**
 * One news post (ADR-009): the cover banner, the article, likes, and -- for the author and
 * administrators -- views out of recipients, editing and deletion. Opening it marks it read.
 */

import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Eye, Heart, Pencil, Pin, Trash2, Users } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { useAudienceText } from "@/features/communication/components/audience-picker";
import {
  CategoryChip,
  NewsCover,
  NewsEditorDialog,
} from "@/features/communication/components/news-components";
import { isScheduled, paragraphs } from "@/features/communication/comm-model";
import {
  useDeleteNews,
  useMarkNewsRead,
  useNewsPost,
  useToggleNewsLike,
} from "@/features/communication/queries";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/news/$postId")({
  head: () => ({
    meta: [{ title: "Actualité — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher", "student"]}>
      <NewsPostPage />
    </RequireAuth>
  ),
});

function NewsPostPage() {
  const { t, locale } = useI18n();
  const { postId } = Route.useParams();
  const navigate = useNavigate();
  const { notifySuccess, notifyError } = useActionFeedback();
  const post = useNewsPost(postId);
  const markRead = useMarkNewsRead();
  const like = useToggleNewsLike();
  const remove = useDeleteNews();
  const audienceText = useAudienceText();
  const [editing, setEditing] = useState(false);
  const p = post.data;

  // Opening a published post as a reader records the view (and reads its notice).
  useEffect(() => {
    if (p && p.status === "published" && !p.myRead && !p.canEdit) markRead.mutate(p.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per post
  }, [p?.id, p?.myRead]);

  if (post.error) return <ErrorState error={post.error} onRetry={() => void post.refetch()} />;
  if (post.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (!p) {
    return (
      <EmptyState
        icon={Eye}
        title={t("news.notFound")}
        description={t("news.notFoundBody")}
        action={
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/dashboard/news">{t("news.back")}</Link>
          </Button>
        }
      />
    );
  }

  const scheduled = isScheduled(p, new Date().toISOString());

  return (
    <article className="mx-auto max-w-4xl space-y-6" data-testid="news-article">
      <Button asChild variant="ghost" size="sm" className="rounded-xl">
        <Link to="/dashboard/news">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> {t("news.back")}
        </Link>
      </Button>

      <NewsCover post={p} className="h-56 rounded-2xl sm:h-72" />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryChip category={p.category} />
          {p.pinned && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Pin className="size-3" aria-hidden /> {t("news.pinned")}
            </span>
          )}
          {p.status === "draft" && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">
              {t("news.draft")}
            </span>
          )}
          {scheduled && (
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">
              {t("news.scheduledFor", { date: formatDateTime(p.publishAt as string, locale) })}
            </span>
          )}
        </div>
        <h1
          className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
          data-testid="news-article-title"
        >
          {p.title}
        </h1>
        {p.summary && <p className="text-lg text-muted-foreground">{p.summary}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
          <div className="flex items-center gap-3">
            <PersonAvatar name={p.authorName} url={p.authorAvatar} className="size-10" />
            <div className="text-sm">
              <p className="font-medium">{p.authorName ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {p.publishAt ? formatDateTime(p.publishAt, locale) : t("news.draft")} ·{" "}
                <Users className="inline size-3" aria-hidden />{" "}
                {audienceText(p.audienceType, p.audienceLabel)}
              </p>
            </div>
          </div>
          {p.canEdit && (
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setEditing(true)}
                data-testid="news-edit"
              >
                <Pencil className="size-4" aria-hidden /> {t("news.edit")}
              </Button>
              <ConfirmDialog
                title={t("news.deleteTitle")}
                description={t("news.deleteBody")}
                confirmLabel={t("news.delete")}
                onConfirm={async () => {
                  try {
                    await remove.mutateAsync(p.id);
                    notifySuccess("news.deletedToast");
                    void navigate({ to: "/dashboard/news" });
                  } catch (e) {
                    notifyError(e);
                  }
                }}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-destructive"
                    aria-label={t("news.delete")}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </header>

      <div className="space-y-4 text-[1.02rem] leading-relaxed" data-testid="news-article-body">
        {paragraphs(p.body).map((para, i) => (
          <p key={i} className="whitespace-pre-line">
            {para}
          </p>
        ))}
      </div>

      <footer className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
        {p.status === "published" && !p.canEdit ? (
          <Button
            variant={p.myLiked ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            disabled={like.isPending}
            onClick={() => like.mutate(p.id, { onError: notifyError })}
            aria-pressed={p.myLiked}
            data-testid="news-like"
          >
            <Heart className={cn("size-4", p.myLiked && "fill-current")} aria-hidden />
            {t(p.myLiked ? "news.liked" : "news.like")}
            {p.likes > 0 && <span className="tabular-nums">· {p.likes}</span>}
          </Button>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
            data-testid="news-likes"
          >
            <Heart className="size-4" aria-hidden /> {t("news.likesCount", { count: p.likes })}
          </span>
        )}
        {p.views !== null && p.recipients !== null && p.status === "published" && (
          <span
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
            data-testid="news-article-views"
          >
            <Eye className="size-4" aria-hidden />{" "}
            {t("news.viewsOf", { views: p.views, recipients: p.recipients })}
          </span>
        )}
      </footer>

      {editing && <NewsEditorDialog post={p} onClose={() => setEditing(false)} />}
    </article>
  );
}
