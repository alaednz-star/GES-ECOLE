import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  useCreateLeave,
  useSetLeaveStatus,
  type EmployeeDetail,
  type LeaveRow,
} from "@/features/hr/hr";
import {
  LEAVE_TYPES,
  nextLeaveStatuses,
  validateLeaveDraft,
  type LeaveDraft,
  type LeaveField,
  type LeaveStatus,
  type LeaveType,
} from "@/features/hr/hr-model";
import { Field } from "@/features/hr/components/field";
import { errorCode } from "@/features/hr/hr-model";
import { formatDate, todayIso } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

const ACTION_KEY: Record<LeaveStatus, string> = {
  approved: "hr.leave.approve",
  rejected: "hr.leave.reject",
  cancelled: "hr.leave.cancel",
  pending: "hr.leave.status",
};

/** Same rule as `validate_employee_leave`, so the admin reads it in their language. */
function overlapsLive(
  draft: { startDate: string; endDate: string },
  leaves: readonly LeaveRow[],
): boolean {
  return leaves.some(
    (l) =>
      (l.status === "pending" || l.status === "approved") &&
      l.startDate <= draft.endDate &&
      draft.startDate <= l.endDate,
  );
}

export function LeavePanel({ employee }: { employee: EmployeeDetail }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useActionFeedback();
  const setStatus = useSetLeaveStatus();
  const [creating, setCreating] = useState(false);

  const decide = async (leave: LeaveRow, status: LeaveStatus) => {
    try {
      await setStatus.mutateAsync({ id: leave.id, status, actorId: user?.id ?? null });
      notifySuccess("hr.leave.statusChanged");
    } catch (e) {
      if (errorCode(e) === "23514") toast.error(t("hr.error.leaveOverlap"));
      else notifyError(e);
    }
  };

  return (
    <SectionCard
      title={t("hr.leave.title")}
      actions={
        <Button size="sm" className="rounded-xl" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          {t("hr.leave.new")}
        </Button>
      }
    >
      {employee.leaves.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hr.leave.none")}</p>
      ) : (
        <ul className="space-y-2">
          {employee.leaves.map((l) => (
            <li key={l.id} className="surface-row flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`hr.leaveType.${l.leaveType}`)}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatDate(l.startDate, locale)} → {formatDate(l.endDate, locale)}
                </p>
                {l.note && <p className="mt-1 text-xs text-muted-foreground">{l.note}</p>}
              </div>
              <StatusBadge status={l.status} />
              <div className="flex flex-wrap gap-1.5">
                {nextLeaveStatuses(l.status).map((to) => (
                  <Button
                    key={to}
                    size="sm"
                    variant={to === "approved" ? "default" : "outline"}
                    className={
                      to === "approved" ? "rounded-xl" : "rounded-xl text-muted-foreground"
                    }
                    disabled={setStatus.isPending}
                    onClick={() => void decide(l, to)}
                  >
                    {t(ACTION_KEY[to])}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <LeaveDialog employee={employee} onClose={() => setCreating(false)} />}
    </SectionCard>
  );
}

function LeaveDialog({ employee, onClose }: { employee: EmployeeDetail; onClose: () => void }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const create = useCreateLeave();
  const [draft, setDraft] = useState<LeaveDraft>({
    leaveType: "annual",
    startDate: todayIso(),
    endDate: todayIso(),
    note: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof LeaveDraft>(k: K, v: LeaveDraft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));
  const v = validateLeaveDraft(draft);
  const err = (f: LeaveField) =>
    !v.ok && submitted && v.errors[f] ? t(v.errors[f] as string) : null;
  const overlap = v.ok && overlapsLive(v.values, employee.leaves);

  const submit = async () => {
    setSubmitted(true);
    if (!v.ok || overlap) return;
    try {
      await create.mutateAsync({ employeeId: employee.id, ...v.values });
      notifySuccess("hr.leave.created");
      onClose();
    } catch (e) {
      if (errorCode(e) === "23514") toast.error(t("hr.error.leaveOverlap"));
      else notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">{t("hr.leave.new")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field id="lv-type" label={t("hr.leave.type")} error={err("leaveType")}>
            <Select value={draft.leaveType} onValueChange={(x) => set("leaveType", x as LeaveType)}>
              <SelectTrigger id="lv-type" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`hr.leaveType.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="lv-start" label={t("hr.leave.start")}>
              <Input
                id="lv-start"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </Field>
            <Field id="lv-end" label={t("hr.leave.end")}>
              <Input
                id="lv-end"
                type="date"
                dir="ltr"
                min={draft.startDate || undefined}
                className="h-11 rounded-xl"
                value={draft.endDate}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </Field>
          </div>
          {err("dates") && <p className="text-xs text-destructive">{err("dates")}</p>}
          {submitted && overlap && (
            <p className="text-xs text-destructive">{t("hr.error.leaveOverlap")}</p>
          )}
          <Field
            id="lv-note"
            label={`${t("hr.leave.note")} ${t("hr.field.optional")}`}
            hint={t("hr.leave.noteHint")}
            error={err("note")}
          >
            <Input
              id="lv-note"
              className="h-11 rounded-xl"
              value={draft.note}
              maxLength={500}
              onChange={(e) => set("note", e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
              {t("hr.cancelLabel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
