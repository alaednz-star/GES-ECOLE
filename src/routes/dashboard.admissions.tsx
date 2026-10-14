/**
 * Pré-inscriptions: the administration reviews the requests received from formations' public
 * pages (ADR-004 section 7, 20261005110000_applications.sql).
 *
 *   new -> reviewing -> accepted | rejected | duplicate   (rejected / duplicate can be re-opened)
 *
 * Accepting creates the student from the request (no portal access yet) or links an existing one,
 * then places them in a group of the requested formation: that approved registration IS the
 * inscription. Duplicates are suggested here only, never to the public. Administrators only
 * (route guard + RLS).
 */

import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, ExternalLink, Loader2, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RequireAuth } from "@/features/auth/require-auth";
import {
  useAcceptApplication,
  useApplications,
  useCandidateStudents,
  useSetApplicationStatus,
  type ApplicationRow,
} from "@/features/admissions/admissions";
import {
  APPLICATION_STATUSES,
  OPEN_APPLICATION_STATUSES,
  ageOn,
  applicationActions,
  duplicateCandidates,
  type ApplicationStatus,
} from "@/features/admissions/application-model";
import { useGroups } from "@/features/school/queries";
import { usePrograms } from "@/features/school/programs";
import { placesLeft } from "@/features/school/group-model";
import { formatDate, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export const Route = createFileRoute("/dashboard/admissions")({
  head: () => ({
    meta: [
      { title: "Pré-inscriptions — Gestion École" },
      { name: "description", content: "Demandes de pré-inscription reçues des formations." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <AdmissionsPage />
    </RequireAuth>
  ),
});

type StatusFilter = "open" | "all" | ApplicationStatus;

/** Algerian 0XXXXXXXXX -> 213XXXXXXXXX for a WhatsApp link; international numbers kept. */
function whatsappNumber(phone: string): string {
  const digits = phone.replace(/^\+/, "");
  return digits.startsWith("0") ? `213${digits.slice(1)}` : digits;
}

function AdmissionsPage() {
  const { t, locale } = useI18n();
  const { data: applications = [], isLoading, error, refetch, isFetching } = useApplications();
  const { data: programs = [] } = usePrograms();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [formationFilter, setFormationFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayIso();

  const rows = useMemo(
    () =>
      applications.filter(
        (a) =>
          (statusFilter === "all" ||
            (statusFilter === "open"
              ? OPEN_APPLICATION_STATUSES.includes(a.status)
              : a.status === statusFilter)) &&
          (formationFilter === "all" || a.programId === formationFilter),
      ),
    [applications, statusFilter, formationFilter],
  );
  const opened = applications.find((a) => a.id === openId) ?? null;
  const formationOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of applications) if (a.programId) seen.set(a.programId, a.programName);
    for (const p of programs) if (seen.has(p.id)) seen.set(p.id, p.name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [applications, programs]);

  const columns: Column<ApplicationRow>[] = [
    {
      key: "name",
      header: t("admissions.col.applicant"),
      sortValue: (a) => `${a.lastName} ${a.firstName}`,
      cell: (a) => (
        <button
          type="button"
          className="focus-ring min-w-0 rounded text-start"
          onClick={() => setOpenId(a.id)}
        >
          <span className="block truncate font-medium hover:text-primary">
            {a.lastName} {a.firstName}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("admissions.age", { count: ageOn(a.dateOfBirth, today) })}
          </span>
        </button>
      ),
    },
    {
      key: "formation",
      header: t("admissions.col.formation"),
      sortValue: (a) => a.programName,
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate">{a.programName}</p>
          {a.preferredGroupName && (
            <p className="truncate text-xs text-muted-foreground">{a.preferredGroupName}</p>
          )}
        </div>
      ),
    },
    {
      key: "contact",
      header: t("admissions.col.contact"),
      cell: (a) => (
        <span dir="ltr" className="tabular-nums text-sm">
          {a.guardianPhone ?? a.phone ?? "—"}
        </span>
      ),
    },
    {
      key: "received",
      header: t("admissions.col.received"),
      sortValue: (a) => a.createdAt,
      cell: (a) => <span className="tabular-nums text-sm">{formatDate(a.createdAt, locale)}</span>,
    },
    {
      key: "status",
      header: t("admissions.col.status"),
      sortValue: (a) => APPLICATION_STATUSES.indexOf(a.status),
      cell: (a) => <StatusBadge status={a.status} />,
    },
  ];

  return (
    <>
      <PageHeader title={t("admissions.title")} description={t("admissions.subtitle")} />
      <DataTable
        rows={rows}
        columns={columns}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        rowKey={(a) => a.id}
        searchable={(a) =>
          `${a.firstName} ${a.lastName} ${a.programName} ${a.phone ?? ""} ${a.guardianPhone ?? ""} ${a.guardianName ?? ""}`
        }
        searchPlaceholder={t("admissions.search")}
        toolbar={
          <>
            <Select
              value={statusFilter}
              onValueChange={(v) => v && setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger
                className="h-9 w-48 rounded-xl"
                aria-label={t("admissions.filter.status")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t("admissions.filter.open")}</SelectItem>
                <SelectItem value="all">{t("admissions.filter.all")}</SelectItem>
                {APPLICATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`ui.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={formationFilter} onValueChange={(v) => v && setFormationFilter(v)}>
              <SelectTrigger
                className="h-9 w-56 rounded-xl"
                aria-label={t("admissions.filter.formation")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admissions.filter.allFormations")}</SelectItem>
                {formationOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        emptyState={
          <EmptyState
            icon={ClipboardCheck}
            title={t("admissions.emptyTitle")}
            description={t("admissions.emptyDescription")}
            className="border-none shadow-none"
          />
        }
      />
      {opened && (
        <ApplicationDialog key={opened.id} application={opened} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

type Mode = "view" | "accept" | "reject" | "duplicate";

function ApplicationDialog({
  application: a,
  onClose,
}: {
  application: ApplicationRow;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const setStatus = useSetApplicationStatus();
  const accept = useAcceptApplication();
  const { data: groups = [] } = useGroups();
  const { data: sources = [] } = useCandidateStudents(a);
  const [mode, setMode] = useState<Mode>("view");
  const [note, setNote] = useState("");
  const [studentChoice, setStudentChoice] = useState<string>("new");
  const [groupId, setGroupId] = useState<string | null>(a.preferredGroupId);
  const actions = applicationActions(a.status);
  const pending = setStatus.isPending || accept.isPending;
  const today = todayIso();

  const candidates = useMemo(
    () =>
      duplicateCandidates(
        {
          firstName: a.firstName,
          lastName: a.lastName,
          dateOfBirth: a.dateOfBirth,
          phone: a.phone,
          guardianPhone: a.guardianPhone,
        },
        sources,
      ).map((c) => ({ ...c, student: sources.find((s) => s.id === c.id)! })),
    [a, sources],
  );
  const formationGroups = groups.filter(
    (g) => g.programId === a.programId && g.status === "active",
  );

  const move = async (status: "reviewing" | "rejected" | "duplicate", message: string) => {
    try {
      await setStatus.mutateAsync({
        id: a.id,
        status,
        note,
        studentId: status === "duplicate" && studentChoice !== "new" ? studentChoice : null,
      });
      notifySuccess(message);
      if (status !== "reviewing") onClose();
      else setMode("view");
    } catch (e) {
      notifyError(e);
    }
  };

  const confirmAccept = async () => {
    if (!groupId) {
      toast.error(t("admissions.accept.chooseGroup"));
      return;
    }
    try {
      await accept.mutateAsync({
        applicationId: a.id,
        studentId: studentChoice === "new" ? null : studentChoice,
        groupId,
      });
      const group = formationGroups.find((g) => g.id === groupId);
      toast.success(
        t("admissions.accept.done", {
          name: `${a.firstName} ${a.lastName}`,
          group: group?.name ?? "",
        }),
      );
      onClose();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ALREADY_ENROLLED") toast.error(t("admissions.accept.alreadyEnrolled"));
      else if (code === "PLACEMENT_REFUSED")
        toast.error((e as { message?: string }).message ?? t("admissions.accept.refused"));
      else notifyError(e);
    }
  };

  const contact = a.guardianPhone ?? a.phone;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3 text-start">
            <span data-testid="application-name">
              {a.lastName} {a.firstName}
            </span>
            <StatusBadge status={a.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <Detail label={t("admissions.col.formation")}>
              {a.programId ? (
                <Link
                  to="/dashboard/programs/$programId"
                  params={{ programId: a.programId }}
                  className="text-primary hover:underline"
                >
                  {a.programName}
                </Link>
              ) : (
                a.programName
              )}
            </Detail>
            <Detail label={t("admissions.field.preferredGroup")}>
              {a.preferredGroupName ?? t("admissions.field.noPreference")}
            </Detail>
            <Detail label={t("admissions.field.dateOfBirth")}>
              <span className="tabular-nums">
                {formatDate(a.dateOfBirth, locale)} (
                {t("admissions.age", { count: ageOn(a.dateOfBirth, today) })})
              </span>
            </Detail>
            {a.phone && (
              <Detail label={t("admissions.field.phone")}>
                <span dir="ltr">{a.phone}</span>
              </Detail>
            )}
            {a.email && <Detail label={t("admissions.field.email")}>{a.email}</Detail>}
            {(a.schoolLevelName || a.schoolName) && (
              <Detail label={t("admissions.field.schoolLevel")}>
                {[a.schoolLevelName, a.schoolName].filter(Boolean).join(" · ")}
              </Detail>
            )}
            {a.guardianName && (
              <Detail label={t("admissions.public.guardian")}>
                {a.guardianName}
                {a.guardianRelation && ` (${t(`admissions.relation.${a.guardianRelation}`)})`}
                {a.guardianPhone && (
                  <>
                    {" · "}
                    <span dir="ltr">{a.guardianPhone}</span>
                  </>
                )}
              </Detail>
            )}
            {a.preferredSchedule && (
              <Detail label={t("admissions.field.preferredSchedule")}>{a.preferredSchedule}</Detail>
            )}
            {a.message && (
              <Detail label={t("admissions.field.message")}>
                <span className="whitespace-pre-line">{a.message}</span>
              </Detail>
            )}
            <Detail label={t("admissions.col.received")}>
              <span className="tabular-nums">{formatDate(a.createdAt, locale)}</span>
            </Detail>
            {a.decisionNote && (
              <Detail label={t("admissions.decisionNote")}>{a.decisionNote}</Detail>
            )}
          </dl>

          {contact && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <a href={`tel:${contact}`}>
                  <Phone className="size-4" aria-hidden />
                  {t("admissions.call")}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <a
                  href={`https://wa.me/${whatsappNumber(contact)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  WhatsApp
                </a>
              </Button>
            </div>
          )}

          {a.status === "accepted" && a.studentId && (
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <Link to="/dashboard/students/$studentId" params={{ studentId: a.studentId }}>
                <ExternalLink className="size-4" aria-hidden />
                {t("admissions.openStudent")}
              </Link>
            </Button>
          )}

          {actions.canDecide && candidates.length > 0 && mode === "view" && (
            <div
              className="rounded-xl border border-accent/40 bg-accent-soft/40 p-3"
              data-testid="duplicates"
            >
              <p className="font-medium">{t("admissions.duplicates.title")}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {candidates.map((c) => (
                  <li key={c.id}>
                    {c.student.fullName} — {t(`admissions.duplicates.${c.reason}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(mode === "accept" || mode === "duplicate") && (
            <div className="space-y-2">
              <Label id="student-choice-label">{t("admissions.accept.student")}</Label>
              <RadioGroup
                aria-labelledby="student-choice-label"
                value={studentChoice}
                onValueChange={setStudentChoice}
                className="space-y-1"
              >
                {mode === "accept" && (
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="new" id="student-new" />
                    {t("admissions.accept.createStudent")}
                  </label>
                )}
                {candidates.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <RadioGroupItem value={c.id} id={`student-${c.id}`} />
                    {c.student.fullName}
                    <span className="text-xs text-muted-foreground">
                      ({t(`admissions.duplicates.${c.reason}`)})
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {mode === "accept" && (
            <div className="space-y-2">
              <Label htmlFor="accept-group">{t("admissions.accept.group")}</Label>
              {formationGroups.length === 0 ? (
                <p className="text-xs text-destructive">{t("admissions.accept.noGroup")}</p>
              ) : (
                <Select value={groupId ?? ""} onValueChange={(v) => v && setGroupId(v)}>
                  <SelectTrigger id="accept-group" className="h-11 rounded-xl">
                    <SelectValue placeholder={t("admissions.field.choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {formationGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id} disabled={placesLeft(g) === 0}>
                        {g.name} —{" "}
                        {placesLeft(g) > 0
                          ? t("admissions.public.placesLeft", { count: placesLeft(g) })
                          : t("admissions.public.full")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">{t("admissions.accept.hint")}</p>
            </div>
          )}

          {(mode === "reject" || mode === "duplicate") && (
            <div className="space-y-2">
              <Label htmlFor="decision-note">{t("admissions.decisionNote")}</Label>
              <Textarea
                id="decision-note"
                rows={2}
                maxLength={500}
                className="rounded-xl"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {mode === "view" ? (
            <>
              {actions.canReopen && (
                <Button
                  variant="outline"
                  className="rounded-xl"
                  disabled={pending}
                  onClick={() => void move("reviewing", "admissions.reopened")}
                >
                  {t("admissions.reopen")}
                </Button>
              )}
              {actions.canStartReview && (
                <Button
                  variant="outline"
                  className="rounded-xl"
                  disabled={pending}
                  onClick={() => void move("reviewing", "admissions.reviewStarted")}
                >
                  {t("admissions.startReview")}
                </Button>
              )}
              {actions.canDecide && (
                <>
                  <Button
                    variant="ghost"
                    className="rounded-xl text-destructive"
                    disabled={pending}
                    onClick={() => setMode("reject")}
                  >
                    {t("admissions.reject")}
                  </Button>
                  {candidates.length > 0 && (
                    <Button
                      variant="ghost"
                      className="rounded-xl"
                      disabled={pending}
                      onClick={() => {
                        setStudentChoice(candidates[0]!.id);
                        setMode("duplicate");
                      }}
                    >
                      {t("admissions.markDuplicate")}
                    </Button>
                  )}
                  <Button
                    className="rounded-xl"
                    disabled={pending}
                    onClick={() => setMode("accept")}
                  >
                    {t("admissions.accept.action")}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="rounded-xl"
                disabled={pending}
                onClick={() => setMode("view")}
              >
                {t("ui.cancel")}
              </Button>
              {mode === "accept" && (
                <Button
                  className="rounded-xl"
                  disabled={pending || formationGroups.length === 0}
                  onClick={() => void confirmAccept()}
                >
                  {accept.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {t("admissions.accept.confirm")}
                </Button>
              )}
              {mode === "reject" && (
                <Button
                  className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={pending}
                  onClick={() => void move("rejected", "admissions.rejected")}
                >
                  {t("admissions.reject")}
                </Button>
              )}
              {mode === "duplicate" && (
                <Button
                  className="rounded-xl"
                  disabled={pending}
                  onClick={() => void move("duplicate", "admissions.duplicated")}
                >
                  {t("admissions.markDuplicate")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
