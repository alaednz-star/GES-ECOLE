/**
 * Deleting a chapter that still holds resources.
 *
 * `resources.chapter_id` cascades, so the bare delete takes the files with it. That
 * is occasionally what a teacher wants and occasionally a disaster, and a browser
 * `confirm()` cannot tell the two apart -- it offers OK and Cancel for a question
 * with three answers. So the third one is offered explicitly: keep the resources and
 * move them to "Non classé".
 *
 * An empty chapter skips straight to a plain confirmation; there is nothing to lose.
 */

import { AlertTriangle, FolderInput, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import type { ChapterRow } from "./types";

export function ChapterDeleteDialog({
  chapter,
  onCancel,
  onConfirm,
  isPending,
}: {
  /** Null closes the dialog. */
  chapter: ChapterRow | null;
  onCancel: () => void;
  onConfirm: (chapter: ChapterRow, resources: "cascade" | "unfile") => void;
  isPending: boolean;
}) {
  const { t } = useI18n();
  const count = chapter?.resources.length ?? 0;

  return (
    <AlertDialog open={chapter !== null} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
            {t("resources.chapter.delete")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {chapter?.title}
            {count > 0 && (
              <>
                {" — "}
                <span className="font-medium text-foreground">
                  {t("resources.chapter.deleteHasResources", { count })}
                </span>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          {count > 0 && (
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start rounded-xl px-3 py-2.5 text-start"
              disabled={isPending}
              onClick={() => chapter && onConfirm(chapter, "unfile")}
            >
              <FolderInput className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {t("resources.chapter.deleteKeepResources", { count })}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {t("resources.chapter.deleteKeepHint")}
                </span>
              </span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start rounded-xl border-destructive/30 px-3 py-2.5 text-start text-destructive hover:bg-destructive/5 hover:text-destructive"
            disabled={isPending}
            onClick={() => chapter && onConfirm(chapter, "cascade")}
          >
            <Trash2 className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {count > 0
                  ? t("resources.chapter.deleteWithResources", { count })
                  : t("resources.chapter.deleteEmpty")}
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                {t("resources.chapter.deleteIrreversible")}
              </span>
            </span>
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">
            {t("resources.dialog.cancel")}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
