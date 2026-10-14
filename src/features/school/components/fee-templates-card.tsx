/**
 * The normal fees of a formation, and a group's optional override (ADR-005).
 *
 *   formation page  -> <FeeTemplatesCard programId={...} />            the formation's defaults
 *   group page      -> <FeeTemplatesCard programId={...} groupId={...} /> inherits, or its own
 *
 * Configuration only: a NEW approved enrollment receives real charges from what applies here
 * (database trigger). Existing students' charges never change when these items change.
 */

import { useState } from "react";
import { Loader2, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { useFeeTypes } from "../fees";
import { useChargeTitle, useFeeTypeName } from "../fee-labels";
import { INSTALLMENTS_MAX, type FeeType } from "../fee-types";
import {
  applicableTemplates,
  buildTemplateSchedule,
  templateToDraft,
  templatesTotal,
  validateTemplateDraft,
  type FeeTemplate,
  type TemplateDraft,
  type TemplateInstallmentDraft,
} from "../fee-template-model";
import { draftScheduleTotal } from "../fee-model";
import {
  useCustomizeGroupFees,
  useFeeTemplates,
  useRemoveFeeTemplate,
  useSaveFeeTemplate,
} from "../fee-templates";

type DialogState =
  | { kind: "add" }
  | { kind: "edit"; item: FeeTemplate }
  | { kind: "remove"; item: FeeTemplate }
  | null;

export function FeeTemplatesCard({
  programId,
  groupId = null,
}: {
  programId: string | null;
  /** Set on a group page: shows what the group applies, and its override. */
  groupId?: string | null;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const typesQuery = useFeeTypes();
  const query = useFeeTemplates(programId, groupId);
  const customize = useCustomizeGroupFees();
  const chargeTitle = useChargeTitle(typesQuery.data ?? []);
  const [dialog, setDialog] = useState<DialogState>(null);

  const all = query.data ?? [];
  const applied = applicableTemplates(all, groupId);
  const groupMode = groupId !== null;
  // A group without formation (a subject class) has no defaults to inherit: it prices itself.
  const standalone = programId === null;
  // What this card edits: the formation's defaults, or the group's own items.
  const editable = groupMode ? (applied.source === "group" ? applied.items : []) : applied.items;
  const inherited = groupMode && !standalone && applied.source !== "group";

  const title = t(groupMode ? "feeTemplates.groupTitle" : "feeTemplates.title");
  const description = t(
    standalone
      ? "feeTemplates.standalone"
      : groupMode
        ? inherited
          ? "feeTemplates.groupInherits"
          : "feeTemplates.groupOwn"
        : "feeTemplates.subtitle",
  );

  const addButton = (
    <Button
      size="sm"
      className="rounded-xl"
      onClick={() => setDialog({ kind: "add" })}
      data-testid="tpl-add"
    >
      <Plus className="size-4" aria-hidden />
      {t("feeTemplates.add")}
    </Button>
  );

  return (
    <SectionCard
      title={title}
      description={description}
      actions={!groupMode || !inherited ? addButton : undefined}
    >
      <div data-testid={groupMode ? "tpl-group-card" : "tpl-card"} className="space-y-3">
        {query.error ? (
          <ErrorState
            error={query.error}
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
            className="border-none shadow-none"
          />
        ) : query.isLoading || typesQuery.isLoading ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : (
          <>
            {applied.items.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={t("feeTemplates.emptyTitle")}
                description={t(
                  standalone
                    ? "feeTemplates.emptyStandalone"
                    : groupMode
                      ? "feeTemplates.emptyGroupBody"
                      : "feeTemplates.emptyBody",
                )}
                className="border-none shadow-none"
              />
            ) : (
              <ul className="space-y-2">
                {applied.items.map((item) => (
                  <TemplateRow
                    key={item.id}
                    item={item}
                    title={chargeTitle(item)}
                    readOnly={inherited}
                    onEdit={() => setDialog({ kind: "edit", item })}
                    onRemove={() => setDialog({ kind: "remove", item })}
                  />
                ))}
              </ul>
            )}
            {applied.items.length > 0 && (
              <p className="text-sm font-medium tabular-nums" data-testid="tpl-total">
                {t("feeTemplates.total", {
                  amount: formatDzd(templatesTotal(applied.items), locale),
                })}
              </p>
            )}
            {inherited && (
              <div className="flex flex-wrap gap-2">
                {applied.items.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    disabled={customize.isPending}
                    data-testid="tpl-customize"
                    onClick={() =>
                      customize.mutate(groupId as string, {
                        onSuccess: () => notifySuccess("feeTemplates.customized"),
                        onError: notifyError,
                      })
                    }
                  >
                    {customize.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {t("feeTemplates.customize")}
                  </Button>
                ) : (
                  addButton
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("feeTemplates.futureOnly")}</p>
          </>
        )}
      </div>

      {(dialog?.kind === "add" || dialog?.kind === "edit") && (
        <TemplateDialog
          programId={programId}
          groupId={groupId}
          {...(dialog.kind === "edit" ? { item: dialog.item } : {})}
          feeTypes={typesQuery.data ?? []}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveTemplateDialog
          programId={programId}
          item={dialog.item}
          title={chargeTitle(dialog.item)}
          lastOfGroup={groupMode && !standalone && editable.length === 1}
          onClose={() => setDialog(null)}
        />
      )}
    </SectionCard>
  );
}

function scheduleText(
  item: FeeTemplate,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
): string[] {
  return item.schedule.map((s) =>
    t(s.months === 0 ? "feeTemplates.atEnrollment" : "feeTemplates.afterMonths", {
      months: s.months,
      amount: formatDzd(s.amountDzd, locale),
    }),
  );
}

function TemplateRow({
  item,
  title,
  readOnly,
  onEdit,
  onRemove,
}: {
  item: FeeTemplate;
  title: string;
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <li
      data-testid="tpl-item"
      className="surface-row flex items-start justify-between gap-3 px-3 py-2.5"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatDzd(item.amountDzd, locale)} ·{" "}
          {t("fees.installmentsCount", { count: item.schedule.length })}
        </p>
        <ul className="mt-1 space-y-0.5 text-xs tabular-nums text-muted-foreground">
          {scheduleText(item, t, locale).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              aria-label={t("fees.actionsAria")}
              data-testid="tpl-actions"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-4" aria-hidden />
              {t("fees.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onRemove}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
              {t("feeTemplates.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

const EVERY = [1, 2, 3, 6] as const;

function scheduleFor(amount: string, count: number, every: number): TemplateInstallmentDraft[] {
  return (
    buildTemplateSchedule(amount, count, every) ??
    Array.from({ length: count }, (_, i) => ({
      amount: count === 1 ? amount.trim() : "",
      months: String(i * every),
    }))
  );
}

function TemplateDialog({
  programId,
  groupId,
  item,
  feeTypes,
  onClose,
}: {
  programId: string | null;
  groupId: string | null;
  item?: FeeTemplate;
  feeTypes: readonly FeeType[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveFeeTemplate(programId);
  const typeName = useFeeTypeName(feeTypes);

  const offered = feeTypes.filter((ft) => ft.active || ft.code === item?.feeType);
  const allowed = offered.map((ft) => ft.code);
  const [draft, setDraft] = useState<TemplateDraft>(() =>
    item
      ? templateToDraft(item)
      : {
          feeType: offered.some((ft) => ft.code === "tuition")
            ? "tuition"
            : (offered[0]?.code ?? ""),
          label: "",
          amount: "",
          installments: scheduleFor("", 1, 1),
        },
  );
  const [count, setCount] = useState(item ? item.schedule.length : 1);
  const [every, setEvery] = useState(() => {
    const s = item?.schedule;
    return s && s.length > 1 ? Math.max(1, (s[1]?.months ?? 1) - (s[0]?.months ?? 0)) : 1;
  });
  const [manual, setManual] = useState(!!item);
  const [submitted, setSubmitted] = useState(false);

  const set = <K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const resplit = (amount: string, n: number, e: number) => {
    setManual(false);
    set("installments", scheduleFor(amount, n, e));
  };

  const validation = validateTemplateDraft(draft, allowed);
  const errors = validation.ok ? {} : validation.errors;
  const rowErrors = validation.ok ? {} : validation.rows;
  const show = (field: "feeType" | "label" | "amount") =>
    errors[field] && (submitted || draft[field] !== "") ? t(errors[field] as string) : null;
  const showRow = (i: number, field: "amount" | "months") => {
    const key = rowErrors[i]?.[field];
    return key && (submitted || draft.installments[i]?.[field] !== "") ? t(key) : null;
  };
  const amountValue = /^\d+$/.test(draft.amount.trim()) ? Number(draft.amount.trim()) : null;
  const scheduleTotal = draftScheduleTotal(
    draft.installments.map((r) => ({ amount: r.amount, dueOn: "" })),
  );

  const submit = () => {
    setSubmitted(true);
    if (!validation.ok) return;
    save.mutate(
      { ...(item ? { id: item.id } : {}), groupId, ...validation.values },
      {
        onSuccess: () => {
          notifySuccess(item ? "feeTemplates.updated" : "feeTemplates.added");
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
            {t(item ? "feeTemplates.editTitle" : "feeTemplates.addTitle")}
          </DialogTitle>
          <DialogDescription className="text-start">
            {t("feeTemplates.futureOnly")}
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
              <Label htmlFor="tpl-type">{t("fees.form.type")}</Label>
              <Select
                value={draft.feeType}
                onValueChange={(v) => {
                  if (v) set("feeType", v);
                }}
              >
                <SelectTrigger
                  id="tpl-type"
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
              {show("feeType") && <p className="text-xs text-destructive">{show("feeType")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-amount">{t("feeTemplates.amount")}</Label>
              <Input
                id="tpl-amount"
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
                        ? [{ ...(d.installments[0] as TemplateInstallmentDraft), amount }]
                        : manual
                          ? d.installments
                          : scheduleFor(amount, count, every),
                  }));
                }}
              />
              {show("amount") && <p className="text-xs text-destructive">{show("amount")}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-label">{t("fees.form.label")}</Label>
            <Input
              id="tpl-label"
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
                <Label htmlFor="tpl-count">{t("fees.form.count")}</Label>
                <Select
                  value={String(count)}
                  onValueChange={(v) => {
                    // Radix may re-emit the current value: only a real change re-splits.
                    if (!v || Number(v) === count) return;
                    setCount(Number(v));
                    resplit(draft.amount, Number(v), every);
                  }}
                >
                  <SelectTrigger id="tpl-count" className="h-11 rounded-xl">
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
                <Label htmlFor="tpl-every">{t("feeTemplates.every")}</Label>
                <Select
                  value={String(every)}
                  onValueChange={(v) => {
                    if (!v || Number(v) === every) return;
                    setEvery(Number(v));
                    resplit(draft.amount, count, Number(v));
                  }}
                >
                  <SelectTrigger id="tpl-every" className="h-11 rounded-xl" disabled={count === 1}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVERY.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m === 1
                          ? t("feeTemplates.everyMonth")
                          : t("feeTemplates.everyMonths", { months: m })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("feeTemplates.scheduleHint")}</p>

            <ol className="space-y-2" data-testid="tpl-schedule">
              {draft.installments.map((row, i) => (
                <li key={i} className="grid grid-cols-[1.75rem_1fr_1fr] items-start gap-2">
                  <span className="pt-2.5 text-center text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <Input
                      inputMode="numeric"
                      dir="ltr"
                      className="h-10 rounded-lg"
                      aria-label={t("feeTemplates.rowMonths", { n: i + 1 })}
                      value={row.months}
                      aria-invalid={!!showRow(i, "months")}
                      onChange={(e) => {
                        const months = e.target.value;
                        setManual(true);
                        set(
                          "installments",
                          draft.installments.map((r, j) => (j === i ? { ...r, months } : r)),
                        );
                      }}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {row.months.trim() === "0"
                        ? t("feeTemplates.monthsZero")
                        : t("feeTemplates.monthsAfter")}
                    </p>
                    {showRow(i, "months") && (
                      <p className="text-xs text-destructive">{showRow(i, "months")}</p>
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
                data-testid="tpl-schedule-total"
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
                  onClick={() => resplit(draft.amount, count, every)}
                >
                  {t("fees.form.resplit")}
                </Button>
              )}
            </div>
            {errors.installments && (submitted || manual) && (
              <p className="text-xs text-destructive">{t(errors.installments)}</p>
            )}
          </fieldset>

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

function RemoveTemplateDialog({
  programId,
  item,
  title,
  lastOfGroup,
  onClose,
}: {
  programId: string | null;
  item: FeeTemplate;
  title: string;
  /** Removing the group's last own item returns it to the formation's fees. */
  lastOfGroup: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const remove = useRemoveFeeTemplate(programId);
  return (
    <AlertDialog open onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">
            {t("feeTemplates.removeTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {t("feeTemplates.removeBody", { fee: title })}
            {lastOfGroup && ` ${t("feeTemplates.removeLastOfGroup")}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t("ui.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              remove.mutate(item.id, {
                onSuccess: (outcome) => {
                  notifySuccess(
                    outcome === "archived" ? "feeTemplates.archived" : "feeTemplates.removed",
                  );
                  onClose();
                },
                onError: notifyError,
              });
            }}
          >
            {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("feeTemplates.remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
