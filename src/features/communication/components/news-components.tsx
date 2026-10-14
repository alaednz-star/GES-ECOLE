/**
 * Actualités building blocks (SharePoint-style news, ADR-009): the cover, the category chip, the
 * cards (hero, side, grid) and the editor (draft, publish now, schedule).
 */

import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Eye, Heart, ImagePlus, Loader2, Pin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY_TONE, excerpt, isScheduled, newsErrors } from "../comm-model";
import {
  coverUrl,
  uploadCover,
  usePublishNews,
  useSaveNews,
  useSetDraftAudience,
} from "../queries";
import { NEWS_CATEGORIES, type Audience, type NewsCategory, type NewsPost } from "../types";
import { AudiencePicker } from "./audience-picker";

export function CategoryChip({
  category,
  className,
}: {
  category: NewsCategory;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        CATEGORY_TONE[category].chip,
        className,
      )}
    >
      {t(`news.category.${category}`)}
    </span>
  );
}

/** The image, or a category gradient with the initial letter when there is none. */
export function NewsCover({
  post,
  className,
  children,
}: {
  post: Pick<NewsPost, "coverPath" | "category" | "title">;
  className?: string;
  children?: ReactNode;
}) {
  const url = coverUrl(post.coverPath);
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {url ? (
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 grid place-items-center bg-gradient-to-br",
            CATEGORY_TONE[post.category].cover,
          )}
        >
          <span className="text-6xl font-black text-white/25">
            {post.title.trim().charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

function Meta({ post }: { post: NewsPost }) {
  const { t, locale } = useI18n();
  const now = new Date().toISOString();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{post.authorName ?? "—"}</span>
      <span>
        {post.status === "draft"
          ? t("news.draft")
          : isScheduled(post, now)
            ? t("news.scheduledFor", { date: formatDateTime(post.publishAt as string, locale) })
            : formatDate(post.publishAt as string, locale)}
      </span>
      {post.likes > 0 && (
        <span className="inline-flex items-center gap-1">
          <Heart className="size-3" aria-hidden /> {post.likes}
        </span>
      )}
      {post.views !== null && post.recipients !== null && post.status === "published" && (
        <span className="inline-flex items-center gap-1" data-testid="news-views">
          <Eye className="size-3" aria-hidden /> {post.views}/{post.recipients}
        </span>
      )}
    </div>
  );
}

export function NewsCard({ post, variant }: { post: NewsPost; variant: "hero" | "side" | "grid" }) {
  const { t } = useI18n();
  const unread = post.status === "published" && !post.myRead && !post.canEdit;
  const link = { to: "/dashboard/news/$postId" as const, params: { postId: post.id } };

  if (variant === "hero") {
    return (
      <Link {...link} className="group block h-full" data-testid="news-hero" data-post={post.id}>
        <NewsCover post={post} className="h-72 rounded-2xl sm:h-full sm:min-h-80">
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 space-y-2 p-5 text-white sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryChip category={post.category} className="bg-white/90" />
              {post.pinned && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-white/90">
                  <Pin className="size-3" aria-hidden /> {t("news.pinned")}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold leading-tight tracking-tight group-hover:underline sm:text-3xl">
              {post.title}
            </h2>
            <p className="line-clamp-2 max-w-2xl text-sm text-white/85">{excerpt(post, 200)}</p>
            <p className="text-xs text-white/75">
              {post.authorName ?? "—"}
              {unread && (
                <span className="ms-2 rounded-full bg-white px-2 py-0.5 font-semibold text-primary">
                  {t("news.new")}
                </span>
              )}
            </p>
          </div>
        </NewsCover>
      </Link>
    );
  }

  if (variant === "side") {
    return (
      <Link
        {...link}
        className="group flex gap-3 rounded-2xl p-2 transition-colors hover:bg-muted/60"
        data-testid="news-side"
        data-post={post.id}
      >
        <NewsCover post={post} className="h-20 w-28 shrink-0 rounded-xl" />
        <div className="min-w-0 space-y-1">
          <CategoryChip category={post.category} />
          <p className="line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">
            {post.title}
            {unread && (
              <span
                className="ms-1.5 inline-block size-2 rounded-full bg-primary align-middle"
                aria-label={t("news.new")}
              />
            )}
          </p>
          <Meta post={post} />
        </div>
      </Link>
    );
  }

  return (
    <Link
      {...link}
      className="surface-card group flex h-full flex-col overflow-hidden p-0 transition-shadow hover:shadow-md"
      data-testid="news-card"
      data-post={post.id}
    >
      <NewsCover post={post} className="h-36 w-full">
        {post.status === "draft" && (
          <span className="absolute start-3 top-3 rounded-full bg-background/90 px-2.5 py-0.5 text-xs font-semibold">
            {t("news.draft")}
          </span>
        )}
      </NewsCover>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <CategoryChip category={post.category} />
          {post.pinned && (
            <Pin className="size-3.5 text-muted-foreground" aria-label={t("news.pinned")} />
          )}
          {unread && <span className="size-2 rounded-full bg-primary" aria-label={t("news.new")} />}
        </div>
        <p className="line-clamp-2 font-semibold leading-snug group-hover:underline">
          {post.title}
        </p>
        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">{excerpt(post)}</p>
        <Meta post={post} />
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ editor */

type PublishMode = "now" | "schedule" | "draft";

export function NewsEditorDialog({
  post,
  onClose,
}: {
  post: NewsPost | null;
  onClose: (savedId?: string) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveNews();
  const setAudience = useSetDraftAudience();
  const publish = usePublishNews();
  const fileRef = useRef<HTMLInputElement>(null);
  const published = post?.status === "published";

  const [form, setForm] = useState({
    title: post?.title ?? "",
    summary: post?.summary ?? "",
    body: post?.body ?? "",
    category: (post?.category ?? "general") as NewsCategory,
    coverPath: post?.coverPath ?? null,
    pinned: post?.pinned ?? false,
    audience: (post
      ? { type: post.audienceType, id: post.audienceId }
      : { type: isAdmin ? "everyone" : "group", id: null }) as Audience,
    mode: "now" as PublishMode,
    scheduleAt: "",
  });
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const errors = newsErrors(form);
  const scheduleError =
    form.mode === "schedule" &&
    (!form.scheduleAt || new Date(form.scheduleAt).getTime() <= Date.now())
      ? "news.error.schedule"
      : null;
  const busy = save.isPending || publish.isPending || setAudience.isPending || uploading;

  async function submit() {
    setSubmitted(true);
    if (Object.keys(errors).length || scheduleError) return;
    try {
      const id = await save.mutateAsync({
        ...(post ? { id: post.id } : {}),
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        body: form.body.trim(),
        category: form.category,
        coverPath: form.coverPath,
        audience: form.audience,
        pinned: isAdmin && form.pinned,
      });
      if (
        post &&
        !published &&
        (post.audienceType !== form.audience.type || post.audienceId !== form.audience.id)
      ) {
        await setAudience.mutateAsync({ id, audience: form.audience });
      }
      if (!published && form.mode !== "draft") {
        const n = await publish.mutateAsync({
          id,
          publishAt: form.mode === "schedule" ? new Date(form.scheduleAt).toISOString() : null,
        });
        notifySuccess(form.mode === "schedule" ? "news.scheduledToast" : "news.publishedToast", {
          count: n,
        });
      } else {
        notifySuccess("news.savedToast");
      }
      onClose(id);
    } catch (e) {
      notifyError(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(post ? "news.editTitle" : "news.addTitle")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* Cover */}
          <div className="space-y-1.5">
            <Label>{t("news.cover")}</Label>
            <NewsCover
              post={{
                coverPath: form.coverPath,
                category: form.category,
                title: form.title || "A",
              }}
              className="h-36 rounded-xl"
            >
              <div className="absolute end-2 top-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="rounded-lg"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  data-testid="news-cover-upload"
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus className="size-4" aria-hidden />
                  )}
                  {t(form.coverPath ? "news.coverChange" : "news.coverAdd")}
                </Button>
                {form.coverPath && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="size-8 rounded-lg"
                    aria-label={t("news.coverRemove")}
                    onClick={() => setForm({ ...form, coverPath: null })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            </NewsCover>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              data-testid="news-cover-input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploading(true);
                try {
                  const path = await uploadCover(file);
                  setForm((f) => ({ ...f, coverPath: path }));
                } catch (err) {
                  notifyError(
                    err instanceof Error && err.message.startsWith("news.")
                      ? { message: t(err.message) }
                      : err,
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
            <p className="text-xs text-muted-foreground">{t("news.coverHint")}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-1.5">
              <Label htmlFor="news-title">{t("news.titleLabel")}</Label>
              <Input
                id="news-title"
                className="h-11 rounded-xl"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                data-testid="news-title"
              />
              {submitted && errors.title && (
                <p className="text-xs text-destructive">{t(errors.title)}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("news.categoryLabel")}</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  v && v !== form.category && setForm({ ...form, category: v as NewsCategory })
                }
              >
                <SelectTrigger className="h-11 rounded-xl" data-testid="news-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NEWS_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`news.category.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="news-summary">{t("news.summaryLabel")}</Label>
            <Input
              id="news-summary"
              className="h-11 rounded-xl"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              data-testid="news-summary"
            />
            {submitted && errors.summary && (
              <p className="text-xs text-destructive">{t(errors.summary)}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="news-body">{t("news.bodyLabel")}</Label>
            <Textarea
              id="news-body"
              rows={8}
              className="rounded-xl"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              data-testid="news-body"
            />
            <p className="text-xs text-muted-foreground">{t("news.bodyHint")}</p>
            {submitted && errors.body && (
              <p className="text-xs text-destructive">{t(errors.body)}</p>
            )}
          </div>

          <AudiencePicker
            value={form.audience}
            onChange={(a) => setForm({ ...form, audience: a })}
            disabled={published}
            error={submitted ? errors.audience : undefined}
            idPrefix="news-audience"
          />
          {published && (
            <p className="-mt-2 text-xs text-muted-foreground">{t("news.audienceLocked")}</p>
          )}

          {isAdmin && (
            <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
              <Switch
                checked={form.pinned}
                onCheckedChange={(v) => setForm({ ...form, pinned: v })}
                data-testid="news-pinned"
              />
              <span>
                <span className="font-medium">{t("news.pinLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("news.pinHint")}</span>
              </span>
            </label>
          )}

          {!published && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t("news.when")}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["now", "schedule", "draft"] as const).map((m) => (
                  <label
                    key={m}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                      form.mode === m
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="news-mode"
                      className="sr-only"
                      checked={form.mode === m}
                      onChange={() => setForm({ ...form, mode: m })}
                      data-testid={`news-mode-${m}`}
                    />
                    {m === "schedule" && <CalendarClock className="size-4" aria-hidden />}
                    {t(`news.mode.${m}`)}
                  </label>
                ))}
              </div>
              {form.mode === "schedule" && (
                <Input
                  type="datetime-local"
                  dir="ltr"
                  className="h-11 rounded-xl"
                  value={form.scheduleAt}
                  onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })}
                  data-testid="news-schedule"
                />
              )}
              {submitted && scheduleError && (
                <p className="text-xs text-destructive">{t(scheduleError)}</p>
              )}
            </fieldset>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => onClose()}
              disabled={busy}
            >
              {t("comm.cancel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={busy} data-testid="news-save">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t(
                published || form.mode === "draft"
                  ? "comm.save"
                  : form.mode === "schedule"
                    ? "news.schedule"
                    : "news.publish",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
