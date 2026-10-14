import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import type { DependencyRow } from "@/features/teachers/provisioning.functions";
import { deletionBlockers, preservedRecords } from "@/features/teachers/dependency-model";
import type { TeacherAction } from "./teacher-actions-menu";

/** Destructive actions that need confirmation. */
export type ConfirmableAction = Extract<
  TeacherAction,
  "suspend" | "reactivate" | "archive" | "restore" | "delete" | "resetPassword"
>;

/**
 * One dialog for every lifecycle transition.
 *
 * Each action states what WILL happen and, just as importantly, what will NOT:
 * the common fear is that suspending a teacher destroys their history, so the
 * dialog says plainly that it does not.
 *
 * For `delete` it also shows the live dependency list. The action is disabled
 * while anything blocks it, and the reason is named -- an admin should never be
 * left guessing why a button does nothing.
 */
export function LifecycleDialog({
  action,
  teacherName,
  dependencies,
  loadingDependencies,
  pending,
  onConfirm,
  onCancel,
}: {
  action: ConfirmableAction | null;
  teacherName: string;
  dependencies: DependencyRow[] | null;
  loadingDependencies: boolean;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");

  // Never carry a reason from one action to the next.
  useEffect(() => {
    setReason("");
  }, [action]);

  if (!action) return null;

  const isDelete = action === "delete";
  // Both lists come from `dependency-model.ts`, which the server function deleting the
  // account also uses -- so the button cannot be disabled for a reason the server would have
  // allowed, nor enabled for one it would refuse.
  const blockers = deletionBlockers(dependencies);
  const preserved = preservedRecords(dependencies);
  const blocked = isDelete && (loadingDependencies || blockers.length > 0);

  // Which reassurances matter differs per action; listing irrelevant ones
  // dilutes the message.
  const effects: { kind: "will" | "wont"; key: string }[] =
    action === "suspend"
      ? [
          { kind: "will", key: "lifecycle.effect.blocksLogin" },
          { kind: "wont", key: "lifecycle.effect.keepsGroups" },
          { kind: "wont", key: "lifecycle.effect.keepsAttendance" },
          { kind: "wont", key: "lifecycle.effect.keepsAudit" },
        ]
      : action === "archive"
        ? [
            { kind: "will", key: "lifecycle.effect.blocksLogin" },
            { kind: "will", key: "lifecycle.effect.hidesFromLists" },
            { kind: "wont", key: "lifecycle.effect.keepsReports" },
            { kind: "wont", key: "lifecycle.effect.keepsAttendance" },
          ]
        : action === "reactivate" || action === "restore"
          ? [
              { kind: "will", key: "lifecycle.effect.restoresLogin" },
              { kind: "will", key: "lifecycle.effect.showsInLists" },
            ]
          : action === "resetPassword"
            ? [
                { kind: "will", key: "lifecycle.effect.newTempPassword" },
                { kind: "will", key: "lifecycle.effect.forcesChange" },
                { kind: "wont", key: "lifecycle.effect.keepsEverythingElse" },
              ]
            : [
                { kind: "will", key: "lifecycle.effect.permanent" },
                { kind: "will", key: "lifecycle.effect.removesLogin" },
                { kind: "wont", key: "lifecycle.effect.auditSurvives" },
              ];

  return (
    <AlertDialog open onOpenChange={(next) => !next && !pending && onCancel()}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`lifecycle.${action}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(`lifecycle.${action}.body`, { name: teacherName })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="space-y-2 rounded-xl bg-muted/50 px-4 py-3 text-sm">
          {effects.map((e) => (
            <li key={e.key} className="flex items-start gap-2">
              {e.kind === "will" ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className={e.kind === "wont" ? "text-muted-foreground" : undefined}>
                {t(e.key)}
              </span>
            </li>
          ))}
        </ul>

        {isDelete && (
          <div className="space-y-2">
            {loadingDependencies ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("lifecycle.checkingDependencies")}
              </p>
            ) : blockers.length > 0 ? (
              <div
                role="alert"
                className="space-y-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {t("lifecycle.delete.blocked")}
                </p>
                <ul className="ms-6 list-disc space-y-1">
                  {blockers.map((b) => (
                    <li key={b.sourceTable}>
                      {t(`lifecycle.dependency.${b.sourceTable}`, { count: String(b.rowCount) })}
                    </li>
                  ))}
                </ul>
                <p className="ms-6 text-xs">{t("lifecycle.delete.archiveInstead")}</p>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
                <p>{t("lifecycle.delete.safe")}</p>
                {/* The list above promises the audit trail is kept. Naming the entries that
                    will be kept turns that promise into something the administrator can see --
                    and these same rows used to be the reason deletion was refused. */}
                {preserved.length > 0 && (
                  <>
                    <p className="font-medium">{t("lifecycle.delete.preserved")}</p>
                    <ul className="ms-6 list-disc space-y-1">
                      {preserved.map((d) => (
                        <li key={d.sourceTable}>
                          {t(`lifecycle.dependency.${d.sourceTable}`, {
                            count: String(d.rowCount),
                          })}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {(action === "suspend" || action === "archive") && (
          <div className="space-y-2">
            <Label htmlFor="lifecycle-reason">
              {t("lifecycle.reason")}{" "}
              <span className="font-normal text-muted-foreground">{t("onboarding.optional")}</span>
            </Label>
            <Input
              id="lifecycle-reason"
              className="h-11 rounded-xl"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("lifecycle.reasonPlaceholder")}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="ghost" className="rounded-xl" disabled={pending}>
              {t("entity.common.cancel")}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              className="rounded-xl"
              variant={isDelete ? "destructive" : "default"}
              disabled={pending || blocked}
              onClick={(e) => {
                e.preventDefault();
                onConfirm(reason.trim());
              }}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t(`lifecycle.${action}.confirm`)}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
