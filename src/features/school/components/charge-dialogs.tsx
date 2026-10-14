/**
 * Adding, editing and cancelling a fee on an enrollment (ADR-005).
 *
 * The form builds a monthly schedule from three inputs (total, number of installments, first due
 * date) and splits the total evenly; every row stays editable, and the schedule total is shown
 * against the amount until they match. Validation mirrors `save_charge` (fee-model.ts); the
 * database remains the authority and its sentences reach the toast through `lib/errors.ts`.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { formatDzd, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isIsoDate } from "../payment-model";
import {
  addMonths,
  buildSchedule,
  chargeToDraft,
  draftScheduleTotal,
  validateChargeDraft,
} from "../fee-model";
import {
  FEE_CANCEL_REASON_MAX,
  FEE_NOTE_MAX,
  INSTALLMENTS_MAX,
  type Charge,
  type ChargeDraft,
  type FeeType,
  type InstallmentDraft,
} from "../fee-types";
import { useCancelCharge, useSaveCharge } from "../fees";
import { useFeeTypeName } from "../fee-labels";

/** A schedule for the inputs, or -- while the amount is not usable yet -- dated empty rows. */
function scheduleFor(amount: string, count: number, firstDue: string): InstallmentDraft[] {
  return (
    buildSchedule(amount, count, firstDue) ??
    Array.from({ length: count }, (_, i) => ({
      amount: count === 1 ? amount.trim() : "",
      dueOn: isIsoDate(firstDue) ? addMonths(firstDue, i) : "",
    }))
  );
}

export function ChargeDialog({
  studentId,
  registrationId,
  enrollmentLabel,
  charge,
  feeTypes,
  onClose,
}: {
  studentId: string;
  registrationId: string;
  /** The group (and formation) the fee belongs to, shown read-only. */
  enrollmentLabel: string;
  /** Absent to add a fee. */
  charge?: Charge;
  feeTypes: readonly FeeType[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveCharge(studentId);
  const typeName = useFeeTypeName(feeTypes);
  const today = todayIso();

  // Active types, plus the charge's own type when it has since been deactivated.
  const offered = feeTypes.filter((ft) => ft.active || ft.code === charge?.feeType);
  const allowed = offered.map((ft) => ft.code);
  const defaultType = offered.some((ft) => ft.code === "tuition")
    ? "tuition"
    : (offered[0]?.code ?? "");

  const [draft, setDraft] = useState<ChargeDraft>(() =>
    charge
      ? chargeToDraft(charge)
      : {
          feeType: defaultType,
          label: "",
          amount: "",
          note: "",
          installments: scheduleFor("", 1, today),
        },
  );
  const [count, setCount] = useState(charge ? charge.installments.length : 1);
  const [firstDue, setFirstDue] = useState(charge?.installments[0]?.dueOn ?? today);
  // Once a row is edited by hand, a new amount no longer re-splits the schedule silently.
  const [manual, setManual] = useState(!!charge);
  const [submitted, setSubmitted] = useState(false);

  const set = <K extends keyof ChargeDraft>(key: K, value: ChargeDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const validation = validateChargeDraft(draft, allowed);
  const errors = validation.ok ? {} : validation.errors;
  const rowErrors = validation.ok ? {} : validation.rows;
  const show = (field: "feeType" | "label" | "amount" | "note") =>
    errors[field] && (submitted || draft[field] !== "") ? t(errors[field] as string) : null;
  const showRow = (i: number, field: "amount" | "dueOn") => {
    const key = rowErrors[i]?.[field];
    return key && (submitted || draft.installments[i]?.[field] !== "") ? t(key) : null;
  };
  const scheduleError =
    errors.installments && (submitted || manual) ? t(errors.installments) : null;

  const amountValue = /^\d+$/.test(draft.amount.trim()) ? Number(draft.amount.trim()) : null;
  const scheduleTotal = draftScheduleTotal(draft.installments);
  const typeInactive = !!charge && !feeTypes.find((ft) => ft.code === draft.feeType)?.active;

  const submit = () => {
    setSubmitted(true);
    if (!validation.ok) return;
    save.mutate(
      { ...(charge ? { id: charge.id } : {}), registrationId, ...validation.values },
      {
        onSuccess: () => {
          notifySuccess(charge ? "fees.updated" : "fees.added");
          onClose();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(charge ? "fees.form.editTitle" : "fees.form.addTitle")}
          </DialogTitle>
          <DialogDescription className="text-start">
            {t("fees.form.enrollmentOf", { name: enrollmentLabel })}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fee-type">{t("fees.form.type")}</Label>
              <Select
                value={draft.feeType}
                onValueChange={(v) => {
                  if (v) set("feeType", v);
                }}
              >
                <SelectTrigger
                  id="fee-type"
                  className="h-11 rounded-xl"
                  aria-invalid={!!show("feeType")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {offered.map((ft) => (
                    <SelectItem key={ft.code} value={ft.code}>
                      {typeName(ft.code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {typeInactive && (
                <p className="text-xs text-muted-foreground">{t("fees.form.typeInactive")}</p>
              )}
              {show("feeType") && <p className="text-xs text-destructive">{show("feeType")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fee-amount">{t("fees.form.amount")}</Label>
              {/* `dir="ltr"`: amounts and dates are direction-neutral. */}
              <Input
                id="fee-amount"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.amount}
                aria-invalid={!!show("amount")}
                onChange={(e) => {
                  const amount = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    amount,
                    // A single installment always follows the amount; several keep the admin's edits.
                    installments:
                      d.installments.length === 1
                        ? [{ ...(d.installments[0] as InstallmentDraft), amount }]
                        : manual
                          ? d.installments
                          : scheduleFor(amount, count, firstDue),
                  }));
                }}
              />
              {show("amount") && <p className="text-xs text-destructive">{show("amount")}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fee-label">{t("fees.form.label")}</Label>
            <Input
              id="fee-label"
              autoComplete="off"
              className="h-11 rounded-xl"
              value={draft.label}
              aria-invalid={!!show("label")}
              onChange={(e) => set("label", e.target.value)}
            />
            {show("label") ? (
              <p className="text-xs text-destructive">{show("label")}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("fees.form.labelHint")}</p>
            )}
          </div>

          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t("fees.form.schedule")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fee-count">{t("fees.form.count")}</Label>
                <Select
                  value={String(count)}
                  onValueChange={(v) => {
                    // Radix may re-emit the current value: only a real change re-splits.
                    if (!v || Number(v) === count) return;
                    const n = Number(v);
                    setCount(n);
                    setManual(false);
                    set("installments", scheduleFor(draft.amount, n, firstDue));
                  }}
                >
                  <SelectTrigger id="fee-count" className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: INSTALLMENTS_MAX }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fee-first-due">{t("fees.form.firstDue")}</Label>
                <Input
                  id="fee-first-due"
                  type="date"
                  dir="ltr"
                  className="h-11 rounded-xl"
                  value={firstDue}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFirstDue(v);
                    setManual(false);
                    set("installments", scheduleFor(draft.amount, count, v));
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("fees.form.monthlyHint")}</p>

            <ol className="space-y-2" data-testid="fee-schedule">
              {draft.installments.map((row, i) => (
                <li key={i} className="grid grid-cols-[1.75rem_1fr_1fr] items-start gap-2">
                  <span className="pt-2.5 text-center text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <Input
                      type="date"
                      dir="ltr"
                      className="h-10 rounded-lg"
                      aria-label={t("fees.form.rowDate", { n: i + 1 })}
                      value={row.dueOn}
                      aria-invalid={!!showRow(i, "dueOn")}
                      onChange={(e) => {
                        const dueOn = e.target.value;
                        setManual(true);
                        set(
                          "installments",
                          draft.installments.map((r, j) => (j === i ? { ...r, dueOn } : r)),
                        );
                      }}
                    />
                    {showRow(i, "dueOn") && (
                      <p className="text-xs text-destructive">{showRow(i, "dueOn")}</p>
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      dir="ltr"
                      className="h-10 rounded-lg"
                      aria-label={t("fees.form.rowAmount", { n: i + 1 })}
                      value={row.amount}
                      aria-invalid={!!showRow(i, "amount")}
                      onChange={(e) => {
                        const amount = e.target.value;
                        setManual(true);
                        set(
                          "installments",
                          draft.installments.map((r, j) => (j === i ? { ...r, amount } : r)),
                        );
                      }}
                    />
                    {showRow(i, "amount") && (
                      <p className="text-xs text-destructive">{showRow(i, "amount")}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                data-testid="fee-schedule-total"
                className={cn(
                  "text-xs tabular-nums",
                  amountValue !== null && scheduleTotal !== amountValue
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {t("fees.form.scheduleTotal", {
                  total: formatDzd(scheduleTotal, locale),
                  amount: formatDzd(amountValue ?? 0, locale),
                })}
              </p>
              {manual && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => {
                    setManual(false);
                    set("installments", scheduleFor(draft.amount, count, firstDue));
                  }}
                >
                  {t("fees.form.resplit")}
                </Button>
              )}
            </div>
            {scheduleError && <p className="text-xs text-destructive">{scheduleError}</p>}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="fee-note">{t("fees.form.note")}</Label>
            <Textarea
              id="fee-note"
              rows={2}
              maxLength={FEE_NOTE_MAX + 50}
              value={draft.note}
              aria-invalid={!!show("note")}
              onChange={(e) => set("note", e.target.value)}
            />
            {show("note") && <p className="text-xs text-destructive">{show("note")}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("ui.cancel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("fees.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CancelChargeDialog({
  studentId,
  charge,
  title,
  onClose,
}: {
  studentId: string;
  charge: Charge;
  /** The fee as the list names it. */
  title: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const cancel = useCancelCharge(studentId);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < 1 || trimmed.length > FEE_CANCEL_REASON_MAX;

  const submit = () => {
    setSubmitted(true);
    if (invalid || cancel.isPending) return;
    cancel.mutate(
      { id: charge.id, reason: trimmed },
      {
        onSuccess: () => {
          notifySuccess("fees.cancelled");
          onClose();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && !cancel.isPending && onClose()}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">{t("fees.cancelDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {t("fees.cancelDialog.body", {
              fee: title,
              amount: formatDzd(charge.amountDzd, locale),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fee-cancel-reason">{t("fees.cancelDialog.reason")}</Label>
          <Textarea
            id="fee-cancel-reason"
            rows={2}
            value={reason}
            aria-invalid={submitted && invalid}
            onChange={(e) => setReason(e.target.value)}
          />
          {submitted && invalid && (
            <p className="text-xs text-destructive">{t("fees.error.reasonRequired")}</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancel.isPending}>
            {t("fees.cancelDialog.keep")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={cancel.isPending}
            onClick={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {cancel.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("fees.cancelDialog.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
