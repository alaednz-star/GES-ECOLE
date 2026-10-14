import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
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
  useDeleteAvailability,
  useSaveAvailability,
  type AvailabilityRow,
  type EmployeeDetail,
} from "@/features/hr/hr";
import {
  validateAvailabilityDraft,
  type AvailabilityDraft,
  type AvailabilityField,
} from "@/features/hr/hr-model";
import { weekdayLabel } from "@/features/school/schedule";
import { Field } from "@/features/hr/components/field";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

/** Saturday first: the Algerian working week. */
const WEEK = [6, 0, 1, 2, 3, 4, 5];

export function AvailabilityPanel({ employee }: { employee: EmployeeDetail }) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const remove = useDeleteAvailability();
  const [form, setForm] = useState<{ slot: AvailabilityRow | null } | null>(null);
  const [deleting, setDeleting] = useState<AvailabilityRow | null>(null);

  const windowLabel = (s: AvailabilityRow) =>
    s.effectiveFrom || s.effectiveUntil
      ? `${s.effectiveFrom ? formatDate(s.effectiveFrom, locale) : "…"} → ${s.effectiveUntil ? formatDate(s.effectiveUntil, locale) : "…"}`
      : null;

  return (
    <SectionCard
      title={t("hr.availability.title")}
      description={t("hr.availability.hint")}
      actions={
        <Button size="sm" className="rounded-xl" onClick={() => setForm({ slot: null })}>
          <Plus className="size-4" aria-hidden />
          {t("hr.availability.new")}
        </Button>
      }
    >
      {employee.availability.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hr.availability.none")}</p>
      ) : (
        <ul className="space-y-2">
          {WEEK.map((day) => {
            const slots = employee.availability.filter((s) => s.weekday === day);
            return (
              <li key={day} className="surface-row flex flex-wrap items-start gap-3 px-3 py-2.5">
                <span className="w-24 shrink-0 pt-1 text-sm font-medium">
                  {weekdayLabel(day, t)}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                  {slots.length === 0 ? (
                    <span className="pt-1 text-sm text-muted-foreground">
                      {t("hr.availability.unavailable")}
                    </span>
                  ) : (
                    slots.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 ps-3 pe-1 text-xs text-primary"
                      >
                        <span className="tabular-nums" dir="ltr">
                          {s.startTime}–{s.endTime}
                        </span>
                        {windowLabel(s) && (
                          <span className="text-muted-foreground">· {windowLabel(s)}</span>
                        )}
                        {s.note && <span className="text-muted-foreground">· {s.note}</span>}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 rounded-full"
                          aria-label={t("hr.availability.editTitle")}
                          onClick={() => setForm({ slot: s })}
                        >
                          <Pencil className="size-3" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 rounded-full text-destructive"
                          aria-label={t("hr.availability.deleteTitle")}
                          onClick={() => setDeleting(s)}
                        >
                          <Trash2 className="size-3" aria-hidden />
                        </Button>
                      </span>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <AvailabilityDialog employee={employee} slot={form.slot} onClose={() => setForm(null)} />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && !remove.isPending && setDeleting(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">
              {t("hr.availability.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {deleting &&
                t("hr.availability.deleteBody", {
                  day: weekdayLabel(deleting.weekday, t),
                  from: deleting.startTime,
                  until: deleting.endTime,
                })}
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
                  notifySuccess("hr.availability.deleted");
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

function AvailabilityDialog({
  employee,
  slot,
  onClose,
}: {
  employee: EmployeeDetail;
  slot: AvailabilityRow | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveAvailability();
  const [draft, setDraft] = useState<AvailabilityDraft>({
    weekday: slot?.weekday ?? 6,
    startTime: slot?.startTime ?? "09:00",
    endTime: slot?.endTime ?? "12:00",
    effectiveFrom: slot?.effectiveFrom ?? "",
    effectiveUntil: slot?.effectiveUntil ?? "",
    note: slot?.note ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof AvailabilityDraft>(k: K, v: AvailabilityDraft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));
  const v = validateAvailabilityDraft(draft, employee.availability, slot?.id);
  const err = (f: AvailabilityField) =>
    !v.ok && submitted && v.errors[f] ? t(v.errors[f] as string) : null;

  const submit = async () => {
    setSubmitted(true);
    if (!v.ok) return;
    try {
      await save.mutateAsync({ employeeId: employee.id, ...v.values });
      notifySuccess("hr.availability.saved");
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(slot ? "hr.availability.editTitle" : "hr.availability.new")}
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="av-day" label={t("hr.availability.day")}>
              <Select
                value={String(draft.weekday)}
                onValueChange={(x) => set("weekday", Number(x))}
              >
                <SelectTrigger id="av-day" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {weekdayLabel(d, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="av-from" label={t("hr.availability.from")}>
              <Input
                id="av-from"
                type="time"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.startTime}
                onChange={(e) => set("startTime", e.target.value)}
              />
            </Field>
            <Field id="av-until" label={t("hr.availability.until")}>
              <Input
                id="av-until"
                type="time"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.endTime}
                onChange={(e) => set("endTime", e.target.value)}
              />
            </Field>
          </div>
          {err("times") && <p className="text-xs text-destructive">{err("times")}</p>}
          {err("overlap") && <p className="text-xs text-destructive">{err("overlap")}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="av-ef"
              label={`${t("hr.availability.effectiveFrom")} ${t("hr.field.optional")}`}
            >
              <Input
                id="av-ef"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.effectiveFrom}
                onChange={(e) => set("effectiveFrom", e.target.value)}
              />
            </Field>
            <Field
              id="av-eu"
              label={`${t("hr.availability.effectiveUntil")} ${t("hr.field.optional")}`}
            >
              <Input
                id="av-eu"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.effectiveUntil}
                onChange={(e) => set("effectiveUntil", e.target.value)}
              />
            </Field>
          </div>
          {err("window") && <p className="text-xs text-destructive">{err("window")}</p>}
          <Field
            id="av-note"
            label={`${t("hr.availability.note")} ${t("hr.field.optional")}`}
            error={err("note")}
          >
            <Input
              id="av-note"
              className="h-11 rounded-xl"
              value={draft.note}
              maxLength={300}
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
