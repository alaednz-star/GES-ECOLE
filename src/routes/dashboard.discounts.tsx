/**
 * Remises & bourses: the discount catalogue and every discount granted (ADR-006 section 2).
 *
 * A discount reduces what an enrollment owes; it never edits a fee or a payment. Granting happens
 * on the student page, on a fee; this page manages the catalogue and shows the grants.
 */

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, Loader2, Pencil, Percent, Plus, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { RequireAuth } from "@/features/auth/require-auth";
import {
  useDiscountGrants,
  useDiscounts,
  useSaveDiscount,
  useSetDiscountActive,
  type DiscountGrant,
} from "@/features/finance/queries";
import {
  validateDiscountDraft,
  type Discount,
  type DiscountDraft,
} from "@/features/finance/discount-model";
import { useFeeTypes } from "@/features/school/fees";
import { useFeeTypeName } from "@/features/school/fee-labels";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, formatDzd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/discounts")({
  head: () => ({
    meta: [{ title: "Remises & bourses — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <DiscountsPage />
    </RequireAuth>
  ),
});

function DiscountsPage() {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const catalogue = useDiscounts();
  const grants = useDiscountGrants();
  const feeTypes = useFeeTypes();
  const typeName = useFeeTypeName(feeTypes.data ?? []);
  const setActive = useSetDiscountActive();
  const [editing, setEditing] = useState<Discount | "new" | null>(null);

  const valueText = (d: Pick<Discount, "kind" | "value">) =>
    d.kind === "percent"
      ? t("discounts.valueShortPercent", { value: d.value })
      : t("discounts.valueShortAmount", { amount: formatDzd(d.value, locale) });

  const grantColumns: Column<DiscountGrant>[] = [
    {
      key: "student",
      header: t("finance.col.student"),
      sortValue: (g) => g.studentName ?? "",
      cell: (g) => (
        <div className="min-w-0">
          {g.studentId ? (
            <Link
              to="/dashboard/students/$studentId"
              params={{ studentId: g.studentId }}
              className="focus-ring block truncate rounded font-medium hover:text-primary"
            >
              {g.studentName ?? "—"}
            </Link>
          ) : (
            <span>{g.studentName ?? "—"}</span>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {[g.groupName, typeName(g.chargeFeeType) + (g.chargeLabel ? ` · ${g.chargeLabel}` : "")]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ),
    },
    {
      key: "label",
      header: t("discounts.label"),
      sortValue: (g) => g.label,
      cell: (g) => (
        <div className={cn("min-w-0", g.status === "cancelled" && "text-muted-foreground")}>
          <p className={cn("truncate", g.status === "cancelled" && "line-through")}>{g.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {g.status === "cancelled"
              ? t("discounts.cancelledBecause", { reason: g.cancelReason ?? "" })
              : (g.reason ?? t("discounts.grantedOn", { date: formatDate(g.grantedAt, locale) }))}
          </p>
        </div>
      ),
    },
    {
      key: "amount",
      header: t("finance.col.amount"),
      className: "text-end",
      sortValue: (g) => g.amountDzd,
      cell: (g) => (
        <span
          className={cn(
            "tabular-nums",
            g.status === "cancelled" && "text-muted-foreground line-through",
          )}
        >
          {formatDzd(g.amountDzd, locale)}
        </span>
      ),
    },
    {
      key: "date",
      header: t("finance.col.date"),
      className: "hidden md:table-cell",
      sortValue: (g) => g.grantedAt,
      cell: (g) => (
        <span className="text-xs text-muted-foreground">{formatDate(g.grantedAt, locale)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("discounts.title")} description={t("discounts.subtitle")} />

      <SectionCard
        title={t("discounts.catalogue")}
        description={t("discounts.editNote")}
        actions={
          <Button
            size="sm"
            className="rounded-xl"
            onClick={() => setEditing("new")}
            data-testid="discount-add"
          >
            <Plus className="size-4" aria-hidden />
            {t("discounts.add")}
          </Button>
        }
      >
        {catalogue.error ? (
          <ErrorState
            error={catalogue.error}
            onRetry={() => void catalogue.refetch()}
            className="border-none shadow-none"
          />
        ) : catalogue.isLoading ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : (catalogue.data ?? []).length === 0 ? (
          <EmptyState
            icon={Percent}
            title={t("discounts.emptyCatalogue")}
            description={t("discounts.emptyCatalogueBody")}
            className="border-none shadow-none"
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="discount-catalogue">
            {(catalogue.data ?? []).map((d) => (
              <li
                key={d.id}
                data-testid="discount-item"
                className={cn(
                  "surface-row flex items-start justify-between gap-3 px-3 py-2.5",
                  !d.active && "opacity-60",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {d.name} <span className="tabular-nums text-primary">{valueText(d)}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.feeType ? typeName(d.feeType) : t("discounts.feeType.any")} ·{" "}
                    {t(d.active ? "discounts.state.active" : "discounts.state.archived")}
                  </p>
                  {d.description && (
                    <p className="truncate text-xs text-muted-foreground">{d.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg"
                    aria-label={t("fees.edit")}
                    onClick={() => setEditing(d)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg"
                    aria-label={t(d.active ? "discounts.archive" : "discounts.restore")}
                    disabled={setActive.isPending}
                    onClick={() =>
                      setActive.mutate(
                        { id: d.id, active: !d.active },
                        {
                          onSuccess: () =>
                            notifySuccess(
                              d.active ? "discounts.archivedDone" : "discounts.restored",
                            ),
                          onError: notifyError,
                        },
                      )
                    }
                  >
                    {d.active ? (
                      <Archive className="size-4" aria-hidden />
                    ) : (
                      <RotateCcw className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={t("discounts.grants")}>
        <DataTable
          rows={grants.data ?? []}
          columns={grantColumns}
          isLoading={grants.isLoading}
          error={grants.error}
          onRetry={() => void grants.refetch()}
          isRetrying={grants.isFetching}
          rowKey={(g) => g.id}
          pageSize={50}
          searchable={(g) =>
            [g.studentName, g.groupName, g.label, g.reason].filter(Boolean).join(" ")
          }
          searchPlaceholder={t("finance.search")}
          emptyState={
            <EmptyState
              icon={Percent}
              title={t("discounts.emptyGrants")}
              description={t("discounts.emptyGrantsBody")}
            />
          }
        />
      </SectionCard>

      {editing && (
        <DiscountDialog
          discount={editing === "new" ? null : editing}
          feeTypes={(feeTypes.data ?? []).filter((f) => f.active).map((f) => f.code)}
          typeName={typeName}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function DiscountDialog({
  discount,
  feeTypes,
  typeName,
  onClose,
}: {
  discount: Discount | null;
  feeTypes: string[];
  typeName: (code: string) => string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveDiscount();
  const [draft, setDraft] = useState<DiscountDraft>(() => ({
    name: discount?.name ?? "",
    kind: discount?.kind ?? "percent",
    value: discount ? String(discount.value) : "",
    feeType: discount?.feeType ?? null,
    description: discount?.description ?? "",
  }));
  const [submitted, setSubmitted] = useState(false);
  const validation = validateDiscountDraft(draft);
  const errors = validation.ok ? {} : validation.errors;
  const show = (f: "name" | "value" | "description") =>
    errors[f] && (submitted || draft[f] !== "") ? t(errors[f] as string) : null;

  const submit = () => {
    setSubmitted(true);
    if (!validation.ok) return;
    save.mutate(
      { ...(discount ? { id: discount.id } : {}), ...validation.values },
      {
        onSuccess: () => {
          notifySuccess("discounts.saved");
          onClose();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(discount ? "discounts.editTitle" : "discounts.addTitle")}
          </DialogTitle>
          <DialogDescription className="text-start">{t("discounts.editNote")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="discount-name">{t("discounts.name")}</Label>
            <Input
              id="discount-name"
              className="h-11 rounded-xl"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            {show("name") && <p className="text-xs text-destructive">{show("name")}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="discount-kind">{t("discounts.kind")}</Label>
              <Select
                value={draft.kind}
                onValueChange={(v) => v && setDraft({ ...draft, kind: v as DiscountDraft["kind"] })}
              >
                <SelectTrigger id="discount-kind" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">{t("discounts.kind.percent")}</SelectItem>
                  <SelectItem value="amount">{t("discounts.kind.amount")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discount-value">
                {t(draft.kind === "percent" ? "discounts.valuePercent" : "discounts.valueAmount")}
              </Label>
              <Input
                id="discount-value"
                inputMode="numeric"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
              {show("value") && <p className="text-xs text-destructive">{show("value")}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount-fee-type">{t("discounts.feeType")}</Label>
            <Select
              value={draft.feeType ?? "any"}
              onValueChange={(v) => v && setDraft({ ...draft, feeType: v === "any" ? null : v })}
            >
              <SelectTrigger id="discount-fee-type" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("discounts.feeType.any")}</SelectItem>
                {feeTypes.map((code) => (
                  <SelectItem key={code} value={code}>
                    {typeName(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount-description">{t("discounts.description")}</Label>
            <Textarea
              id="discount-description"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            {show("description") && (
              <p className="text-xs text-destructive">{show("description")}</p>
            )}
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
