import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useUpdateEmployee, type EmployeeDetail } from "@/features/hr/hr";
import {
  EMPLOYMENT_STATUSES,
  STAFF_TYPES,
  validateEmployeeDraft,
  type EmployeeDraft,
  type EmployeeField,
  type EmploymentStatus,
  type StaffType,
} from "@/features/hr/hr-model";
import { Detail, Field } from "@/features/hr/components/field";
import { errorCode } from "@/features/hr/hr-model";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export function OverviewPanel({ employee }: { employee: EmployeeDetail }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const none = t("hr.none");
  const d = (v: string | null) => (v ? formatDate(v, locale) : none);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard
        title={t("hr.overview.employment")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" aria-hidden />
            {t("hr.overview.edit")}
          </Button>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <Detail label={t("hr.field.staffType")}>{t(`hr.staffType.${employee.staffType}`)}</Detail>
          <Detail label={t("hr.field.status")}>
            <StatusBadge status={employee.employmentStatus} />
          </Detail>
          <Detail label={t("hr.field.position")}>{employee.position ?? none}</Detail>
          <Detail label={t("hr.field.department")}>{employee.department ?? none}</Detail>
          <Detail label={t("hr.field.code")}>
            <span dir="ltr">{employee.employeeCode ?? none}</span>
          </Detail>
          <Detail label={t("hr.field.startDate")}>
            <span className="tabular-nums">{d(employee.startDate)}</span>
          </Detail>
          <Detail label={t("hr.field.endDate")}>
            <span className="tabular-nums">{d(employee.endDate)}</span>
          </Detail>
          <Detail label={t("hr.field.notes")}>
            <span className="whitespace-pre-line">{employee.notes ?? none}</span>
          </Detail>
        </dl>
      </SectionCard>

      <div className="space-y-4">
        <SectionCard title={t("hr.overview.personal")} description={t("hr.overview.personalHint")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <Detail label={t("hr.field.email")}>
              <span dir="ltr">{employee.email ?? none}</span>
            </Detail>
            <Detail label={t("hr.field.phone")}>
              <span dir="ltr">{employee.phone ?? none}</span>
            </Detail>
            <Detail label={t("hr.field.address")}>{employee.address ?? none}</Detail>
            <Detail label={t("hr.field.dateOfBirth")}>
              <span className="tabular-nums">{d(employee.dateOfBirth)}</span>
            </Detail>
            <Detail label={t("hr.field.emergency")}>
              {employee.emergencyContactName || employee.emergencyContactPhone ? (
                <>
                  {employee.emergencyContactName ?? ""}{" "}
                  <span dir="ltr" className="text-muted-foreground">
                    {employee.emergencyContactPhone ?? ""}
                  </span>
                </>
              ) : (
                none
              )}
            </Detail>
          </dl>
        </SectionCard>

        <SectionCard title={t("hr.overview.account")} description={t("hr.overview.accountHint")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <Detail label={t("hr.overview.roles")}>
              {employee.roles.map((r) => t(`hr.role.${r}`)).join(", ") || none}
            </Detail>
            {employee.teacherStatus && (
              <Detail label={t("hr.overview.teacherStatus")}>
                <StatusBadge status={employee.teacherStatus} />
              </Detail>
            )}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {employee.roles.includes("teacher") && (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link
                  to="/dashboard/teachers/$teacherId"
                  params={{ teacherId: employee.profileId }}
                >
                  {t("hr.overview.manageTeacher")}
                </Link>
              </Button>
            )}
            {employee.roles.includes("admin") && (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link to="/dashboard/users">{t("hr.overview.manageUsers")}</Link>
              </Button>
            )}
          </div>
        </SectionCard>
      </div>

      {editing && <EmployeeEditDialog employee={employee} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EmployeeEditDialog({
  employee,
  onClose,
}: {
  employee: EmployeeDetail;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const update = useUpdateEmployee();
  const [draft, setDraft] = useState<EmployeeDraft>({
    staffType: employee.staffType,
    employmentStatus: employee.employmentStatus,
    position: employee.position ?? "",
    department: employee.department ?? "",
    employeeCode: employee.employeeCode ?? "",
    startDate: employee.startDate,
    endDate: employee.endDate ?? "",
    address: employee.address ?? "",
    dateOfBirth: employee.dateOfBirth ?? "",
    emergencyContactName: employee.emergencyContactName ?? "",
    emergencyContactPhone: employee.emergencyContactPhone ?? "",
    notes: employee.notes ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof EmployeeDraft>(k: K, v: EmployeeDraft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));
  const v = validateEmployeeDraft(draft);
  const err = (f: EmployeeField) =>
    !v.ok && submitted && v.errors[f] ? t(v.errors[f] as string) : null;
  const opt = t("hr.field.optional");

  const submit = async () => {
    setSubmitted(true);
    if (!v.ok) return;
    try {
      await update.mutateAsync({ id: employee.id, ...v.values });
      notifySuccess("hr.saved");
      onClose();
    } catch (e) {
      if (errorCode(e) === "23505") toast.error(t("hr.error.codeTaken"));
      else notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-start">{t("hr.overview.editTitle")}</DialogTitle>
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
            <Field id="emp-type" label={t("hr.field.staffType")}>
              <Select
                value={draft.staffType}
                onValueChange={(x) => set("staffType", x as StaffType)}
              >
                <SelectTrigger id="emp-type" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`hr.staffType.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="emp-status" label={t("hr.field.status")}>
              <Select
                value={draft.employmentStatus}
                onValueChange={(x) => set("employmentStatus", x as EmploymentStatus)}
              >
                <SelectTrigger id="emp-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`ui.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="emp-position"
              label={`${t("hr.field.position")} ${opt}`}
              error={err("position")}
            >
              <Input
                id="emp-position"
                className="h-11 rounded-xl"
                value={draft.position}
                onChange={(e) => set("position", e.target.value)}
              />
            </Field>
            <Field
              id="emp-department"
              label={`${t("hr.field.department")} ${opt}`}
              error={err("department")}
            >
              <Input
                id="emp-department"
                className="h-11 rounded-xl"
                value={draft.department}
                onChange={(e) => set("department", e.target.value)}
              />
            </Field>
            <Field id="emp-code" label={`${t("hr.field.code")} ${opt}`} error={err("employeeCode")}>
              <Input
                id="emp-code"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.employeeCode}
                onChange={(e) => set("employeeCode", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="emp-start" label={t("hr.field.startDate")}>
                <Input
                  id="emp-start"
                  type="date"
                  dir="ltr"
                  className="h-11 rounded-xl"
                  value={draft.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </Field>
              <Field id="emp-end" label={t("hr.field.endDate")}>
                <Input
                  id="emp-end"
                  type="date"
                  dir="ltr"
                  className="h-11 rounded-xl"
                  value={draft.endDate}
                  min={draft.startDate || undefined}
                  onChange={(e) => set("endDate", e.target.value)}
                />
              </Field>
            </div>
          </div>
          {err("dates") && <p className="text-xs text-destructive">{err("dates")}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="emp-address"
              label={`${t("hr.field.address")} ${opt}`}
              error={err("address")}
            >
              <Input
                id="emp-address"
                className="h-11 rounded-xl"
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>
            <Field
              id="emp-dob"
              label={`${t("hr.field.dateOfBirth")} ${opt}`}
              error={err("dateOfBirth")}
            >
              <Input
                id="emp-dob"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </Field>
            <Field
              id="emp-ec-name"
              label={`${t("hr.field.emergencyName")} ${opt}`}
              error={err("emergencyContact")}
            >
              <Input
                id="emp-ec-name"
                className="h-11 rounded-xl"
                value={draft.emergencyContactName}
                onChange={(e) => set("emergencyContactName", e.target.value)}
              />
            </Field>
            <Field id="emp-ec-phone" label={`${t("hr.field.emergencyPhone")} ${opt}`}>
              <Input
                id="emp-ec-phone"
                dir="ltr"
                inputMode="tel"
                className="h-11 rounded-xl"
                value={draft.emergencyContactPhone}
                onChange={(e) => set("emergencyContactPhone", e.target.value)}
              />
            </Field>
          </div>
          <Field
            id="emp-notes"
            label={`${t("hr.field.notes")} ${opt}`}
            hint={t("hr.field.notesHint")}
            error={err("notes")}
          >
            <Textarea
              id="emp-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
              {t("hr.cancelLabel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={update.isPending}>
              {update.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
