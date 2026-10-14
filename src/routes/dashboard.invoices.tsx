/**
 * Factures: invoices per enrollment, issued on demand (ADR-006 section 4).
 *
 * An invoice is a frozen document (fees, discounts, payments and balance at issue time). It is
 * never edited: it is voided with a reason and a new one issued. The billing identity (legal
 * identifiers) is set here and frozen into each new invoice.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  Check,
  ChevronsUpDown,
  FileText,
  Loader2,
  Plus,
  Printer,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  useBillingIdentity,
  useFinanceLedger,
  useInvoices,
  useIssueInvoice,
  useSaveBillingIdentity,
  useVoidInvoice,
  type BillingIdentity,
  type Invoice,
} from "@/features/finance/queries";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, formatDzd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/invoices")({
  head: () => ({
    meta: [{ title: "Factures — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <InvoicesPage />
    </RequireAuth>
  ),
});

type View = "all" | "issued" | "voided";

function InvoicesPage() {
  const { t, locale } = useI18n();
  const invoices = useInvoices();
  const identity = useBillingIdentity();
  const [view, setView] = useState<View>("all");
  const [issuing, setIssuing] = useState(false);
  const [billing, setBilling] = useState(false);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const rows = (invoices.data ?? []).filter((r) => view === "all" || r.status === view);

  const columns: Column<Invoice>[] = [
    {
      key: "number",
      header: t("finance.col.number"),
      sortValue: (r) => r.number,
      cell: (r) => (
        <div>
          <p
            className={cn(
              "font-mono text-sm",
              r.status === "voided" && "text-muted-foreground line-through",
            )}
            dir="ltr"
          >
            {r.number}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(r.issuedAt, locale)}</p>
        </div>
      ),
    },
    {
      key: "student",
      header: t("finance.col.student"),
      sortValue: (r) => r.studentName ?? "",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.studentName ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[r.programName, r.groupName].filter(Boolean).join(" · ") || "—"}
          </p>
          {r.status === "voided" && (
            <p className="truncate text-xs text-destructive">
              {t("receipts.voidedBecause", { reason: r.voidReason ?? "" })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "total",
      header: t("finance.col.total"),
      className: "hidden text-end md:table-cell",
      sortValue: (r) => r.totalDzd,
      cell: (r) => (
        <span className="tabular-nums">{formatDzd(r.totalDzd - r.discountDzd, locale)}</span>
      ),
    },
    {
      key: "balance",
      header: t("finance.col.balance"),
      className: "text-end",
      sortValue: (r) => r.balanceDzd,
      cell: (r) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            r.status === "voided" && "text-muted-foreground line-through",
          )}
        >
          {formatDzd(r.balanceDzd, locale)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t("finance.view")}
          >
            <Link
              to="/documents/invoices/$invoiceId"
              params={{ invoiceId: r.id }}
              data-testid="invoice-open"
            >
              <Printer className="size-4" aria-hidden />
            </Link>
          </Button>
          {r.status === "issued" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-destructive"
              aria-label={t("invoices.void")}
              data-testid="invoice-void"
              onClick={() => setVoiding(r)}
            >
              <XCircle className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("invoices.title")}
        description={t("invoices.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setBilling(true)}
              data-testid="billing-open"
            >
              <Building2 className="size-4" aria-hidden /> {t("invoices.billing")}
            </Button>
            <Button
              className="rounded-xl"
              onClick={() => setIssuing(true)}
              data-testid="invoice-issue"
            >
              <Plus className="size-4" aria-hidden /> {t("invoices.issue")}
            </Button>
          </>
        }
      />
      {identity.data && !identity.data.nif && (
        <p
          className="rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent"
          data-testid="billing-missing"
        >
          {t("invoices.billingMissing")}
        </p>
      )}
      <DataTable
        rows={rows}
        columns={columns}
        isLoading={invoices.isLoading}
        error={invoices.error}
        onRetry={() => void invoices.refetch()}
        isRetrying={invoices.isFetching}
        rowKey={(r) => r.id}
        pageSize={50}
        searchable={(r) =>
          [r.number, r.studentName, r.groupName, r.programName].filter(Boolean).join(" ")
        }
        searchPlaceholder={t("finance.search")}
        emptyState={
          <EmptyState
            icon={FileText}
            title={t("invoices.emptyTitle")}
            description={t("invoices.emptyBody")}
          />
        }
        filters={
          <Select value={view} onValueChange={(v) => v && setView(v as View)}>
            <SelectTrigger className="h-9 w-44 rounded-xl" aria-label={t("invoices.filter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "issued", "voided"] as const).map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`invoices.view.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {issuing && <IssueInvoiceDialog onClose={() => setIssuing(false)} />}
      {billing && identity.data && (
        <BillingDialog identity={identity.data} onClose={() => setBilling(false)} />
      )}
      {voiding && <VoidInvoiceDialog invoice={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

/** Student first, then the enrollment (only enrollments with active fees can be invoiced). */
function IssueInvoiceDialog({ onClose }: { onClose: () => void }) {
  const { t, locale, dir } = useI18n();
  const navigate = useNavigate();
  const { notifySuccess, notifyError } = useActionFeedback();
  const ledger = useFinanceLedger();
  const issue = useIssueInvoice();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const invoiceable = useMemo(() => {
    const withFees = new Set(
      (ledger.data?.charges ?? [])
        .filter((c) => c.status === "active")
        .map((c) => c.registrationId),
    );
    return (ledger.data?.enrollments ?? []).filter((e) => withFees.has(e.registrationId));
  }, [ledger.data]);
  const students = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of invoiceable) m.set(e.studentId, e.studentName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoiceable]);
  const enrollments = invoiceable.filter((e) => e.studentId === studentId);
  const owed = (regId: string) =>
    (ledger.data?.charges ?? [])
      .filter((c) => c.registrationId === regId && c.status === "active")
      .reduce((s, c) => s + c.amountDzd, 0);

  const choose = (id: string) => {
    setStudentId(id);
    const own = invoiceable.filter((e) => e.studentId === id);
    setRegistrationId(own.length === 1 ? (own[0]?.registrationId ?? null) : null);
    setOpen(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !issue.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">{t("invoices.issueTitle")}</DialogTitle>
          <DialogDescription className="text-start">{t("invoices.issueBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label id="inv-student-label">{t("invoices.student")}</Label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-labelledby="inv-student-label"
                  data-testid="inv-student"
                  className="h-11 w-full justify-between rounded-xl font-normal"
                  disabled={ledger.isLoading}
                >
                  <span className={cn("truncate", !studentId && "text-muted-foreground")}>
                    {students.find(([id]) => id === studentId)?.[1] ?? t("invoices.pickStudent")}
                  </span>
                  {ledger.isLoading ? (
                    <Loader2 className="size-4 animate-spin opacity-60" aria-hidden />
                  ) : (
                    <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder={t("invoices.searchStudent")} />
                  <CommandList>
                    <CommandEmpty>{t("invoices.noStudent")}</CommandEmpty>
                    <CommandGroup>
                      {students.map(([id, name]) => (
                        <CommandItem key={id} value={`${name} ${id}`} onSelect={() => choose(id)}>
                          <Check
                            className={cn("size-4", id === studentId ? "opacity-100" : "opacity-0")}
                            aria-hidden
                          />
                          <span className="truncate">{name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          {studentId && (
            <div className="space-y-1.5">
              <Label id="inv-enrollment-label">{t("invoices.enrollment")}</Label>
              <RadioGroup
                dir={dir}
                value={registrationId ?? ""}
                onValueChange={(v) => v && setRegistrationId(v)}
                aria-labelledby="inv-enrollment-label"
                className="gap-2"
              >
                {enrollments.map((e) => (
                  <label
                    key={e.registrationId}
                    htmlFor={`inv-enr-${e.registrationId}`}
                    data-testid="inv-enrollment"
                    className="surface-row flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                  >
                    <RadioGroupItem value={e.registrationId} id={`inv-enr-${e.registrationId}`} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.groupName ?? "—"}</span>
                      <span className="block truncate text-xs tabular-nums text-muted-foreground">
                        {[e.programName, formatDzd(owed(e.registrationId), locale)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={issue.isPending}>
            {t("ui.cancel")}
          </Button>
          <Button
            className="rounded-xl"
            disabled={!registrationId || issue.isPending}
            data-testid="inv-confirm"
            onClick={() =>
              registrationId &&
              issue.mutate(registrationId, {
                onSuccess: (id) => {
                  notifySuccess("invoices.issuedShort");
                  onClose();
                  void navigate({
                    to: "/documents/invoices/$invoiceId",
                    params: { invoiceId: id },
                  });
                },
                onError: notifyError,
              })
            }
          >
            {issue.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("invoices.issue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BillingDialog({ identity, onClose }: { identity: BillingIdentity; onClose: () => void }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveBillingIdentity();
  const [form, setForm] = useState({
    legalName: identity.legalName ?? "",
    nif: identity.nif ?? "",
    nis: identity.nis ?? "",
    rc: identity.rc ?? "",
    taxArticle: identity.taxArticle ?? "",
  });
  const fields = [
    ["legalName", "invoices.legalName", 160],
    ["nif", "invoices.nif", 40],
    ["nis", "invoices.nis", 40],
    ["rc", "invoices.rc", 40],
    ["taxArticle", "invoices.taxArticle", 40],
  ] as const;
  const clean = (v: string) => v.trim() || null;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">{t("invoices.billingTitle")}</DialogTitle>
          <DialogDescription className="text-start">{t("invoices.billingBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              {
                id: identity.id,
                legalName: clean(form.legalName),
                nif: clean(form.nif),
                nis: clean(form.nis),
                rc: clean(form.rc),
                taxArticle: clean(form.taxArticle),
              },
              {
                onSuccess: () => {
                  notifySuccess("invoices.billingSaved");
                  onClose();
                },
                onError: notifyError,
              },
            );
          }}
        >
          {fields.map(([key, label, max]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`billing-${key}`}>{t(label)}</Label>
              <Input
                id={`billing-${key}`}
                className="h-11 rounded-xl"
                maxLength={max}
                dir={key === "legalName" ? undefined : "ltr"}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
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

function VoidInvoiceDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const voidInvoice = useVoidInvoice();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < 1 || trimmed.length > 300;
  return (
    <AlertDialog open onOpenChange={(o) => !o && !voidInvoice.isPending && onClose()}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">{t("invoices.voidTitle")}</AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {t("invoices.voidBody", { number: invoice.number })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-void-reason">{t("invoices.voidReason")}</Label>
          <Textarea
            id="invoice-void-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {submitted && invalid && (
            <p className="text-xs text-destructive">{t("discounts.error.reason")}</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={voidInvoice.isPending}>
            {t("invoices.keep")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={voidInvoice.isPending}
            onClick={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (invalid) return;
              voidInvoice.mutate(
                { id: invoice.id, reason: trimmed },
                {
                  onSuccess: () => {
                    notifySuccess("invoices.voided");
                    onClose();
                  },
                  onError: notifyError,
                },
              );
            }}
          >
            {voidInvoice.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("invoices.void")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
