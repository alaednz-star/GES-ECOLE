/**
 * Payments: the ledger of money received.
 *
 * One row per PAYMENT (a financial transaction), not per registration. The previous screen
 * derived "expected" and "outstanding" from `groups.price_dzd` as if one price settled a
 * place; the schema does not say what period a price covers, so those figures were an
 * assumption presented as a fact. This screen states only what was actually received.
 * Expected and outstanding amounts arrive with payment schedules.
 *
 * Security is not decided here. RLS admits administrators only (teachers match no policy),
 * the database refuses edits to a payment's registration or recorder, and a trigger writes
 * every change to the audit log. The route guard is navigation, not protection.
 *
 * Every figure comes from `payment-model.ts` (pure, unit tested); every fetch and write from
 * `payments.ts`.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Eye,
  Hash,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { DataTable, type Column } from "@/components/common/data-table";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { RequireAuth } from "@/features/auth/require-auth";
import {
  LEDGER_LIMIT,
  useDeletePayment,
  usePayableRegistrations,
  usePaymentDailyTotals,
  usePaymentLedger,
  useRecordPayment,
  useUpdatePayment,
} from "@/features/school/payments";
import {
  PAYMENT_METHODS,
  PAYMENT_NOTE_MAX,
  type PayableRegistration,
  type PaymentDraft,
  type PaymentFilters,
  type PaymentMethod,
  type PaymentRecord,
} from "@/features/school/payment-types";
import {
  enrollmentAfterStudentChange,
  enrollmentsOf,
  monthBounds,
  payableStudents,
  selectedEnrollment,
  sumAmounts,
  summarisePayments,
  validatePaymentDraft,
  type PaymentField,
} from "@/features/school/payment-model";
import { useFeeTypes, useStudentCharges, useStudentPayments } from "@/features/school/fees";
import { usePaymentReceipt } from "@/features/finance/queries";
import { paymentSuggestion, type PaymentSuggestion } from "@/features/school/fee-model";
import { useChargeTitle } from "@/features/school/fee-labels";
import { formatDate, formatDateTime, formatDzd, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/payments")({
  head: () => ({
    meta: [
      { title: "Paiements — Gestion École" },
      { name: "description", content: "Registre des paiements reçus." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <PaymentsPage />
    </RequireAuth>
  ),
});

type FormState = { mode: "create" } | { mode: "edit"; payment: PaymentRecord };

function PaymentsPage() {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const today = todayIso();

  // The ledger is always windowed; it opens on the current month.
  const [filters, setFilters] = useState<PaymentFilters>(() => ({
    ...monthBounds(today),
    method: "all",
    groupId: "all",
    studentId: "all",
  }));
  const setFilter = <K extends keyof PaymentFilters>(key: K, value: PaymentFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const ledger = usePaymentLedger(filters);
  const daily = usePaymentDailyTotals();
  const payable = usePayableRegistrations();
  const remove = useDeletePayment();

  const [form, setForm] = useState<FormState | null>(null);
  const [details, setDetails] = useState<PaymentRecord | null>(null);
  const [deleting, setDeleting] = useState<PaymentRecord | null>(null);

  const rows = useMemo(() => ledger.data?.rows ?? [], [ledger.data]);
  const totals = useMemo(() => summarisePayments(daily.data, today), [daily.data, today]);

  // Filter options come from approved registrations: every payment hangs off one.
  const { students, groups } = useMemo(() => {
    const s = new Map<string, string>();
    const g = new Map<string, string>();
    for (const r of payable.data ?? []) {
      s.set(r.studentId, r.studentName ?? "—");
      if (r.groupId) g.set(r.groupId, r.groupName ?? "—");
    }
    const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
    return { students: [...s].sort(byName), groups: [...g].sort(byName) };
  }, [payable.data]);

  const stat = (value: number) => formatDzd(value, locale);
  const countHint = (count: number) => t("payments.countHint", { count });

  const columns: Column<PaymentRecord>[] = [
    {
      key: "date",
      header: t("payments.col.date"),
      sortValue: (r) => `${r.paidOn}|${r.createdAt}`,
      cell: (r) => <span className="tabular-nums">{formatDate(r.paidOn, locale)}</span>,
    },
    {
      key: "student",
      header: t("payments.col.student"),
      sortValue: (r) => r.studentName ?? "",
      cell: (r) => <span className="font-medium">{r.studentName ?? t("payments.none")}</span>,
    },
    {
      key: "group",
      header: t("payments.col.group"),
      sortValue: (r) => r.groupName ?? "",
      cell: (r) => (
        <span className="text-muted-foreground">{r.groupName ?? t("payments.none")}</span>
      ),
    },
    {
      key: "amount",
      header: t("payments.col.amount"),
      className: "text-end",
      sortValue: (r) => r.amountDzd,
      cell: (r) => (
        <span className="font-semibold tabular-nums">{formatDzd(r.amountDzd, locale)}</span>
      ),
    },
    {
      key: "method",
      header: t("payments.col.method"),
      sortValue: (r) => r.method,
      cell: (r) => t(`payments.method.${r.method}`),
    },
    {
      key: "recordedBy",
      header: t("payments.col.recordedBy"),
      cell: (r) => (
        <span className="text-muted-foreground">{r.recordedByName ?? t("payments.none")}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12 text-end",
      cell: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              aria-label={t("payments.actionsAria")}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl">
            <DropdownMenuItem onSelect={() => setDetails(r)}>
              <Eye className="size-4" aria-hidden />
              {t("payments.details")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setForm({ mode: "edit", payment: r })}>
              <Pencil className="size-4" aria-hidden />
              {t("payments.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setDeleting(r)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
              {t("payments.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notifySuccess("payments.deleted");
      setDeleting(null);
      if (details?.id === deleting.id) setDetails(null);
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("payments.title")}
        description={t("payments.subtitle")}
        actions={
          <Button className="rounded-xl" onClick={() => setForm({ mode: "create" })}>
            <Plus className="size-4" aria-hidden />
            {t("payments.record")}
          </Button>
        }
      />

      <section className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t("payments.totalCollected")}
            value={stat(totals.totalDzd)}
            hint={t("payments.allTime")}
            icon={Wallet}
          />
          <StatCard
            label={t("payments.paymentCount")}
            value={String(totals.count)}
            hint={t("payments.allTime")}
            icon={Hash}
            tone="neutral"
          />
          <StatCard
            label={t("payments.today")}
            value={stat(totals.todayDzd)}
            hint={countHint(totals.todayCount)}
            icon={BadgeDollarSign}
            tone="success"
          />
          <StatCard
            label={t("payments.thisMonth")}
            value={stat(totals.monthDzd)}
            hint={countHint(totals.monthCount)}
            icon={CalendarDays}
            tone="success"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("payments.actualOnly")}</p>
      </section>

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={ledger.isLoading}
        error={ledger.error}
        onRetry={() => void ledger.refetch()}
        isRetrying={ledger.isFetching}
        rowKey={(r) => r.id}
        searchable={(r) =>
          [r.studentName, r.groupName, r.reference, r.note, r.recordedByName]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder={t("payments.search")}
        emptyTitle={t("payments.emptyTitle")}
        emptyDescription={t("payments.emptyBody")}
        filters={
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="pay-from" className="text-xs text-muted-foreground">
                {t("payments.filter.from")}
              </Label>
              <Input
                id="pay-from"
                type="date"
                dir="ltr"
                className="h-9 w-40 rounded-xl"
                value={filters.from}
                max={filters.to}
                onChange={(e) => e.target.value && setFilter("from", e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="pay-to" className="text-xs text-muted-foreground">
                {t("payments.filter.to")}
              </Label>
              <Input
                id="pay-to"
                type="date"
                dir="ltr"
                className="h-9 w-40 rounded-xl"
                value={filters.to}
                min={filters.from}
                onChange={(e) => e.target.value && setFilter("to", e.target.value)}
              />
            </div>
            <Select
              value={filters.method}
              onValueChange={(v) => setFilter("method", v as PaymentMethod | "all")}
            >
              <SelectTrigger
                className="h-9 w-40 rounded-xl"
                aria-label={t("payments.filter.method")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("payments.filter.allMethods")}</SelectItem>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`payments.method.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.groupId} onValueChange={(v) => setFilter("groupId", v)}>
              <SelectTrigger
                className="h-9 w-48 rounded-xl"
                aria-label={t("payments.filter.group")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("payments.filter.allGroups")}</SelectItem>
                {groups.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.studentId} onValueChange={(v) => setFilter("studentId", v)}>
              <SelectTrigger
                className="h-9 w-48 rounded-xl"
                aria-label={t("payments.filter.student")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("payments.filter.allStudents")}</SelectItem>
                {students.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {ledger.data && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {t("payments.shown", {
              count: rows.length,
              amount: formatDzd(sumAmounts(rows), locale),
            })}
          </p>
          {ledger.data.truncated && (
            <p className="text-destructive">
              {t("payments.truncated", { limit: LEDGER_LIMIT, total: ledger.data.total })}
            </p>
          )}
        </div>
      )}

      {form && (
        <PaymentFormDialog
          key={form.mode === "edit" ? form.payment.id : "create"}
          state={form}
          payable={payable.data ?? []}
          payableLoading={payable.isLoading}
          today={today}
          onClose={() => setForm(null)}
        />
      )}

      <PaymentDetailsDialog
        payment={details}
        onClose={() => setDetails(null)}
        onEdit={(p) => {
          setDetails(null);
          setForm({ mode: "edit", payment: p });
        }}
        onDelete={(p) => setDeleting(p)}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (remove.isPending) return;
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">{t("payments.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {deleting &&
                t("payments.deleteBody", {
                  amount: formatDzd(deleting.amountDzd, locale),
                  student: deleting.studentName ?? t("payments.none"),
                  date: formatDate(deleting.paidOn, locale),
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-xl" disabled={remove.isPending}>
              {t("ui.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                // Keep the dialog open while the delete runs, so a second click cannot
                // fire a second DELETE and the pending state stays visible.
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("payments.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

/**
 * Record or correct a payment.
 *
 * In edit mode the registration is shown, not offered: the database refuses to move a
 * payment to another family (column-level UPDATE grant), and a form that offered it would
 * fail on save.
 */
function PaymentFormDialog({
  state,
  payable,
  payableLoading,
  today,
  onClose,
}: {
  state: FormState;
  payable: PayableRegistration[];
  payableLoading: boolean;
  today: string;
  onClose: () => void;
}) {
  const { t, locale, dir } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const record = useRecordPayment();
  const update = useUpdatePayment();
  const editing = state.mode === "edit" ? state.payment : null;

  // Who pays (the student, chosen once), then what for (one of their approved enrollments).
  const [studentId, setStudentId] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(
    editing?.registrationId ?? null,
  );
  // Set once the admin types an amount: a proposal never overwrites what they entered.
  const [amountTouched, setAmountTouched] = useState(!!editing);
  const [draft, setDraft] = useState<PaymentDraft>(() => ({
    amount: editing ? String(editing.amountDzd) : "",
    paidOn: editing?.paidOn ?? today,
    method: editing?.method ?? "cash",
    note: editing?.note ?? "",
    reference: editing?.reference ?? "",
  }));
  const [submitted, setSubmitted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const set = <K extends keyof PaymentDraft>(key: K, value: PaymentDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // What the chosen student's enrollments owe, from Fees & Installments (ADR-005). The payment
  // form only CONSUMES obligations; it never defines a price.
  const feeTypes = useFeeTypes();
  const chargesQuery = useStudentCharges(studentId ?? "", !editing && !!studentId);
  const paidQuery = useStudentPayments(studentId ?? "", !editing && !!studentId);
  const chargeTitle = useChargeTitle(feeTypes.data ?? []);
  const feesLoading = !!studentId && (chargesQuery.isLoading || paidQuery.isLoading);
  const suggestionFor = (regId: string): PaymentSuggestion | null =>
    chargesQuery.data && paidQuery.data
      ? paymentSuggestion(
          chargesQuery.data.filter((c) => c.registrationId === regId),
          paidQuery.data.filter((p) => p.registrationId === regId),
          today,
        )
      : null;

  const validation = validatePaymentDraft(draft, today);
  const errors: Partial<Record<PaymentField | "student" | "enrollment", string>> = validation.ok
    ? {}
    : { ...validation.errors };
  const students = useMemo(() => payableStudents(payable), [payable]);
  const enrollments = useMemo(() => enrollmentsOf(payable, studentId), [payable, studentId]);
  // Only an approved enrollment of the chosen student can be submitted.
  const selected = selectedEnrollment(payable, studentId, registrationId);
  const student = students.find((s) => s.studentId === studentId) ?? null;
  if (!editing && !student) errors.student = "payments.error.student";
  else if (!editing && !selected) errors.enrollment = "payments.error.enrollment";
  // Messages appear once the admin has tried to save, or as soon as a field holds something
  // wrong -- never on an untouched empty form.
  const show = (field: PaymentField | "student" | "enrollment") =>
    errors[field] &&
    (submitted ||
      (field !== "student" && field !== "enrollment" && draft[field as PaymentField] !== ""))
      ? t(errors[field] as string)
      : null;

  const pending = record.isPending || update.isPending;

  // The amount is PROPOSED from the next unpaid installment of the chosen enrollment, and stays
  // editable (a payment is what was received, possibly partial). No fee, or fully paid: nothing
  // is proposed and the field is left empty.
  const suggestion = selected ? suggestionFor(selected.registrationId) : null;
  const proposed = suggestion?.kind === "due" ? String(suggestion.amountDzd) : "";
  useEffect(() => {
    if (editing || amountTouched) return;
    setDraft((d) => (d.amount === proposed ? d : { ...d, amount: proposed }));
  }, [editing, amountTouched, proposed]);

  const chooseStudent = (id: string) => {
    setStudentId(id);
    // Never carry the previous student's enrollment over; preselect a single one.
    setRegistrationId(enrollmentAfterStudentChange(payable, id));
    setAmountTouched(false);
    set("amount", "");
    setPickerOpen(false);
  };

  const submit = () => {
    setSubmitted(true);
    if (!validation.ok || (!editing && !selected)) return;
    const onSuccess = () => {
      notifySuccess(editing ? "payments.updated" : "payments.recorded");
      onClose();
    };
    if (editing) {
      update.mutate({ id: editing.id, ...validation.values }, { onSuccess, onError: notifyError });
    } else {
      record.mutate(
        { registrationId: (selected as PayableRegistration).registrationId, ...validation.values },
        { onSuccess, onError: notifyError },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(editing ? "payments.editTitle" : "payments.recordTitle")}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {editing ? (
            <div className="space-y-1.5">
              <Label>{t("payments.registration")}</Label>
              <div className="surface-row px-3 py-2 text-sm">
                <p className="font-medium">{editing.studentName ?? t("payments.none")}</p>
                <p className="text-xs text-muted-foreground">
                  {editing.groupName ?? t("payments.none")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("payments.registrationLocked")}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label id="pay-student-label">{t("payments.student")}</Label>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      aria-labelledby="pay-student-label"
                      data-testid="pay-student"
                      className="h-11 w-full justify-between rounded-xl font-normal"
                      disabled={payableLoading}
                    >
                      <span className={cn("truncate", !student && "text-muted-foreground")}>
                        {student ? (student.studentName ?? "—") : t("payments.studentPick")}
                      </span>
                      {payableLoading ? (
                        <Loader2 className="size-4 animate-spin opacity-60" aria-hidden />
                      ) : (
                        <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder={t("payments.studentSearch")} />
                      <CommandList>
                        <CommandEmpty>{t("payments.studentNone")}</CommandEmpty>
                        <CommandGroup>
                          {students.map((s) => (
                            <CommandItem
                              key={s.studentId}
                              value={`${s.studentName ?? ""} ${s.studentId}`}
                              onSelect={() => chooseStudent(s.studentId)}
                            >
                              <Check
                                className={cn(
                                  "size-4",
                                  s.studentId === studentId ? "opacity-100" : "opacity-0",
                                )}
                                aria-hidden
                              />
                              <span className="truncate">{s.studentName ?? "—"}</span>
                              {s.enrollmentCount > 1 && (
                                <span className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {t("payments.enrollmentCount", { count: s.enrollmentCount })}
                                </span>
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {show("student") && <p className="text-xs text-destructive">{show("student")}</p>}
              </div>

              {student && (
                <div className="space-y-1.5" data-testid="pay-enrollments">
                  <Label id="pay-enrollment-label">{t("payments.enrollment")}</Label>
                  <RadioGroup
                    // Radix defaults to ltr; the page direction keeps the radios on the start side.
                    dir={dir}
                    value={registrationId ?? ""}
                    onValueChange={(v) => {
                      if (!v) return;
                      setRegistrationId(v);
                      setAmountTouched(false);
                    }}
                    aria-labelledby="pay-enrollment-label"
                    className="gap-2"
                  >
                    {enrollments.map((e) => {
                      const due = suggestionFor(e.registrationId);
                      return (
                        <label
                          key={e.registrationId}
                          htmlFor={`pay-enrollment-${e.registrationId}`}
                          data-testid="pay-enrollment"
                          className={cn(
                            "surface-row flex cursor-pointer items-start gap-3 px-3 py-2 text-sm",
                            e.registrationId === registrationId && "ring-2 ring-primary/40",
                          )}
                        >
                          <RadioGroupItem
                            value={e.registrationId}
                            id={`pay-enrollment-${e.registrationId}`}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {e.groupName ?? t("payments.none")}
                            </span>
                            {e.programName && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {e.programName}
                              </span>
                            )}
                            <span
                              className={cn(
                                "block text-xs tabular-nums",
                                due?.kind === "due" && due.overdue
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                              )}
                            >
                              {feesLoading
                                ? "…"
                                : due?.kind === "due"
                                  ? t("payments.due.next", {
                                      amount: formatDzd(due.amountDzd, locale),
                                      date: formatDate(due.dueOn, locale),
                                    })
                                  : due?.kind === "settled"
                                    ? t("payments.due.settledShort")
                                    : t("payments.due.noneShort")}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                  {show("enrollment") && (
                    <p className="text-xs text-destructive">{show("enrollment")}</p>
                  )}
                </div>
              )}

              {selected && (
                <div
                  className="surface-row space-y-0.5 px-3 py-2 text-xs"
                  data-testid="pay-due"
                  data-kind={feesLoading ? "loading" : (suggestion?.kind ?? "none")}
                >
                  {feesLoading ? (
                    <Loader2 className="size-4 animate-spin opacity-60" aria-hidden />
                  ) : suggestion?.kind === "due" ? (
                    <>
                      <p className="text-sm font-medium">
                        {chargeTitle(
                          (chargesQuery.data ?? []).find((c) => c.id === suggestion.chargeId) ?? {
                            feeType: "other",
                            label: null,
                          },
                        )}
                      </p>
                      <p className={cn("tabular-nums", suggestion.overdue && "text-destructive")}>
                        {t("payments.due.next", {
                          amount: formatDzd(suggestion.amountDzd, locale),
                          date: formatDate(suggestion.dueOn, locale),
                        })}
                      </p>
                      <p className="tabular-nums text-muted-foreground">
                        {t("payments.due.remaining", {
                          amount: formatDzd(suggestion.remainingDzd, locale),
                        })}
                        {suggestion.overdueDzd > 0 &&
                          ` · ${t("payments.due.overdue", {
                            amount: formatDzd(suggestion.overdueDzd, locale),
                            count: suggestion.overdueCount,
                          })}`}
                      </p>
                    </>
                  ) : suggestion?.kind === "settled" ? (
                    <p>{t("payments.due.settled")}</p>
                  ) : (
                    <p>{t("payments.due.none")}</p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">{t("payments.amount")}</Label>
              {/* `dir="ltr"`: an amount and a date are direction-neutral and must not be
                  reordered by an Arabic page. */}
              <Input
                id="pay-amount"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.amount}
                aria-invalid={!!show("amount")}
                onChange={(e) => {
                  set("amount", e.target.value);
                  setAmountTouched(true);
                }}
              />
              {show("amount") ? (
                <p className="text-xs text-destructive">{show("amount")}</p>
              ) : (
                !editing &&
                suggestion?.kind === "due" && (
                  <p className="text-xs text-muted-foreground" data-testid="pay-amount-hint">
                    {draft.amount.trim() === proposed
                      ? t("payments.amountProposed")
                      : t("payments.amountChanged", {
                          amount: formatDzd(suggestion.amountDzd, locale),
                        })}
                  </p>
                )
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">{t("payments.paidOn")}</Label>
              <Input
                id="pay-date"
                type="date"
                dir="ltr"
                max={today}
                className="h-11 rounded-xl"
                value={draft.paidOn}
                aria-invalid={!!show("paidOn")}
                onChange={(e) => set("paidOn", e.target.value)}
              />
              {show("paidOn") && <p className="text-xs text-destructive">{show("paidOn")}</p>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">{t("payments.method")}</Label>
              <Select value={draft.method} onValueChange={(v) => set("method", v as PaymentMethod)}>
                <SelectTrigger id="pay-method" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`payments.method.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-reference">{t("payments.reference")}</Label>
              <Input
                id="pay-reference"
                dir="ltr"
                autoComplete="off"
                className="h-11 rounded-xl"
                value={draft.reference}
                aria-invalid={!!show("reference")}
                onChange={(e) => set("reference", e.target.value)}
              />
              {show("reference") ? (
                <p className="text-xs text-destructive">{show("reference")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("payments.referenceHint")}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="pay-note">{t("payments.note")}</Label>
              <span
                className={cn(
                  "text-xs tabular-nums text-muted-foreground",
                  draft.note.trim().length > PAYMENT_NOTE_MAX && "text-destructive",
                )}
              >
                {t("payments.noteCount", {
                  count: draft.note.trim().length,
                  max: PAYMENT_NOTE_MAX,
                })}
              </span>
            </div>
            <Textarea
              id="pay-note"
              rows={2}
              value={draft.note}
              aria-invalid={!!show("note")}
              onChange={(e) => set("note", e.target.value)}
            />
            {show("note") && <p className="text-xs text-destructive">{show("note")}</p>}
          </div>

          {editing && (
            <p className="text-xs text-muted-foreground">
              {formatDzd(editing.amountDzd, locale)} · {formatDate(editing.paidOn, locale)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              {t("ui.cancel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t(editing ? "payments.save" : "payments.record")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------ */

function PaymentDetailsDialog({
  payment,
  onClose,
  onEdit,
  onDelete,
}: {
  payment: PaymentRecord | null;
  onClose: () => void;
  onEdit: (p: PaymentRecord) => void;
  onDelete: (p: PaymentRecord) => void;
}) {
  const { t, locale } = useI18n();
  const none = t("payments.none");
  const edited = payment
    ? payment.updatedAt.slice(0, 19) !== payment.createdAt.slice(0, 19)
    : false;

  return (
    <Dialog open={payment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        {payment && (
          <>
            <DialogHeader>
              <DialogTitle className="text-start">{t("payments.detailsTitle")}</DialogTitle>
              <DialogDescription className="text-start">
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatDzd(payment.amountDzd, locale)}
                </span>
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <Detail label={t("payments.col.student")}>
                <span className="font-medium">{payment.studentName ?? none}</span>
                {payment.studentEmail && (
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    {payment.studentEmail}
                  </span>
                )}
              </Detail>
              <Detail label={t("payments.col.group")}>{payment.groupName ?? none}</Detail>
              <Detail label={t("payments.col.date")}>
                <span className="tabular-nums">{formatDate(payment.paidOn, locale)}</span>
              </Detail>
              <Detail label={t("payments.col.method")}>
                {t(`payments.method.${payment.method}`)}
              </Detail>
              <Detail label={t("payments.field.reference")}>
                <span dir="ltr">{payment.reference ?? none}</span>
              </Detail>
              <Detail label={t("payments.col.recordedBy")}>{payment.recordedByName ?? none}</Detail>
              <Detail label={t("payments.field.note")}>
                <span className="whitespace-pre-line">{payment.note ?? none}</span>
              </Detail>
              <Detail label={t("payments.field.createdAt")}>
                <span className="tabular-nums">{formatDateTime(payment.createdAt, locale)}</span>
              </Detail>
              {edited && (
                <Detail label={t("payments.field.updatedAt")}>
                  <span className="tabular-nums">{formatDateTime(payment.updatedAt, locale)}</span>
                </Detail>
              )}
              <Detail label={t("payments.field.id")}>
                <span className="break-all font-mono text-xs text-muted-foreground" dir="ltr">
                  {payment.id}
                </span>
              </Detail>
            </dl>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(payment)}
              >
                <Trash2 className="size-4" aria-hidden />
                {t("payments.delete")}
              </Button>
              <div className="flex flex-wrap gap-2">
                <PaymentReceiptLink paymentId={payment.id} />
                <Button variant="outline" className="rounded-xl" onClick={() => onEdit(payment)}>
                  <Pencil className="size-4" aria-hidden />
                  {t("payments.edit")}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The payment's current receipt (issued automatically, ADR-006). */
function PaymentReceiptLink({ paymentId }: { paymentId: string }) {
  const { t } = useI18n();
  const receipt = usePaymentReceipt(paymentId);
  if (!receipt.data) return null;
  return (
    <Button asChild variant="outline" className="rounded-xl" data-testid="payment-receipt">
      <Link to="/documents/receipts/$receiptId" params={{ receiptId: receipt.data.id }}>
        <Printer className="size-4" aria-hidden />
        {t("receipts.open")} · <span dir="ltr">{receipt.data.number}</span>
      </Link>
    </Button>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
