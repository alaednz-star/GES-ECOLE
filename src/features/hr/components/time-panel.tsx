import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorState } from "@/components/common/error-state";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDeleteStaffAttendance,
  useSaveStaffAttendance,
  useStaffAttendance,
  type EmployeeDetail,
  type StaffAttendanceRow,
} from "@/features/hr/hr";
import {
  STAFF_ATTENDANCE_STATUSES,
  addDays,
  formatMinutes,
  validateStaffAttendanceDraft,
  type StaffAttendanceDraft,
  type StaffAttendanceField,
  type StaffAttendanceStatus,
} from "@/features/hr/hr-model";
import { Field } from "@/features/hr/components/field";
import { errorCode } from "@/features/hr/hr-model";
import { exportCsv } from "@/lib/export-csv";
import { formatDate, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

function monthWindow(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(nextMonth, -1) };
}

/**
 * Working time of the day (check-in / check-out). Separate from students' session attendance:
 * a teacher may teach 09:00-11:00 and work 08:30-12:00.
 */
export function TimePanel({ employee }: { employee: EmployeeDetail }) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const { from, to } = monthWindow(month);
  const records = useStaffAttendance(employee.id, from, to);
  const remove = useDeleteStaffAttendance();
  const [form, setForm] = useState<{ row: StaffAttendanceRow | null } | null>(null);
  const [deleting, setDeleting] = useState<StaffAttendanceRow | null>(null);

  const rows = records.data ?? [];
  const total = rows.reduce((s, r) => s + (r.workedMinutes ?? 0), 0);

  const exportMonth = () =>
    exportCsv(
      `hr-time-${(employee.fullName ?? employee.id).replace(/\s+/g, "-")}-${month}.csv`,
      rows.map((r) => ({
        [t("hr.time.date")]: r.workDate,
        [t("hr.time.status")]: t(`ui.status.${r.status}`),
        [t("hr.time.checkIn")]: r.checkIn ?? "",
        [t("hr.time.checkOut")]: r.checkOut ?? "",
        [t("hr.time.worked")]: r.workedMinutes != null ? formatMinutes(r.workedMinutes) : "",
        [t("hr.time.note")]: r.note ?? "",
      })),
    );

  return (
    <SectionCard
      title={t("hr.time.title")}
      description={t("hr.time.hint")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            dir="ltr"
            aria-label={t("hr.time.month")}
            className="h-9 w-40 rounded-xl"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={exportMonth}
            disabled={rows.length === 0}
          >
            <Download className="size-4" aria-hidden />
            {t("hr.time.export")}
          </Button>
          <Button size="sm" className="rounded-xl" onClick={() => setForm({ row: null })}>
            <Plus className="size-4" aria-hidden />
            {t("hr.time.new")}
          </Button>
        </div>
      }
    >
      {records.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      ) : records.error ? (
        <ErrorState error={records.error} onRetry={() => void records.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hr.time.none")}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="surface-row flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-24 shrink-0 text-sm font-medium tabular-nums">
                  {formatDate(r.workDate, locale)}
                </span>
                <StatusBadge status={r.status} />
                <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">
                  {r.checkIn ?? "—"} – {r.checkOut ?? "—"}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {r.workedMinutes != null ? formatMinutes(r.workedMinutes) : ""}
                </span>
                {r.note && (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {r.note}
                  </span>
                )}
                <span className="ms-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg"
                    aria-label={t("hr.time.editTitle")}
                    onClick={() => setForm({ row: r })}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-destructive"
                    aria-label={t("hr.time.deleteTitle")}
                    onClick={() => setDeleting(r)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("hr.time.total", { hours: formatMinutes(total), count: rows.length })}
          </p>
        </>
      )}

      {form && <TimeDialog employeeId={employee.id} row={form.row} onClose={() => setForm(null)} />}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && !remove.isPending && setDeleting(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">{t("hr.time.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {deleting && t("hr.time.deleteBody", { date: formatDate(deleting.workDate, locale) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-xl" disabled={remove.isPending}>
              {t("hr.cancelLabel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleting) return;
                try {
                  await remove.mutateAsync(deleting.id);
                  notifySuccess("hr.time.deleted");
                  setDeleting(null);
                } catch (err) {
                  notifyError(err);
                }
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.documents.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function TimeDialog({
  employeeId,
  row,
  onClose,
}: {
  employeeId: string;
  row: StaffAttendanceRow | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveStaffAttendance();
  const today = todayIso();
  const [draft, setDraft] = useState<StaffAttendanceDraft>({
    workDate: row?.workDate ?? today,
    status: row?.status ?? "present",
    checkIn: row?.checkIn ?? "",
    checkOut: row?.checkOut ?? "",
    note: row?.note ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof StaffAttendanceDraft>(k: K, v: StaffAttendanceDraft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));
  const away = draft.status === "absent" || draft.status === "leave";
  const v = validateStaffAttendanceDraft(draft, today);
  const err = (f: StaffAttendanceField) =>
    !v.ok && submitted && v.errors[f] ? t(v.errors[f] as string) : null;

  const submit = async () => {
    setSubmitted(true);
    if (!v.ok) return;
    try {
      await save.mutateAsync({ employeeId, ...(row ? { id: row.id } : {}), ...v.values });
      notifySuccess("hr.time.saved");
      onClose();
    } catch (e) {
      if (errorCode(e) === "23505") toast.error(t("hr.time.duplicate"));
      else notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(row ? "hr.time.editTitle" : "hr.time.new")}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tm-date" label={t("hr.time.date")} error={err("workDate")}>
              <Input
                id="tm-date"
                type="date"
                dir="ltr"
                max={today}
                className="h-11 rounded-xl"
                value={draft.workDate}
                onChange={(e) => set("workDate", e.target.value)}
              />
            </Field>
            <Field id="tm-status" label={t("hr.time.status")}>
              <Select
                value={draft.status}
                onValueChange={(x) => {
                  const status = x as StaffAttendanceStatus;
                  // Absent/leave carry no times: clear them so the form matches the rule.
                  setDraft((p) => ({
                    ...p,
                    status,
                    ...(status === "absent" || status === "leave"
                      ? { checkIn: "", checkOut: "" }
                      : {}),
                  }));
                }}
              >
                <SelectTrigger id="tm-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ATTENDANCE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`ui.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="tm-in" label={t("hr.time.checkIn")}>
              <Input
                id="tm-in"
                type="time"
                dir="ltr"
                disabled={away}
                className="h-11 rounded-xl"
                value={draft.checkIn}
                onChange={(e) => set("checkIn", e.target.value)}
              />
            </Field>
            <Field id="tm-out" label={`${t("hr.time.checkOut")} ${t("hr.field.optional")}`}>
              <Input
                id="tm-out"
                type="time"
                dir="ltr"
                disabled={away}
                className="h-11 rounded-xl"
                value={draft.checkOut}
                onChange={(e) => set("checkOut", e.target.value)}
              />
            </Field>
          </div>
          {err("times") && <p className="text-xs text-destructive">{err("times")}</p>}
          <Field
            id="tm-note"
            label={`${t("hr.time.note")} ${t("hr.field.optional")}`}
            error={err("note")}
          >
            <Input
              id="tm-note"
              className="h-11 rounded-xl"
              value={draft.note}
              maxLength={500}
              onChange={(e) => set("note", e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("hr.cancelLabel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
