/**
 * Reçus: every receipt, issued automatically for each payment (ADR-006 section 3).
 *
 * Read-only: receipts follow payments (recorded -> issued; edited -> voided and re-issued;
 * deleted -> voided). Numbers are never reused, and a voided receipt stays listed.
 */

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FileCheck2, Printer } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { useReceipts, type Receipt } from "@/features/finance/queries";
import { exportCsv } from "@/lib/export-csv";
import { formatDate, formatDzd } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/receipts")({
  head: () => ({ meta: [{ title: "Reçus — Gestion École" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <ReceiptsPage />
    </RequireAuth>
  ),
});

type View = "all" | "issued" | "voided";

function ReceiptsPage() {
  const { t, locale } = useI18n();
  const receipts = useReceipts();
  const [view, setView] = useState<View>("all");
  const rows = (receipts.data ?? []).filter((r) => view === "all" || r.status === view);

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error(t("entity.common.noRows"));
      return;
    }
    exportCsv(
      "recus",
      rows.map((r) => ({
        [t("finance.col.number")]: r.number,
        [t("finance.col.date")]: r.paidOn,
        [t("finance.col.student")]: r.studentName ?? "",
        [t("finance.col.enrollment")]: [r.programName, r.groupName].filter(Boolean).join(" · "),
        [t("finance.col.amount")]: r.amountDzd,
        [t("finance.col.method")]: t(`payments.method.${r.method}`),
        [t("finance.col.status")]: t(`finance.status.${r.status}`),
      })),
    );
    toast.success(t("finance.exported", { count: rows.length }));
  };

  const columns: Column<Receipt>[] = [
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
          {r.status === "voided" && (
            <p className="text-xs text-destructive">
              {t("receipts.voidedBecause", { reason: r.voidReason ?? "" })}
            </p>
          )}
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
        </div>
      ),
    },
    {
      key: "date",
      header: t("finance.col.date"),
      className: "hidden md:table-cell",
      sortValue: (r) => r.paidOn,
      cell: (r) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatDate(r.paidOn, locale)} · {t(`payments.method.${r.method}`)}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("finance.col.amount"),
      className: "text-end",
      sortValue: (r) => r.amountDzd,
      cell: (r) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            r.status === "voided" && "text-muted-foreground line-through",
          )}
        >
          {formatDzd(r.amountDzd, locale)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (r) => (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          aria-label={t("receipts.open")}
        >
          <Link
            to="/documents/receipts/$receiptId"
            params={{ receiptId: r.id }}
            data-testid="receipt-open"
          >
            <Printer className="size-4" aria-hidden />
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("receipts.title")}
        description={t("receipts.subtitle")}
        actions={
          <Button variant="outline" className="rounded-xl" onClick={handleExport}>
            <Download className="size-4" aria-hidden /> {t("entity.common.export")}
          </Button>
        }
      />
      <DataTable
        rows={rows}
        columns={columns}
        isLoading={receipts.isLoading}
        error={receipts.error}
        onRetry={() => void receipts.refetch()}
        isRetrying={receipts.isFetching}
        rowKey={(r) => r.id}
        pageSize={50}
        searchable={(r) =>
          [r.number, r.studentName, r.groupName, r.programName, r.reference]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder={t("finance.search")}
        emptyState={
          <EmptyState
            icon={FileCheck2}
            title={t("receipts.emptyTitle")}
            description={t("receipts.emptyBody")}
          />
        }
        filters={
          <Select value={view} onValueChange={(v) => v && setView(v as View)}>
            <SelectTrigger className="h-9 w-44 rounded-xl" aria-label={t("receipts.filter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "issued", "voided"] as const).map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`receipts.view.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </>
  );
}
