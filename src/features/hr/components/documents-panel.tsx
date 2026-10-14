import { useState } from "react";
import { ExternalLink, FileText, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  signHrDocument,
  useDeleteDocument,
  useUploadDocument,
  type DocumentRow,
  type EmployeeDetail,
} from "@/features/hr/hr";
import {
  DOCUMENT_CATEGORIES,
  HR_DOCUMENT_MAX_BYTES,
  HR_DOCUMENT_MIME,
  type DocumentCategory,
} from "@/features/hr/hr-model";
import { Field } from "@/features/hr/components/field";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

const UNSET = "__none__";

function sizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * HR documents live in the PRIVATE `hr-documents` bucket. Opening one mints a 60-second
 * signed URL with the admin's own session; nothing is ever public.
 */
export function DocumentsPanel({ employee }: { employee: EmployeeDetail }) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const remove = useDeleteDocument();
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const open = async (doc: DocumentRow) => {
    setOpening(doc.id);
    try {
      const url = await signHrDocument(doc.storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      notifyError(e);
    } finally {
      setOpening(null);
    }
  };

  return (
    <SectionCard
      title={t("hr.documents.title")}
      description={t("hr.documents.private")}
      actions={
        <Button size="sm" className="rounded-xl" onClick={() => setUploading(true)}>
          <Plus className="size-4" aria-hidden />
          {t("hr.documents.upload")}
        </Button>
      }
    >
      {employee.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hr.documents.none")}</p>
      ) : (
        <ul className="space-y-2">
          {employee.documents.map((d) => (
            <li key={d.id} className="surface-row flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                <FileText className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{d.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t(`hr.docCategory.${d.category}`)} · {formatDate(d.createdAt, locale)}
                  {d.sizeBytes ? ` · ${sizeLabel(d.sizeBytes)}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={opening === d.id}
                onClick={() => void open(d)}
              >
                {opening === d.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ExternalLink className="size-4" aria-hidden />
                )}
                {t("hr.documents.open")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-destructive"
                aria-label={t("hr.documents.delete")}
                onClick={() => setDeleting(d)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" aria-hidden />
        {t("hr.documents.fileHint")}
      </p>

      {uploading && <UploadDialog employee={employee} onClose={() => setUploading(false)} />}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && !remove.isPending && setDeleting(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">
              {t("hr.documents.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {deleting && t("hr.documents.deleteBody", { title: deleting.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-xl" disabled={remove.isPending}>
              {t("hr.cancelLabel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleting) return;
                try {
                  await remove.mutateAsync({ id: deleting.id, storagePath: deleting.storagePath });
                  notifySuccess("hr.documents.deleted");
                  setDeleting(null);
                } catch (err) {
                  notifyError(err);
                }
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.documents.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function UploadDialog({ employee, onClose }: { employee: EmployeeDetail; onClose: () => void }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const upload = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("contract");
  const [title, setTitle] = useState("");
  const [contractId, setContractId] = useState<string>(UNSET);
  const [submitted, setSubmitted] = useState(false);

  const fileError = !file
    ? "hr.error.fileRequired"
    : file.size > HR_DOCUMENT_MAX_BYTES
      ? "hr.error.fileTooLarge"
      : !(HR_DOCUMENT_MIME as readonly string[]).includes(file.type)
        ? "hr.error.fileType"
        : null;
  const titleError =
    title.trim().length === 0
      ? "hr.error.titleRequired"
      : title.trim().length > 150
        ? "hr.error.tooLong"
        : null;

  const submit = async () => {
    setSubmitted(true);
    if (fileError || titleError || !file) return;
    try {
      await upload.mutateAsync({
        employeeId: employee.id,
        file,
        category,
        title: title.trim(),
        contractId: contractId === UNSET ? null : contractId,
      });
      notifySuccess("hr.documents.uploaded");
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !upload.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">{t("hr.documents.upload")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            id="doc-file"
            label={t("hr.documents.file")}
            hint={t("hr.documents.fileHint")}
            error={submitted && fileError ? t(fileError) : null}
          >
            <Input
              id="doc-file"
              type="file"
              accept={HR_DOCUMENT_MIME.join(",")}
              className="h-11 rounded-xl"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 150));
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="doc-category" label={t("hr.documents.category")}>
              <Select value={category} onValueChange={(x) => setCategory(x as DocumentCategory)}>
                <SelectTrigger id="doc-category" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`hr.docCategory.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="doc-contract" label={t("hr.documents.contract")}>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger id="doc-contract" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>{t("hr.documents.noContract")}</SelectItem>
                  {employee.contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {t(`hr.contractType.${c.contractType}`)} · {c.startDate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            id="doc-title"
            label={t("hr.documents.docTitle")}
            error={submitted && titleError ? t(titleError) : null}
          >
            <Input
              id="doc-title"
              className="h-11 rounded-xl"
              value={title}
              maxLength={150}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={upload.isPending}>
              {t("hr.cancelLabel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={upload.isPending}>
              {upload.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.documents.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
