import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Providing a sort value makes the column header sortable. */
  sortValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  isLoading?: boolean;
  error?: unknown;
  /** Wired to react-query's `refetch` so a failed load can be retried in place. */
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean | undefined;
  searchPlaceholder?: string;
  searchable?: (row: T) => string;
  rowKey: (row: T) => string;
  pageSize?: number;
  toolbar?: ReactNode;
  /** Filter controls rendered on a second toolbar row. */
  filters?: ReactNode;
  /** Enables row checkboxes; receives the selected rows. */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  emptyState?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function DataTable<T>({
  rows,
  columns,
  isLoading,
  error,
  onRetry,
  isRetrying,
  searchPlaceholder,
  searchable,
  rowKey,
  pageSize = 10,
  toolbar,
  filters,
  bulkActions,
  emptyState,
  emptyTitle,
  emptyDescription,
}: DataTableProps<T>) {
  const { t } = useI18n();
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("ui.searchPlaceholder");
  const resolvedEmptyTitle = emptyTitle ?? t("ui.emptyTitle");
  const resolvedEmptyDescription = emptyDescription ?? t("ui.emptyDescription");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => {
    if (!query.trim() || !searchable) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((row) => searchable(row).toLowerCase().includes(q));
  }, [rows, query, searchable]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return filtered;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv), "fr") * factor;
    });
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key === key ? (prev.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" },
    );

  const selectedRows = rows.filter((row) => selected.includes(rowKey(row)));
  const allVisibleSelected =
    visible.length > 0 && visible.every((row) => selected.includes(rowKey(row)));

  const clearSelection = () => setSelected([]);

  const isEmpty = !isLoading && !error && sorted.length === 0;
  const showBareEmptyState = isEmpty && !query.trim() && emptyState;

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {searchable && (
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder={resolvedSearchPlaceholder}
                aria-label={resolvedSearchPlaceholder}
                className="h-10 rounded-xl ltr:pl-9 rtl:pr-9"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:ms-auto">{toolbar}</div>
        </div>
        {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      </div>

      {bulkActions && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-primary-soft/60 px-4 py-2.5 text-sm">
          <span className="font-medium text-primary">
            {t("ui.selected", { count: String(selectedRows.length) })}
          </span>
          <div className="flex flex-wrap items-center gap-2 ms-auto">
            {bulkActions(selectedRows, clearSelection)}
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={clearSelection}>
              {t("ui.cancel")}
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <ErrorState
          error={error}
          onRetry={onRetry}
          isRetrying={isRetrying}
          className="border-none shadow-none"
        />
      ) : isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : showBareEmptyState ? (
        <>{emptyState}</>
      ) : isEmpty ? (
        <EmptyState
          icon={Inbox}
          title={resolvedEmptyTitle}
          description={resolvedEmptyDescription}
          className="border-none shadow-none"
        />
      ) : (
        // `min-w-0` lets this shrink below the table's intrinsic width. Without
        // it the flex/grid parent adopts that width and the whole page scrolls
        // sideways instead of just the table.
        <div className="max-h-[65vh] min-w-0 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="hover:bg-transparent">
                {bulkActions && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      aria-label={t("ui.selectAll")}
                      onCheckedChange={(checked) =>
                        setSelected((prev) =>
                          checked
                            ? Array.from(new Set([...prev, ...visible.map(rowKey)]))
                            : prev.filter((id) => !visible.some((row) => rowKey(row) === id)),
                        )
                      }
                    />
                  </TableHead>
                )}
                {columns.map((c) => (
                  <TableHead key={c.key} className={c.className}>
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="focus-ring inline-flex items-center gap-1 rounded-md text-start hover:text-foreground"
                      >
                        {c.header}
                        {sort?.key === c.key ? (
                          sort.dir === "asc" ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3.5" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const id = rowKey(row);
                const checked = selected.includes(id);
                return (
                  <TableRow
                    key={id}
                    data-state={checked ? "selected" : undefined}
                    className={cn("transition-colors hover:bg-muted/50")}
                  >
                    {bulkActions && (
                      <TableCell className="w-10">
                        <Checkbox
                          checked={checked}
                          aria-label={t("ui.selectRow")}
                          onCheckedChange={(value) =>
                            setSelected((prev) =>
                              value ? [...prev, id] : prev.filter((x) => x !== id),
                            )
                          }
                        />
                      </TableCell>
                    )}
                    {columns.map((c) => (
                      <TableCell key={c.key} className={c.className}>
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {!isLoading && !error && sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {t("ui.pageOf", {
              from: String(current * pageSize + 1),
              to: String(Math.min(sorted.length, (current + 1) * pageSize)),
              total: String(sorted.length),
            })}
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="size-9 rounded-xl"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label={t("ui.previousPage")}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9 rounded-xl"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
              aria-label={t("ui.nextPage")}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
