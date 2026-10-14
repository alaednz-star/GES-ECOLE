import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { useSaveContract, type ContractRow, type EmployeeDetail } from "@/features/hr/hr";
import {
  CONTRACT_TYPES,
  WORKING_TIMES,
  validateContractDraft,
  type ContractDraft,
  type ContractField,
  type ContractType,
  type WorkingTime,
} from "@/features/hr/hr-model";
import { Field } from "@/features/hr/components/field";
import { errorCode } from "@/features/hr/hr-model";
import { formatDate, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

const UNSET = "__none__";
type Closing = { contract: ContractRow; to: "ended" | "cancelled" };

/**
 * The end date recorded when a contract is ended: its planned end if that has already passed,
 * otherwise today -- but never before the contract started (the CHECK would refuse it).
 */
function endingDate(c: ContractRow, today: string): string {
  if (c.endDate && c.endDate <= today) return c.endDate;
  return today < c.startDate ? c.startDate : today;
}

export function ContractsPanel({ employee }: { employee: EmployeeDetail }) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveContract();
  const [form, setForm] = useState<{ contract: ContractRow | null } | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const hasActive = employee.contracts.some((c) => c.status === "active");

  const close = async () => {
    if (!closing) return;
    const c = closing.contract;
    const today = todayIso();
    try {
      await save.mutateAsync({
        employeeId: employee.id,
        id: c.id,
        contractType: c.contractType,
        workingTime: c.workingTime,
        startDate: c.startDate,
        endDate: closing.to === "ended" ? endingDate(c, today) : c.endDate,
        status: closing.to,
        notes: c.notes,
      });
      notifySuccess("hr.contracts.saved");
      setClosing(null);
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <SectionCard
      title={t("hr.contracts.title")}
      description={t("hr.contracts.hint")}
      actions={
        <Button size="sm" className="rounded-xl" onClick={() => setForm({ contract: null })}>
          <Plus className="size-4" aria-hidden />
          {t("hr.contracts.new")}
        </Button>
      }
    >
      {employee.contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hr.contracts.none")}</p>
      ) : (
        <ul className="space-y-2">
          {employee.contracts.map((c) => (
            <li key={c.id} className="surface-row flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t(`hr.contractType.${c.contractType}`)}
                  {c.workingTime && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {t(`hr.workingTime.${c.workingTime}`)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(c.startDate, locale)} →{" "}
                  {c.endDate ? formatDate(c.endDate, locale) : t("hr.contracts.openEnded")}
                </p>
                {c.notes && (
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    {c.notes}
                  </p>
                )}
              </div>
              <StatusBadge status={c.status} />
              {c.status === "active" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-lg"
                      aria-label={t("hr.contracts.edit")}
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 rounded-xl">
                    <DropdownMenuItem onSelect={() => setForm({ contract: c })}>
                      {t("hr.contracts.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setClosing({ contract: c, to: "ended" })}>
                      {t("hr.contracts.endAction")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setClosing({ contract: c, to: "cancelled" })}
                    >
                      {t("hr.contracts.cancelAction")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      {form && (
        <ContractDialog
          employeeId={employee.id}
          contract={form.contract}
          hasActive={hasActive}
          onClose={() => setForm(null)}
        />
      )}

      <AlertDialog
        open={closing !== null}
        onOpenChange={(o) => !o && !save.isPending && setClosing(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">
              {closing &&
                t(closing.to === "ended" ? "hr.contracts.endTitle" : "hr.contracts.cancelTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {closing &&
                t(closing.to === "ended" ? "hr.contracts.endBody" : "hr.contracts.cancelBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-xl" disabled={save.isPending}>
              {t("hr.cancelLabel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl"
              disabled={save.isPending}
              onClick={(e) => {
                e.preventDefault();
                void close();
              }}
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {closing &&
                t(closing.to === "ended" ? "hr.contracts.endAction" : "hr.contracts.cancelAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function ContractDialog({
  employeeId,
  contract,
  hasActive,
  onClose,
}: {
  employeeId: string;
  contract: ContractRow | null;
  hasActive: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveContract();
  const [draft, setDraft] = useState<ContractDraft>({
    contractType: contract?.contractType ?? "permanent",
    workingTime: contract?.workingTime ?? null,
    startDate: contract?.startDate ?? todayIso(),
    endDate: contract?.endDate ?? "",
    status: contract?.status ?? "active",
    notes: contract?.notes ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof ContractDraft>(k: K, v: ContractDraft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));
  const v = validateContractDraft(draft);
  const err = (f: ContractField) =>
    !v.ok && submitted && v.errors[f] ? t(v.errors[f] as string) : null;

  const submit = async () => {
    setSubmitted(true);
    if (!v.ok) return;
    if (!contract && hasActive) {
      toast.error(t("hr.contracts.activeExists"));
      return;
    }
    try {
      await save.mutateAsync({ employeeId, ...(contract ? { id: contract.id } : {}), ...v.values });
      notifySuccess("hr.contracts.saved");
      onClose();
    } catch (e) {
      if (errorCode(e) === "23505") toast.error(t("hr.contracts.activeExists"));
      else notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(contract ? "hr.contracts.editTitle" : "hr.contracts.new")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ct-type" label={t("hr.contracts.type")} error={err("contractType")}>
              <Select
                value={draft.contractType}
                onValueChange={(x) => set("contractType", x as ContractType)}
              >
                <SelectTrigger id="ct-type" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`hr.contractType.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="ct-time" label={t("hr.contracts.workingTime")}>
              <Select
                value={draft.workingTime ?? UNSET}
                onValueChange={(x) => set("workingTime", x === UNSET ? null : (x as WorkingTime))}
              >
                <SelectTrigger id="ct-time" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>{t("hr.contracts.notSet")}</SelectItem>
                  {WORKING_TIMES.map((w) => (
                    <SelectItem key={w} value={w}>
                      {t(`hr.workingTime.${w}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="ct-start" label={t("hr.contracts.start")}>
              <Input
                id="ct-start"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </Field>
            <Field id="ct-end" label={`${t("hr.contracts.end")} ${t("hr.field.optional")}`}>
              <Input
                id="ct-end"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.endDate}
                min={draft.startDate || undefined}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </Field>
          </div>
          {err("dates") && <p className="text-xs text-destructive">{err("dates")}</p>}
          <Field
            id="ct-notes"
            label={`${t("hr.contracts.notes")} ${t("hr.field.optional")}`}
            error={err("notes")}
          >
            <Textarea
              id="ct-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("hr.cancelLabel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
