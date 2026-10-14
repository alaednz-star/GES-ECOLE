/**
 * Documents officiels (ADR-007): numbered certificates given to students -- enrollment,
 * attendance, payment. A document is a frozen snapshot: never edited, voided with a reason.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronsUpDown, FileBadge, Loader2, Plus, Printer, XCircle } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
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
import { useRegistrations } from "@/features/school/queries";
import {
  useIssueOfficialDocument,
  useOfficialDocuments,
  useVoidOfficialDocument,
  type DocumentKind,
  type OfficialDocument,
} from "@/features/operations/queries";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/official-documents")({
  head: () => ({
    meta: [{ title: "Documents officiels — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <OfficialDocumentsPage />
    </RequireAuth>
  ),
});

const KINDS: readonly DocumentKind[] = ["enrollment", "attendance", "payment"];
type View = "all" | "issued" | "voided";

function OfficialDocumentsPage() {
  const { t, locale } = useI18n();
  const docs = useOfficialDocuments();
  const [view, setView] = useState<View>("all");
  const [issuing, setIssuing] = useState(false);
  const [voiding, setVoiding] = useState<OfficialDocument | null>(null);
  const rows = (docs.data ?? []).filter((d) => view === "all" || d.status === view);

  const columns: Column<OfficialDocument>[] = [
    {
      key: "number",
      header: t("finance.col.number"),
      sortValue: (d) => d.number,
      cell: (d) => (
        <div>
          <p
            className={cn(
              "font-mono text-sm",
              d.status === "voided" && "text-muted-foreground line-through",
            )}
            dir="ltr"
          >
            {d.number}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(d.issuedAt, locale)}</p>
        </div>
      ),
    },
    {
      key: "student",
      header: t("docs.student"),
      sortValue: (d) => d.studentName ?? "",
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{d.studentName ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {String(d.snapshot["group_name"] ?? "—")}
          </p>
          {d.status === "voided" && (
            <p className="truncate text-xs text-destructive">
              {t("receipts.voidedBecause", { reason: d.voidReason ?? "" })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "kind",
      header: t("docs.col.kind"),
      className: "hidden md:table-cell",
      sortValue: (d) => d.kind,
      cell: (d) => (
        <span className="text-sm text-muted-foreground">{t(`docs.kind.${d.kind}`)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (d) => (
        <div className="flex justify-end gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t("finance.view")}
          >
            <Link
              to="/documents/certificates/$documentId"
              params={{ documentId: d.id }}
              data-testid="doc-open"
            >
              <Printer className="size-4" aria-hidden />
            </Link>
          </Button>
          {d.status === "issued" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-destructive"
              aria-label={t("docs.void")}
              data-testid="doc-void"
              onClick={() => setVoiding(d)}
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
        title={t("docs.title")}
        description={t("docs.subtitle")}
        actions={
          <Button className="rounded-xl" onClick={() => setIssuing(true)} data-testid="doc-issue">
            <Plus className="size-4" aria-hidden /> {t("docs.issue")}
          </Button>
        }
      />
      <DataTable
        rows={rows}
        columns={columns}
        isLoading={docs.isLoading}
        error={docs.error}
        onRetry={() => void docs.refetch()}
        isRetrying={docs.isFetching}
        rowKey={(d) => d.id}
        pageSize={50}
        searchable={(d) =>
          [
            d.number,
            d.studentName,
            String(d.snapshot["group_name"] ?? ""),
            t(`docs.kind.${d.kind}`),
          ].join(" ")
        }
        searchPlaceholder={t("finance.search")}
        emptyState={
          <EmptyState
            icon={FileBadge}
            title={t("docs.emptyTitle")}
            description={t("docs.emptyBody")}
          />
        }
        filters={
          <Select value={view} onValueChange={(v) => v && setView(v as View)}>
            <SelectTrigger className="h-9 w-48 rounded-xl" aria-label={t("docs.filter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "issued", "voided"] as const).map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`docs.view.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {issuing && <IssueDocumentDialog onClose={() => setIssuing(false)} />}
      {voiding && <VoidDocumentDialog doc={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

function IssueDocumentDialog({ onClose }: { onClose: () => void }) {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const { notifySuccess, notifyError } = useActionFeedback();
  const registrations = useRegistrations();
  const issue = useIssueOfficialDocument();
  const [kind, setKind] = useState<DocumentKind>("enrollment");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Accepted enrollments only (current or ended), as the database requires.
  const eligible = useMemo(
    () =>
      (registrations.data ?? []).filter((r) => r.status === "approved" || r.status === "withdrawn"),
    [registrations.data],
  );
  const students = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of eligible) m.set(r.studentId, r.studentName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [eligible]);
  const enrollments = eligible.filter((r) => r.studentId === studentId);

  const choose = (id: string) => {
    setStudentId(id);
    const own = eligible.filter((r) => r.studentId === id);
    setRegistrationId(own.length === 1 ? (own[0]?.id ?? null) : null);
    setOpen(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !issue.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">{t("docs.issueTitle")}</DialogTitle>
          <DialogDescription className="text-start">{t("docs.issueBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-kind">{t("docs.kind")}</Label>
            <Select value={kind} onValueChange={(v) => v && setKind(v as DocumentKind)}>
              <SelectTrigger id="doc-kind" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`docs.kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label id="doc-student-label">{t("docs.student")}</Label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-labelledby="doc-student-label"
                  data-testid="doc-student"
                  className="h-11 w-full justify-between rounded-xl font-normal"
                  disabled={registrations.isLoading}
                >
                  <span className={cn("truncate", !studentId && "text-muted-foreground")}>
                    {students.find(([id]) => id === studentId)?.[1] ?? t("docs.pickStudent")}
                  </span>
                  {registrations.isLoading ? (
                    <Loader2 className="size-4 animate-spin opacity-60" aria-hidden />
                  ) : (
                    <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder={t("docs.searchStudent")} />
                  <CommandList>
                    <CommandEmpty>{t("docs.noStudent")}</CommandEmpty>
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
              <Label id="doc-enrollment-label">{t("docs.enrollment")}</Label>
              <RadioGroup
                dir={dir}
                value={registrationId ?? ""}
                onValueChange={(v) => v && setRegistrationId(v)}
                aria-labelledby="doc-enrollment-label"
                className="gap-2"
              >
                {enrollments.map((r) => (
                  <label
                    key={r.id}
                    htmlFor={`doc-enr-${r.id}`}
                    data-testid="doc-enrollment"
                    className="surface-row flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                  >
                    <RadioGroupItem value={r.id} id={`doc-enr-${r.id}`} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.groupName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[r.subjectName, r.levelName, t(`ui.status.${r.status}`)]
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
            data-testid="doc-confirm"
            onClick={() =>
              registrationId &&
              issue.mutate(
                { kind, registrationId },
                {
                  onSuccess: (id) => {
                    notifySuccess("docs.issued");
                    onClose();
                    void navigate({
                      to: "/documents/certificates/$documentId",
                      params: { documentId: id },
                    });
                  },
                  onError: notifyError,
                },
              )
            }
          >
            {issue.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("docs.issue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDocumentDialog({ doc, onClose }: { doc: OfficialDocument; onClose: () => void }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const voidDoc = useVoidOfficialDocument();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < 1 || trimmed.length > 300;
  return (
    <AlertDialog open onOpenChange={(o) => !o && !voidDoc.isPending && onClose()}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">{t("docs.voidTitle")}</AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {t("docs.voidBody", { number: doc.number })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="doc-void-reason">{t("docs.voidReason")}</Label>
          <Textarea
            id="doc-void-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {submitted && invalid && (
            <p className="text-xs text-destructive">{t("discounts.error.reason")}</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={voidDoc.isPending}>{t("docs.keep")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={voidDoc.isPending}
            onClick={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (invalid) return;
              voidDoc.mutate(
                { id: doc.id, reason: trimmed },
                {
                  onSuccess: () => {
                    notifySuccess("docs.voided");
                    onClose();
                  },
                  onError: notifyError,
                },
              );
            }}
          >
            {voidDoc.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("docs.void")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
