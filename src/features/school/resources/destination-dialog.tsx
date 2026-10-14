/**
 * Choosing where resources go: a move, or a duplicate.
 *
 * Reuses the Phase 2 rule rather than restating it -- GROUPE is the choice, MATIÈRE
 * is derived from it, CHAPITRE comes from a query scoped to that group. Moving and
 * duplicating are the two operations most able to scatter material into the wrong
 * course, so they get the same cascade as creation rather than a looser one.
 *
 * The server re-validates the pair regardless (`useBulkMoveResources` /
 * `useDuplicateResource` both re-read the chapter and compare its group), and
 * `resources_sync_group` derives `group_id` from the chapter afterwards. This dialog
 * is the part that stops the mistake being made, not the part that stops it landing.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/hooks/use-i18n";
import { useChaptersByGroup } from "./queries";
import type { GroupOption } from "./resource-dialogs";
import type { ResourceDestination } from "./types";

export function DestinationDialog({
  open,
  mode,
  count,
  groups,
  defaultGroupId,
  excludeChapterId,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean;
  /** Only the wording differs; the rule is identical. */
  mode: "move" | "duplicate";
  /** How many resources are being moved. 1 for a duplicate. */
  count: number;
  groups: GroupOption[];
  defaultGroupId?: string | undefined;
  /** The chapter they already sit in, offered but not preselected for a move. */
  excludeChapterId?: string | undefined;
  onOpenChange: (v: boolean) => void;
  onConfirm: (destination: ResourceDestination) => void;
  isPending: boolean;
}) {
  const { t } = useI18n();
  const [groupId, setGroupId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const chaptersQuery = useChaptersByGroup(open ? groupId || null : null);
  const chapters = useMemo(() => chaptersQuery.data ?? [], [chaptersQuery.data]);
  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);

  useEffect(() => {
    if (!open) return;
    setGroupId(defaultGroupId ?? "");
    setChapterId("");
    setError(null);
  }, [open, defaultGroupId]);

  const pickGroup = (id: string) => {
    setGroupId(id);
    // A chapter from the previous group would be exactly the wrong pairing.
    setChapterId("");
    setError(null);
  };

  const confirm = () => {
    if (!groupId) return setError(t("resources.hier.selectGroup"));
    if (!chapterId) return setError(t("resources.hier.selectChapter"));
    if (!chapters.some((c) => c.id === chapterId)) {
      return setError(t("resources.hier.selectChapter"));
    }
    onConfirm({ groupId, chapterId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(mode === "move" ? "resources.bulk.moveTitle" : "resources.resource.duplicate")}
          </DialogTitle>
          <DialogDescription>
            {t(
              mode === "move"
                ? "resources.bulk.moveDescription"
                : "resources.bulk.duplicateDescription",
              {
                count,
              },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 rounded-xl border border-border bg-muted/40 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="dest-group" className="text-xs font-semibold">
              {t("resources.hier.group")}
            </Label>
            <Select value={groupId} onValueChange={pickGroup}>
              <SelectTrigger id="dest-group" className="h-11 w-full rounded-xl bg-card">
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
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{t("resources.hier.subject")}</Label>
            <p className="truncate text-sm font-medium text-secondary-foreground">
              {groupId
                ? (group?.subjectName ?? t("resources.hier.noSubject"))
                : t("resources.hier.noGroupSelected")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dest-chapter" className="text-xs font-semibold">
              {t("resources.hier.chapter")}
            </Label>
            {!groupId ? (
              <p className="text-sm text-muted-foreground">{t("resources.hier.noGroupSelected")}</p>
            ) : chaptersQuery.isPending ? (
              <div className="h-11 animate-pulse rounded-xl bg-muted" />
            ) : chapters.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("resources.hier.noChapters")}</p>
            ) : (
              <Select value={chapterId} onValueChange={setChapterId}>
                <SelectTrigger id="dest-chapter" className="h-11 w-full rounded-xl bg-card">
                  <SelectValue placeholder={t("resources.hier.selectChapter")} />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                      {c.id === excludeChapterId ? ` — ${t("resources.bulk.currentChapter")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            {t("resources.dialog.cancel")}
          </Button>
          <Button type="button" className="rounded-xl" onClick={confirm} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t(mode === "move" ? "resources.bulk.move" : "resources.resource.duplicate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
