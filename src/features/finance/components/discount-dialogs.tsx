/**
 * Granting a discount on a fee, and cancelling a granted one (ADR-006 section 2). Used on the
 * student page. The amount shown is a preview (discount-model.ts); `grant_discount` decides.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { formatDzd } from "@/lib/format";
import type { Charge, ChargeDiscount } from "@/features/school/fee-types";
import { applicableDiscounts, discountAmount } from "../discount-model";
import { useCancelDiscount, useDiscounts, useGrantDiscount } from "../queries";

export function GrantDiscountDialog({
  charge,
  title,
  onClose,
}: {
  charge: Charge;
  /** The fee as the list names it. */
  title: string;
  onClose: () => void;
}) {
  const { t, locale, dir } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const catalogue = useDiscounts();
  const grant = useGrantDiscount();
  const offered = applicableDiscounts(catalogue.data ?? [], charge.feeType);
  const already = (charge.discounts ?? [])
    .filter((d) => d.status === "active")
    .reduce((s, d) => s + d.amountDzd, 0);
  const room = Math.max(0, charge.amountDzd - already);

  const [mode, setMode] = useState<"catalogue" | "oneoff">("catalogue");
  const [discountId, setDiscountId] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const picked = offered.find((d) => d.id === discountId) ?? null;
  const oneOffAmount = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : NaN;
  const preview =
    mode === "catalogue"
      ? picked
        ? discountAmount(picked.kind, picked.value, charge.amountDzd, already)
        : 0
      : Number.isSafeInteger(oneOffAmount)
        ? oneOffAmount
        : 0;

  const error =
    mode === "catalogue"
      ? !picked
        ? "discounts.error.pick"
        : preview <= 0
          ? "discounts.error.exceeds"
          : null
      : !Number.isSafeInteger(oneOffAmount) || oneOffAmount <= 0
        ? "discounts.error.amount"
        : oneOffAmount > room
          ? "discounts.error.exceeds"
          : !label.trim()
            ? "discounts.error.label"
            : null;
  const reasonTooLong = reason.trim().length > 300;

  const submit = () => {
    setSubmitted(true);
    if (error || reasonTooLong || grant.isPending) return;
    grant.mutate(
      {
        chargeId: charge.id,
        discountId: mode === "catalogue" ? discountId : null,
        amountDzd: mode === "oneoff" ? oneOffAmount : null,
        label: mode === "oneoff" ? label.trim() : null,
        reason: reason.trim() || null,
      },
      {
        onSuccess: () => {
          notifySuccess("discounts.granted");
          onClose();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !grant.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">{t("discounts.grantTitle")}</DialogTitle>
          <DialogDescription className="text-start">
            {t("discounts.grantBody", { fee: title, amount: formatDzd(charge.amountDzd, locale) })}
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
          <RadioGroup
            dir={dir}
            value={mode}
            onValueChange={(v) => v && setMode(v as "catalogue" | "oneoff")}
            className="grid grid-cols-2 gap-2"
          >
            {(["catalogue", "oneoff"] as const).map((m) => (
              <label
                key={m}
                htmlFor={`grant-mode-${m}`}
                className="surface-row flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
              >
                <RadioGroupItem value={m} id={`grant-mode-${m}`} />
                {t(m === "catalogue" ? "discounts.fromCatalogue" : "discounts.oneOff")}
              </label>
            ))}
          </RadioGroup>

          {mode === "catalogue" ? (
            <div className="space-y-1.5">
              <Label htmlFor="grant-discount">{t("discounts.pick")}</Label>
              {offered.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("discounts.noneApplicable")}</p>
              ) : (
                <Select value={discountId} onValueChange={(v) => v && setDiscountId(v)}>
                  <SelectTrigger id="grant-discount" className="h-11 rounded-xl">
                    <SelectValue placeholder={t("discounts.pick")} />
                  </SelectTrigger>
                  <SelectContent>
                    {offered.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name} (
                        {d.kind === "percent"
                          ? t("discounts.valueShortPercent", { value: d.value })
                          : t("discounts.valueShortAmount", { amount: formatDzd(d.value, locale) })}
                        )
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="grant-label">{t("discounts.label")}</Label>
                <Input
                  id="grant-label"
                  className="h-11 rounded-xl"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grant-amount">{t("discounts.amount")}</Label>
                <Input
                  id="grant-amount"
                  inputMode="numeric"
                  dir="ltr"
                  className="h-11 rounded-xl"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
          )}

          <div
            className="space-y-0.5 text-xs tabular-nums text-muted-foreground"
            data-testid="grant-preview"
          >
            <p className="text-sm font-medium text-foreground">
              {t("discounts.preview", { amount: formatDzd(preview, locale) })}
            </p>
            <p>{t("discounts.room", { amount: formatDzd(room, locale) })}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="grant-reason">{t("discounts.reason")}</Label>
            <Textarea
              id="grant-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {submitted && (error || reasonTooLong) && (
            <p className="text-xs text-destructive">{t(error ?? "discounts.error.reason")}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={grant.isPending}>
              {t("ui.cancel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={grant.isPending}>
              {grant.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("discounts.grant")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CancelDiscountDialog({
  discount,
  onClose,
}: {
  discount: ChargeDiscount;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const cancel = useCancelDiscount();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < 1 || trimmed.length > 300;

  return (
    <AlertDialog open onOpenChange={(open) => !open && !cancel.isPending && onClose()}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">{t("discounts.cancelTitle")}</AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {t("discounts.cancelBody", {
              label: discount.label,
              amount: formatDzd(discount.amountDzd, locale),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="discount-cancel-reason">{t("discounts.cancelReason")}</Label>
          <Textarea
            id="discount-cancel-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {submitted && invalid && (
            <p className="text-xs text-destructive">{t("discounts.error.reason")}</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancel.isPending}>{t("discounts.keep")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={cancel.isPending}
            onClick={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (invalid) return;
              cancel.mutate(
                { id: discount.id, reason: trimmed },
                {
                  onSuccess: () => {
                    notifySuccess("discounts.cancelled");
                    onClose();
                  },
                  onError: notifyError,
                },
              );
            }}
          >
            {cancel.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("discounts.cancel")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
