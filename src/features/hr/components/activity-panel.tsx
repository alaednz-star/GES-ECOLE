import { Loader2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { ErrorState } from "@/components/common/error-state";
import { useEmployeeActivity, type EmployeeDetail } from "@/features/hr/hr";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";

/** HR columns -> the label the forms already use for them. */
const FIELD_LABEL: Record<string, string> = {
  staff_type: "hr.field.staffType",
  employment_status: "hr.field.status",
  position: "hr.field.position",
  department: "hr.field.department",
  employee_code: "hr.field.code",
  start_date: "hr.field.startDate",
  end_date: "hr.field.endDate",
  address: "hr.field.address",
  date_of_birth: "hr.field.dateOfBirth",
  emergency_contact_name: "hr.field.emergency",
  emergency_contact_phone: "hr.field.emergency",
  notes: "hr.field.notes",
  note: "hr.time.note",
  status: "hr.leave.status",
  contract_type: "hr.contracts.type",
  working_time: "hr.contracts.workingTime",
  leave_type: "hr.leave.type",
  work_date: "hr.time.date",
  check_in: "hr.time.checkIn",
  check_out: "hr.time.checkOut",
  weekday: "hr.availability.day",
  start_time: "hr.availability.from",
  end_time: "hr.availability.until",
  effective_from: "hr.availability.effectiveFrom",
  effective_until: "hr.availability.effectiveUntil",
};

/**
 * The existing audit trail for this person -- HR changes (written by `audit_hr_change`) and
 * account events (provisioning, lifecycle, password resets). Read-only: no second audit system.
 */
export function ActivityPanel({ employee }: { employee: EmployeeDetail }) {
  const { t, locale } = useI18n();
  const activity = useEmployeeActivity(employee.profileId);

  const label = (action: string, details: Record<string, unknown>) => {
    if (action.startsWith("hr_")) {
      const entity = typeof details["entity"] === "string" ? details["entity"] : "";
      return `${t(`hr.activity.entity.${entity}`)} — ${t(`hr.activity.${action}`)}`;
    }
    const key = `hr.activity.action.${action}`;
    const translated = t(key);
    // `t` returns the key when no entry exists: show the raw action rather than the key.
    return `${t("hr.activity.account")} — ${translated === key ? action : translated}`;
  };
  const changed = (details: Record<string, unknown>) => {
    const after = details["after"];
    const keys = after && typeof after === "object" ? Object.keys(after as object) : [];
    // Column names are shown as the form's own labels; bookkeeping columns are omitted.
    return [
      ...new Set(
        keys
          .filter((k) => k !== "decided_by" && k !== "decided_at")
          .map((k) => (FIELD_LABEL[k] ? t(FIELD_LABEL[k]) : k)),
      ),
    ];
  };

  return (
    <SectionCard title={t("hr.activity.title")} description={t("hr.activity.hint")}>
      {activity.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      ) : activity.error ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : (activity.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hr.activity.none")}</p>
      ) : (
        <ol className="space-y-1.5">
          {(activity.data ?? []).map((a) => {
            const fields = changed(a.details);
            return (
              <li key={a.id} className="surface-row px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{label(a.action, a.details)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(a.createdAt, locale)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.actorEmail && (
                    <span dir="ltr">{t("hr.activity.by", { actor: a.actorEmail })}</span>
                  )}
                  {fields.length > 0 && (
                    <span> · {t("hr.activity.fields", { fields: fields.join(", ") })}</span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
