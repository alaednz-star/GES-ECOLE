/**
 * The student page's « Frais et échéances » section (ADR-005), for administrators.
 *
 * It answers two separate questions, side by side and never merged:
 *   - What does this student OWE?  The charges of each enrollment and their installments.
 *   - What has this student PAID?  The payments received on each enrollment (the unchanged ledger).
 * Remaining and overdue amounts are derived from the two (fee-model.ts `balanceOf`); the
 * per-installment "paid" column applies the enrollment's payments oldest due date first, for
 * display only -- no payment is tied to an installment.
 *
 * Writes go through `save_charge` / `cancel_charge`; payments are still recorded on the Payments
 * screen, which this section links to rather than duplicating.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Percent,
  Plus,
  Printer,
  Receipt,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, formatDzd, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { balanceOf, sumBalances } from "../fee-model";
import type {
  Charge,
  ChargeDiscount,
  EnrollmentBalance,
  InstallmentStatus,
  ReceivedPayment,
} from "../fee-types";
import { useFeeTypes, useStudentCharges, useStudentPayments } from "../fees";
import { useChargeTitle } from "../fee-labels";
import type { RegistrationRow } from "../types";
import { CancelChargeDialog, ChargeDialog } from "./charge-dialogs";
import {
  CancelDiscountDialog,
  GrantDiscountDialog,
} from "@/features/finance/components/discount-dialogs";
import { useIssueInvoice, useStudentReceipts } from "@/features/finance/queries";
import { useActionFeedback } from "@/hooks/use-action-feedback";

type DialogState =
  | { kind: "add"; registrationId: string; label: string }
  | { kind: "edit"; registrationId: string; label: string; charge: Charge }
  | { kind: "cancel"; charge: Charge }
  | { kind: "grant"; charge: Charge }
  | { kind: "cancel-discount"; discount: ChargeDiscount }
  | null;

const statusTone: Record<InstallmentStatus | "cancelled", string> = {
  paid: "bg-success-soft text-success",
  partial: "bg-accent-soft text-accent",
  overdue: "bg-destructive/10 text-destructive",
  upcoming: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

function FeeStatusBadge({ status }: { status: InstallmentStatus | "cancelled" }) {
  const { t } = useI18n();
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        statusTone[status],
      )}
    >
      {t(`fees.status.${status}`)}
    </span>
  );
}

export function StudentFeesSection({
  studentId,
  registrations,
  groups,
}: {
  studentId: string;
  /** Every registration of the school (filtered here to this student). */
  registrations: readonly RegistrationRow[];
  groups: readonly { id: string; programName: string | null }[];
}) {
  const { t, locale } = useI18n();
  const typesQuery = useFeeTypes();
  const chargesQuery = useStudentCharges(studentId);
  const paymentsQuery = useStudentPayments(studentId);
  const receipts = useStudentReceipts(studentId);
  const chargeTitle = useChargeTitle(typesQuery.data ?? []);
  const [dialog, setDialog] = useState<DialogState>(null);
  const today = todayIso();

  const charges = useMemo(() => chargesQuery.data ?? [], [chargesQuery.data]);
  const payments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);

  // Active enrollments, plus any other that carries fees or payments (a withdrawn place keeps
  // its history). Active first, then the most recent.
  const enrollments = useMemo(
    () =>
      registrations
        .filter(
          (r) =>
            r.studentId === studentId &&
            (r.status === "approved" ||
              charges.some((c) => c.registrationId === r.id) ||
              payments.some((p) => p.registrationId === r.id)),
        )
        .sort(
          (a, b) =>
            Number(b.status === "approved") - Number(a.status === "approved") ||
            b.createdAt.localeCompare(a.createdAt),
        )
        .map((r) => {
          const own = charges.filter((c) => c.registrationId === r.id);
          const paid = payments.filter((p) => p.registrationId === r.id);
          const formation = groups.find((g) => g.id === r.groupId)?.programName ?? null;
          return {
            registration: r,
            label: formation ? `${r.groupName} · ${formation}` : r.groupName,
            charges: own,
            payments: paid,
            balance: balanceOf(own, paid, today),
          };
        }),
    [registrations, studentId, charges, payments, groups, today],
  );
  const totals = sumBalances(enrollments.map((e) => e.balance));

  const error = typesQuery.error ?? chargesQuery.error ?? paymentsQuery.error;
  const loading = typesQuery.isLoading || chargesQuery.isLoading || paymentsQuery.isLoading;

  return (
    <SectionCard title={t("fees.title")} description={t("fees.subtitle")}>
      <div data-testid="fees-section" className="space-y-4">
        {error ? (
          <ErrorState
            error={error}
            className="border-none shadow-none"
            onRetry={() => {
              void typesQuery.refetch();
              void chargesQuery.refetch();
              void paymentsQuery.refetch();
            }}
            isRetrying={
              typesQuery.isFetching || chargesQuery.isFetching || paymentsQuery.isFetching
            }
          />
        ) : loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : enrollments.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("fees.noEnrollments")}
            description={t("fees.noEnrollmentsBody")}
            className="border-none shadow-none"
          />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Figure
                testId="fees-total-due"
                label={t("fees.totalDue")}
                value={formatDzd(totals.dueDzd, locale)}
              />
              <Figure
                testId="fees-total-paid"
                label={t("fees.totalPaid")}
                value={formatDzd(totals.paidDzd, locale)}
                tone="success"
              />
              <Figure
                testId="fees-total-remaining"
                label={t("fees.totalRemaining")}
                value={formatDzd(totals.remainingDzd, locale)}
                tone={totals.remainingDzd > 0 ? "accent" : undefined}
              />
              <Figure
                testId="fees-total-overdue"
                label={t("fees.totalOverdue")}
                value={formatDzd(totals.overdueDzd, locale)}
                tone={totals.overdueDzd > 0 ? "destructive" : undefined}
              />
            </dl>

            {enrollments.map((e) => (
              <EnrollmentFees
                key={e.registration.id}
                label={e.label}
                registration={e.registration}
                charges={e.charges}
                payments={e.payments}
                balance={e.balance}
                chargeTitle={chargeTitle}
                onAdd={() =>
                  setDialog({ kind: "add", registrationId: e.registration.id, label: e.label })
                }
                onEdit={(charge) =>
                  setDialog({
                    kind: "edit",
                    registrationId: e.registration.id,
                    label: e.label,
                    charge,
                  })
                }
                onCancel={(charge) => setDialog({ kind: "cancel", charge })}
                onGrant={(charge) => setDialog({ kind: "grant", charge })}
                onCancelDiscount={(discount) => setDialog({ kind: "cancel-discount", discount })}
                receiptOf={(paymentId) => receipts.data?.get(paymentId) ?? null}
              />
            ))}

            <p className="text-xs text-muted-foreground">{t("fees.coverageNote")}</p>
          </>
        )}
      </div>

      {(dialog?.kind === "add" || dialog?.kind === "edit") && (
        <ChargeDialog
          studentId={studentId}
          registrationId={dialog.registrationId}
          enrollmentLabel={dialog.label}
          {...(dialog.kind === "edit" ? { charge: dialog.charge } : {})}
          feeTypes={typesQuery.data ?? []}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "cancel" && (
        <CancelChargeDialog
          studentId={studentId}
          charge={dialog.charge}
          title={chargeTitle(dialog.charge)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "grant" && (
        <GrantDiscountDialog
          charge={dialog.charge}
          title={chargeTitle(dialog.charge)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "cancel-discount" && (
        <CancelDiscountDialog discount={dialog.discount} onClose={() => setDialog(null)} />
      )}
    </SectionCard>
  );
}

function Figure({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "success" | "accent" | "destructive" | undefined;
  testId: string;
}) {
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        data-testid={testId}
        className={cn(
          "mt-0.5 truncate text-base font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "accent" && "text-accent",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function EnrollmentFees({
  label,
  registration,
  charges,
  payments,
  balance,
  chargeTitle,
  onAdd,
  onEdit,
  onCancel,
  onGrant,
  onCancelDiscount,
  receiptOf,
}: {
  label: string;
  registration: RegistrationRow;
  charges: Charge[];
  payments: ReceivedPayment[];
  balance: EnrollmentBalance;
  chargeTitle: (c: Pick<Charge, "feeType" | "label">) => string;
  onAdd: () => void;
  onEdit: (c: Charge) => void;
  onCancel: (c: Charge) => void;
  onGrant: (c: Charge) => void;
  onCancelDiscount: (d: ChargeDiscount) => void;
  /** The current receipt of a payment (ADR-006), if any. */
  receiptOf: (paymentId: string) => string | null;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { notifySuccess, notifyError } = useActionFeedback();
  const issueInvoice = useIssueInvoice();
  const active = registration.status === "approved";
  const invoiceable = charges.some((c) => c.status === "active");

  return (
    <section
      data-testid="fee-enrollment"
      data-registration={registration.id}
      className="space-y-3 rounded-xl border border-border p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to="/dashboard/groups/$groupId"
            params={{ groupId: registration.groupId }}
            className="focus-ring block truncate rounded text-sm font-semibold hover:text-primary"
          >
            {label}
          </Link>
          <p
            className="mt-0.5 text-xs tabular-nums text-muted-foreground"
            data-testid="fee-enrollment-summary"
          >
            {t("fees.due")} {formatDzd(balance.dueDzd, locale)}
            {balance.discountDzd > 0 &&
              ` · ${t("fees.discounted")} −${formatDzd(balance.discountDzd, locale)}`}{" "}
            · {t("fees.paid")} {formatDzd(balance.paidDzd, locale)} · {t("fees.remaining")}{" "}
            {formatDzd(balance.remainingDzd, locale)}
          </p>
          {balance.nextDue && (
            <p className="text-xs text-muted-foreground">
              {t("fees.nextDue", {
                date: formatDate(balance.nextDue.dueOn, locale),
                amount: formatDzd(balance.nextDue.remainingDzd, locale),
              })}
            </p>
          )}
          {balance.advanceDzd > 0 && (
            <p className="text-xs text-success">
              {t("fees.advance", { amount: formatDzd(balance.advanceDzd, locale) })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!active && <StatusBadge status={registration.status} />}
          {invoiceable && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              data-testid="fee-invoice"
              disabled={issueInvoice.isPending}
              onClick={() =>
                issueInvoice.mutate(registration.id, {
                  onSuccess: (id) => {
                    notifySuccess("invoices.issuedShort");
                    void navigate({
                      to: "/documents/invoices/$invoiceId",
                      params: { invoiceId: id },
                    });
                  },
                  onError: notifyError,
                })
              }
            >
              {issueInvoice.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileText className="size-4" aria-hidden />
              )}
              {t("invoices.issueForEnrollment")}
            </Button>
          )}
          {active && (
            <Button size="sm" className="rounded-xl" onClick={onAdd} data-testid="fee-add">
              <Plus className="size-4" aria-hidden />
              {t("fees.add")}
            </Button>
          )}
        </div>
      </header>

      {charges.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("fees.noCharges")}</p>
      ) : (
        <ul className="space-y-3">
          {charges.map((c) => (
            <ChargeCard
              key={c.id}
              charge={c}
              title={chargeTitle(c)}
              balance={balance}
              onEdit={() => onEdit(c)}
              onCancel={() => onCancel(c)}
              onGrant={() => onGrant(c)}
              onCancelDiscount={onCancelDiscount}
            />
          ))}
        </ul>
      )}

      <div className="rounded-lg bg-muted/40 p-3" data-testid="fee-payments">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">
            {t("fees.payments.title")} · {formatDzd(balance.paidDzd, locale)}
          </p>
          <Button asChild variant="ghost" size="sm" className="h-7 rounded-lg text-xs">
            <Link to="/dashboard/payments">
              <Wallet className="size-3.5" aria-hidden />
              {t("fees.payments.record")}
            </Link>
          </Button>
        </div>
        {payments.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("fees.payments.none")}</p>
        ) : (
          <ul className="mt-1 divide-y divide-border/60">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="tabular-nums text-muted-foreground">
                  {formatDate(p.paidOn, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate">{t(`payments.method.${p.method}`)}</span>
                <span className="font-medium tabular-nums">{formatDzd(p.amountDzd, locale)}</span>
                {receiptOf(p.id) && (
                  <Link
                    to="/documents/receipts/$receiptId"
                    params={{ receiptId: receiptOf(p.id) as string }}
                    className="focus-ring rounded text-muted-foreground hover:text-primary"
                    aria-label={t("receipts.open")}
                    data-testid="fee-payment-receipt"
                  >
                    <Printer className="size-3.5" aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ChargeCard({
  charge,
  title,
  balance,
  onEdit,
  onCancel,
  onGrant,
  onCancelDiscount,
}: {
  charge: Charge;
  title: string;
  balance: EnrollmentBalance;
  onEdit: () => void;
  onCancel: () => void;
  onGrant: () => void;
  onCancelDiscount: (d: ChargeDiscount) => void;
}) {
  const { t, locale } = useI18n();
  const cancelled = charge.status === "cancelled";

  return (
    <li
      data-testid="fee-charge"
      data-status={charge.status}
      className={cn("rounded-lg border border-border/70", cancelled && "bg-muted/30")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-sm font-medium",
              cancelled && "line-through text-muted-foreground",
            )}
          >
            {title}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            <span className={cn(cancelled && "line-through")}>
              {formatDzd(charge.amountDzd, locale)}
            </span>
            {" · "}
            {t("fees.installmentsCount", { count: charge.installments.length })}
          </p>
          {cancelled && charge.cancelledAt && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("fees.cancelledOn", {
                date: formatDate(charge.cancelledAt, locale),
                reason: charge.cancelReason ?? "",
              })}
            </p>
          )}
          {charge.note && !cancelled && (
            <p className="mt-0.5 text-xs text-muted-foreground">{charge.note}</p>
          )}
          {(charge.discounts ?? []).length > 0 && (
            <ul className="mt-1 space-y-0.5" data-testid="fee-discounts">
              {(charge.discounts ?? []).map((d) => (
                <li
                  key={d.id}
                  data-testid="fee-discount"
                  data-status={d.status}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <Percent className="size-3 text-primary" aria-hidden />
                  <span
                    className={cn(
                      "tabular-nums",
                      d.status === "cancelled" && "text-muted-foreground line-through",
                    )}
                  >
                    {d.label} −{formatDzd(d.amountDzd, locale)}
                  </span>
                  {d.status === "cancelled" ? (
                    <span className="text-muted-foreground">
                      {t("discounts.cancelledBecause", { reason: d.cancelReason ?? "" })}
                    </span>
                  ) : (
                    !cancelled && (
                      <button
                        type="button"
                        className="focus-ring rounded text-muted-foreground hover:text-destructive"
                        aria-label={t("discounts.cancel")}
                        data-testid="fee-discount-cancel"
                        onClick={() => onCancelDiscount(d)}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1">
          {cancelled && <FeeStatusBadge status="cancelled" />}
          {!cancelled && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg"
                  aria-label={t("fees.actionsAria")}
                  data-testid="fee-actions"
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-4" aria-hidden />
                  {t("fees.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onGrant}>
                  <Percent className="size-4" aria-hidden />
                  {t("discounts.grant")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onCancel}
                  className="text-destructive focus:text-destructive"
                >
                  <XCircle className="size-4" aria-hidden />
                  {t("fees.cancel")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {!cancelled && (
        // A phone gets one stacked line per installment; the table needs the width of a tablet.
        <ul className="divide-y divide-border/60 border-t border-border/70 sm:hidden">
          {charge.installments.map((i) => {
            const view = balance.installments[i.id];
            return (
              <li
                key={i.id}
                data-testid="fee-installment-compact"
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">
                    {i.position}/{charge.installments.length} · {formatDate(i.dueOn, locale)} ·{" "}
                    {formatDzd(i.amountDzd, locale)}
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    {t("fees.col.paid")} {formatDzd(view?.coveredDzd ?? 0, locale)} ·{" "}
                    {t("fees.col.remaining")} {formatDzd(view?.remainingDzd ?? i.amountDzd, locale)}
                  </p>
                </div>
                {view && <FeeStatusBadge status={view.status} />}
              </li>
            );
          })}
        </ul>
      )}
      {!cancelled && (
        <div className="hidden overflow-x-auto border-t border-border/70 sm:block">
          <table className="w-full min-w-[34rem] text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("fees.col.installment")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("fees.col.dueOn")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("fees.col.amount")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("fees.col.paid")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("fees.col.remaining")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("fees.col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {charge.installments.map((i) => {
                const view = balance.installments[i.id];
                return (
                  <tr key={i.id} data-testid="fee-installment" data-status={view?.status}>
                    <td className="px-3 py-2 tabular-nums">
                      {i.position}/{charge.installments.length}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatDate(i.dueOn, locale)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatDzd(i.amountDzd, locale)}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatDzd(view?.coveredDzd ?? 0, locale)}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatDzd(view?.remainingDzd ?? i.amountDzd, locale)}
                    </td>
                    <td className="px-3 py-2">{view && <FeeStatusBadge status={view.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}
