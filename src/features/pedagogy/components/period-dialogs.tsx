/**
 * Academic periods (trimesters), managed by administrators: list, add, edit, delete. An assessment
 * belongs to the period containing its date, so changing dates re-files assessments by itself.
 */

import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import { useDeletePeriod, useSavePeriod } from "../queries";
import type { Period } from "../types";

export function PeriodsDialog({ periods, onClose }: { periods: Period[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const remove = useDeletePeriod();
  const [editing, setEditing] = useState<Period | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">{t("grades.periods.title")}</DialogTitle>
          <DialogDescription className="text-start">{t("grades.periods.hint")}</DialogDescription>
        </DialogHeader>
        {periods.length > 0 && (
          <ul
            className="divide-y divide-border rounded-xl border border-border"
            data-testid="period-list"
          >
            {periods.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
                data-testid="period-row"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {p.name}
                    {p.academicYear && (
                      <span className="text-muted-foreground"> · {p.academicYear}</span>
                    )}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatDate(p.startsOn, locale)} – {formatDate(p.endsOn, locale)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg"
                    aria-label={t("grades.periods.edit")}
                    onClick={() => setEditing(p)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <ConfirmDialog
                    title={t("grades.periods.deleteTitle")}
                    description={t("grades.periods.deleteBody", { name: p.name })}
                    confirmLabel={t("grades.periods.delete")}
                    onConfirm={async () => {
                      try {
                        await remove.mutateAsync(p.id);
                        notifySuccess("grades.periods.deleted");
                      } catch (e) {
                        notifyError(e);
                      }
                    }}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-destructive"
                        aria-label={t("grades.periods.delete")}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <PeriodForm
          key={editing?.id ?? "new"}
          period={editing}
          nextPosition={periods.length + 1}
          onDone={() => setEditing(null)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PeriodForm({
  period,
  nextPosition,
  onDone,
}: {
  period: Period | null;
  nextPosition: number;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSavePeriod();
  const [form, setForm] = useState({
    name: period?.name ?? "",
    academicYear: period?.academicYear ?? "",
    startsOn: period?.startsOn ?? "",
    endsOn: period?.endsOn ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const name = form.name.trim();
  const errors: Partial<Record<"name" | "academicYear" | "dates", string>> = {};
  if (name.length < 1 || name.length > 60) errors.name = "grades.periods.error.name";
  if (form.academicYear.trim().length > 20) errors.academicYear = "grades.periods.error.year";
  if (!form.startsOn || !form.endsOn) errors.dates = "grades.periods.error.dates";
  else if (form.endsOn < form.startsOn) errors.dates = "grades.periods.error.order";
  const err = (k: keyof typeof errors) =>
    submitted && errors[k] ? <p className="text-xs text-destructive">{t(errors[k])}</p> : null;

  return (
    <form
      className="space-y-3 rounded-xl bg-muted/40 p-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (Object.keys(errors).length) return;
        save.mutate(
          {
            ...(period ? { id: period.id } : {}),
            name,
            academicYear: form.academicYear.trim() || null,
            startsOn: form.startsOn,
            endsOn: form.endsOn,
            position: period?.position ?? nextPosition,
          },
          {
            onSuccess: () => {
              notifySuccess("grades.periods.saved");
              setForm({ name: "", academicYear: form.academicYear, startsOn: "", endsOn: "" });
              setSubmitted(false);
              onDone();
            },
            onError: notifyError,
          },
        );
      }}
    >
      <p className="text-sm font-medium">
        {t(period ? "grades.periods.edit" : "grades.periods.add")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="period-name">{t("grades.periods.name")}</Label>
          <Input
            id="period-name"
            className="h-10 rounded-xl"
            placeholder={t("grades.periods.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="period-name"
          />
          {err("name")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="period-year">{t("grades.periods.year")}</Label>
          <Input
            id="period-year"
            dir="ltr"
            className="h-10 rounded-xl"
            placeholder="2026-2027"
            value={form.academicYear}
            onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
            data-testid="period-year"
          />
          {err("academicYear")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="period-start">{t("grades.periods.start")}</Label>
          <Input
            id="period-start"
            type="date"
            dir="ltr"
            className="h-10 rounded-xl"
            value={form.startsOn}
            onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
            data-testid="period-start"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="period-end">{t("grades.periods.end")}</Label>
          <Input
            id="period-end"
            type="date"
            dir="ltr"
            className="h-10 rounded-xl"
            value={form.endsOn}
            onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
            data-testid="period-end"
          />
        </div>
      </div>
      {err("dates")}
      <div className="flex justify-end gap-2">
        {period && (
          <Button type="button" variant="ghost" className="rounded-xl" onClick={onDone}>
            {t("ped.cancel")}
          </Button>
        )}
        <Button
          type="submit"
          className="rounded-xl"
          disabled={save.isPending}
          data-testid="period-save"
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("ped.save")}
        </Button>
      </div>
    </form>
  );
}
