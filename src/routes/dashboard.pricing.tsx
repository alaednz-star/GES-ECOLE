/**
 * Formations & tarifs: the institution's catalogue of every course it sells, with its price
 * (ADR-005 / ADR-006).
 *
 * Two kinds of offer, one price system:
 *   - a FORMATION, priced by its default fees (groups may override them);
 *   - a GROUP WITHOUT FORMATION -- a subject class such as « 3AS Sciences — Mathématiques » --
 *     priced by its own fees.
 * Both are rows of `fee_templates` (the configuration that charges new enrollments). A course is
 * created without a price and priced here, later. Changing a price affects NEW enrollments only;
 * existing charges and payments never change.
 *
 * Editing reuses the fee card (`FeeTemplatesCard`); the export is a CSV in the reader's language.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Pencil, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { usePrograms } from "@/features/school/programs";
import { useGroups } from "@/features/school/queries";
import { useProgramLevelLabel } from "@/features/school/level-system-label";
import { useFormationTypeLabels } from "@/features/school/formation-types";
import { useAllFeeTemplates } from "@/features/school/fee-templates";
import { useFeeTypes } from "@/features/school/fees";
import { useChargeTitle } from "@/features/school/fee-labels";
import {
  catalogueEntry,
  groupCatalogueEntry,
  type CatalogueEntry,
} from "@/features/school/fee-template-model";
import { FeeTemplatesCard } from "@/features/school/components/fee-templates-card";
import { exportCsv } from "@/lib/export-csv";
import { formatDzd } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/pricing")({
  head: () => ({
    meta: [{ title: "Formations & tarifs — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <PricingPage />
    </RequireAuth>
  ),
});

type OfferKind = "formation" | "group";

interface Row {
  kind: OfferKind;
  id: string;
  name: string;
  typeLabel: string;
  subjectName: string | null;
  levelText: string | null;
  durationHours: number | null;
  status: string;
  pricing: CatalogueEntry;
}

type PricingFilter = "all" | "priced" | "unpriced";
type KindFilter = "all" | OfferKind;

function PricingPage() {
  const { t, locale } = useI18n();
  const levelLabel = useProgramLevelLabel();
  const typeLabels = useFormationTypeLabels();
  const programs = usePrograms();
  const groups = useGroups();
  const templates = useAllFeeTemplates();
  const feeTypes = useFeeTypes();
  const chargeTitle = useChargeTitle(feeTypes.data ?? []);
  const [editing, setEditing] = useState<Row | null>(null);
  const [filter, setFilter] = useState<PricingFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");

  const all = useMemo<Row[]>(() => {
    const items = templates.data ?? [];
    const formations: Row[] = (programs.data ?? []).map((p) => ({
      kind: "formation",
      id: p.id,
      name: p.name,
      typeLabel: typeLabels.labelOf(p.category),
      subjectName: p.subjectName,
      levelText: levelLabel(p) ?? null,
      durationHours: p.durationHours,
      status: p.status,
      pricing: catalogueEntry(items, p.id),
    }));
    const standalone: Row[] = (groups.data ?? [])
      .filter((g) => g.programId === null)
      .map((g) => ({
        kind: "group",
        id: g.id,
        name: g.name,
        typeLabel: t("pricing.kind.group"),
        subjectName: g.subjectName,
        levelText: g.levelName,
        durationHours: null,
        status: g.status,
        pricing: groupCatalogueEntry(items, g.id),
      }));
    return [...formations, ...standalone];
  }, [programs.data, groups.data, templates.data, typeLabels, levelLabel, t]);

  const rows = all.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (filter === "all" ||
        (filter === "priced" ? r.pricing.priceDzd !== null : r.pricing.priceDzd === null)),
  );
  const unpriced = all.filter((r) => r.pricing.priceDzd === null).length;

  const feesText = (r: Row) =>
    r.pricing.fees.map((f) => `${chargeTitle(f)} ${formatDzd(f.amountDzd, locale)}`).join(" · ");

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error(t("entity.common.noRows"));
      return;
    }
    exportCsv(
      "formations-tarifs",
      rows.map((r) => ({
        [t("pricing.csv.name")]: r.name,
        [t("pricing.csv.kind")]: t(`pricing.kind.${r.kind}`),
        [t("pricing.csv.type")]: r.typeLabel,
        [t("pricing.csv.subject")]: r.subjectName ?? "",
        [t("pricing.csv.level")]: r.levelText ?? "",
        [t("pricing.csv.duration")]: r.durationHours ?? "",
        [t("pricing.csv.price")]: r.pricing.priceDzd ?? "",
        [t("pricing.csv.fees")]: feesText(r),
        [t("pricing.csv.pricing")]: t(
          r.pricing.priceDzd === null ? "pricing.notConfigured" : "pricing.configured",
        ),
        [t("pricing.csv.status")]: t(`ui.status.${r.status}`),
      })),
    );
    toast.success(t("pricing.exported", { count: rows.length }));
  };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("programs.col.name"),
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          {r.kind === "formation" ? (
            <Link
              to="/dashboard/programs/$programId"
              params={{ programId: r.id }}
              className="focus-ring block max-w-full truncate rounded text-start font-medium hover:text-primary"
            >
              {r.name}
            </Link>
          ) : (
            <Link
              to="/dashboard/groups/$groupId"
              params={{ groupId: r.id }}
              className="focus-ring block max-w-full truncate rounded text-start font-medium hover:text-primary"
            >
              {r.name}
            </Link>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {r.subjectName ?? t("programs.none")}
            {/* On a phone the type, level and status columns give way to the price. */}
            <span className="md:hidden"> · {r.typeLabel}</span>
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: t("programs.col.category"),
      className: "hidden md:table-cell",
      sortValue: (r) => r.typeLabel,
      cell: (r) => <span className="text-muted-foreground">{r.typeLabel}</span>,
    },
    {
      key: "level",
      header: t("pricing.col.level"),
      className: "hidden md:table-cell",
      sortValue: (r) => r.levelText ?? "",
      cell: (r) => <span className="text-muted-foreground">{r.levelText ?? "—"}</span>,
    },
    {
      key: "price",
      header: t("pricing.col.price"),
      sortValue: (r) => r.pricing.priceDzd ?? -1,
      cell: (r) => (
        <div className="min-w-0" data-testid="pricing-price" data-program={r.id}>
          {r.pricing.priceDzd === null ? (
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {t("pricing.notConfigured")}
            </span>
          ) : (
            <>
              <p className="font-semibold tabular-nums">{formatDzd(r.pricing.priceDzd, locale)}</p>
              {r.pricing.fees.length > 1 && (
                <p className="truncate text-xs text-muted-foreground">{feesText(r)}</p>
              )}
            </>
          )}
          {r.pricing.groupsWithOwnFees > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("pricing.groupsWithOwnFees", { count: r.pricing.groupsWithOwnFees })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: t("programs.col.status"),
      className: "hidden md:table-cell",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (r) => (
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          data-testid="pricing-edit"
          onClick={() => setEditing(r)}
        >
          {r.pricing.priceDzd === null ? (
            <Plus className="size-4" aria-hidden />
          ) : (
            <Pencil className="size-4" aria-hidden />
          )}
          {t(r.pricing.priceDzd === null ? "pricing.configure" : "pricing.edit")}
        </Button>
      ),
    },
  ];

  const loading = programs.isLoading || groups.isLoading || templates.isLoading;
  return (
    <>
      <PageHeader
        title={t("pricing.title")}
        description={t("pricing.subtitle", { count: all.length, unpriced })}
        actions={
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={handleExport}
            data-testid="pricing-export"
          >
            <Download className="size-4" aria-hidden /> {t("entity.common.export")}
          </Button>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={loading}
        error={programs.error ?? groups.error ?? templates.error}
        onRetry={() => {
          void programs.refetch();
          void groups.refetch();
          void templates.refetch();
        }}
        isRetrying={programs.isFetching || groups.isFetching || templates.isFetching}
        rowKey={(r) => `${r.kind}:${r.id}`}
        pageSize={50}
        searchable={(r) =>
          [r.name, r.subjectName, r.levelText, r.typeLabel].filter(Boolean).join(" ")
        }
        searchPlaceholder={t("programs.search")}
        emptyState={
          <EmptyState
            icon={Tags}
            title={t("programs.emptyTitle")}
            description={t("pricing.empty")}
          />
        }
        filters={
          <>
            <Select value={kind} onValueChange={(v) => v && setKind(v as KindFilter)}>
              <SelectTrigger
                className="h-9 w-52 rounded-xl"
                aria-label={t("pricing.kindFilter")}
                data-testid="pricing-kind"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("pricing.kindFilter.all")}</SelectItem>
                <SelectItem value="formation">{t("pricing.kindFilter.formation")}</SelectItem>
                <SelectItem value="group">{t("pricing.kindFilter.group")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filter} onValueChange={(v) => v && setFilter(v as PricingFilter)}>
              <SelectTrigger className="h-9 w-48 rounded-xl" aria-label={t("pricing.filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("pricing.filter.all")}</SelectItem>
                <SelectItem value="priced">{t("pricing.filter.priced")}</SelectItem>
                <SelectItem value="unpriced">{t("pricing.filter.unpriced")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {editing && (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-start">{editing.name}</DialogTitle>
              <DialogDescription className="text-start">
                {t("pricing.dialogBody")}
              </DialogDescription>
            </DialogHeader>
            {editing.kind === "formation" ? (
              <FeeTemplatesCard programId={editing.id} />
            ) : (
              <FeeTemplatesCard programId={null} groupId={editing.id} />
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
