/**
 * Administration enrollment dialogs (ADR-004 section 4), used from a group's page and from a
 * single-group formation's page.
 *
 *   EnrollStudentDialog   find an existing student (server-side search, capped) and place them
 *                         in the group -- or approve the request they already sent.
 *   WithdrawDialog        end a student's place: the registration becomes `withdrawn`; nothing
 *                         is deleted (attendance and payments stay), and they can come back.
 *
 * The database decides every case (capacity, one active registration per group, one per subject
 * and level, the lifecycle); the dialogs show the facts first and name the reason when it says
 * no (`enrollmentProblem`). Creating a NEW student is the student-management phase (ADR-004
 * section 5); until then a new student signs up through the registration link.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Link2, Loader2, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/common/status-badge";
import {
  useEnrollStudent,
  useGroupRegistrations,
  useStudentSearch,
  useWithdrawRegistration,
  type StudentMatch,
} from "@/features/school/queries";
import { isActiveStatus } from "@/features/school/registration-model";
import { useEnrollmentErrors } from "@/features/school/use-enrollment-errors";
import { placesLeft } from "@/features/school/group-model";
import type { RegistrationRow } from "@/features/school/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { publicUrl } from "@/lib/desktop";

export interface EnrollTarget {
  id: string;
  name: string;
  maxStudents: number;
  enrolled: number;
}

export function EnrollStudentDialog({
  group,
  onClose,
}: {
  group: EnrollTarget;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess } = useActionFeedback();
  const showError = useEnrollmentErrors();
  const enroll = useEnrollStudent();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<StudentMatch | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(id);
  }, [term]);

  const search = useStudentSearch(debounced);
  // Who is already in or waiting in THIS group (bounded to the group; shared cache).
  const groupRegs = useGroupRegistrations(group.id);
  const left = placesLeft(group);
  const full = group.maxStudents > 0 && left === 0;

  // The student's ACTIVE registration in this group, if any (at most one, by constraint).
  const activeHere = useMemo(() => {
    const m = new Map<string, RegistrationRow>();
    for (const r of groupRegs.data?.rows ?? []) if (isActiveStatus(r.status)) m.set(r.studentId, r);
    return m;
  }, [groupRegs.data]);

  const selectedActive = selected ? (activeHere.get(selected.id) ?? null) : null;
  const alreadyEnrolled = selectedActive?.status === "approved";
  const pendingHere = selectedActive?.status === "pending" ? selectedActive : null;

  const submit = async () => {
    if (!selected || alreadyEnrolled) return;
    try {
      await enroll.mutateAsync({
        groupId: group.id,
        studentId: selected.id,
        pendingRegistrationId: pendingHere?.id ?? null,
      });
      notifySuccess("enroll.done", { name: selected.fullName, group: group.name });
      onClose();
    } catch (e) {
      showError(e, group.name);
    }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl("/register"));
      notifySuccess("entity.students.inviteLinkCopied");
    } catch {
      toast.error(t("entity.common.copyFail"));
    }
  };

  const results = search.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && !enroll.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-start">{t("enroll.title")}</DialogTitle>
          <DialogDescription className="text-start">
            {group.name} ·{" "}
            <span
              className={cn("tabular-nums", full && "text-destructive")}
              data-testid="enroll-capacity"
            >
              {full
                ? t("enroll.full")
                : t("enroll.placesLeft", { count: left, seats: group.maxStudents })}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="enroll-search">{t("enroll.searchLabel")}</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="enroll-search"
                autoFocus
                className="h-11 rounded-xl ps-9"
                placeholder={t("enroll.searchPlaceholder")}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setSelected(null);
                }}
              />
            </div>
          </div>

          {debounced.trim().length < 2 ? (
            <p className="text-xs text-muted-foreground">{t("enroll.typeToSearch")}</p>
          ) : search.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : results.length === 0 ? (
            <div className="surface-row space-y-2 px-3 py-3 text-sm">
              <p className="font-medium">{t("enroll.noMatch")}</p>
              <p className="text-xs text-muted-foreground">{t("enroll.newStudentHint")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={copyInviteLink}
              >
                <Link2 className="size-3.5" aria-hidden />
                {t("entity.students.copyInviteLink")}
              </Button>
            </div>
          ) : (
            <ul className="space-y-1.5" aria-label={t("enroll.results")}>
              {results.map((s) => {
                const here = activeHere.get(s.id);
                const isSelected = selected?.id === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(s)}
                      aria-pressed={isSelected}
                      className={cn(
                        "focus-ring surface-row flex w-full items-center gap-3 px-3 py-2.5 text-start",
                        isSelected && "ring-2 ring-primary",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[s.levelName, s.email ?? s.phone].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      {here ? (
                        <StatusBadge status={here.status} />
                      ) : s.status !== "active" ? (
                        <StatusBadge status={s.status} />
                      ) : null}
                      {isSelected && <Check className="size-4 text-primary" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected && (
            <div className="surface-row space-y-1 px-3 py-3 text-sm" data-testid="enroll-summary">
              <p className="font-medium">{selected.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {alreadyEnrolled
                  ? t("enroll.alreadyHere")
                  : pendingHere
                    ? t("enroll.pendingHere")
                    : !selected.onboarded
                      ? t("enroll.notOnboarded")
                      : t("enroll.willEnroll", { group: group.name })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={onClose}
            disabled={enroll.isPending}
          >
            {t("entity.common.cancel")}
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            onClick={() => void submit()}
            disabled={!selected || alreadyEnrolled || full || enroll.isPending}
          >
            {enroll.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="size-4" aria-hidden />
            )}
            {pendingHere ? t("enroll.approveRequest") : t("enroll.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawDialog({
  registration,
  groupName,
  onClose,
}: {
  registration: Pick<RegistrationRow, "id" | "studentName">;
  groupName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess } = useActionFeedback();
  const showError = useEnrollmentErrors();
  const withdraw = useWithdrawRegistration();
  const [reason, setReason] = useState("");

  const submit = async () => {
    try {
      await withdraw.mutateAsync({ id: registration.id, reason: reason.trim() || null });
      notifySuccess("withdraw.done", { name: registration.studentName });
      onClose();
    } catch (e) {
      showError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !withdraw.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">{t("withdraw.title")}</DialogTitle>
          <DialogDescription className="text-start">
            {t("withdraw.body", { name: registration.studentName, group: groupName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="withdraw-reason">{t("withdraw.reason")}</Label>
          <Textarea
            id="withdraw-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("withdraw.reasonHint")}</p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={onClose}
            disabled={withdraw.isPending}
          >
            {t("entity.common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="rounded-xl"
            onClick={() => void submit()}
            disabled={withdraw.isPending}
          >
            {withdraw.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("withdraw.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
