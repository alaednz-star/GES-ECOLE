import { useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarCheck,
  GraduationCap,
  Loader2,
  NotebookPen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AttendanceBreakdown } from "@/features/school/components/attendance-breakdown";
import { StudentFeesSection } from "@/features/school/components/student-fees";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { useGroups, useRegistrations, useStudents } from "@/features/school/queries";
import {
  summarise,
  useAddStudentNote,
  useDeleteStudentNote,
  useStudentAttendance,
  useStudentNotes,
} from "@/features/school/profiles";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { formatDate } from "@/lib/format";
import { weekdayLabel } from "@/features/school/schedule";

export const Route = createFileRoute("/dashboard/students/$studentId")({
  head: () => ({
    meta: [{ title: "Fiche élève — Gestion École" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <StudentDetailPage />
    </RequireAuth>
  ),
});

function StudentDetailPage() {
  const { t, locale } = useI18n();
  const { user, hasRole } = useAuth();
  // Fees are money: administrators only (RLS gives teachers nothing either; this keeps the
  // section from even asking).
  const isAdmin = hasRole("admin");
  const { notifySuccess, notifyError } = useActionFeedback();
  const { studentId } = useParams({ from: "/dashboard/students/$studentId" });

  const studentsQuery = useStudents();
  const { data: groups = [] } = useGroups();
  const { data: registrations = [] } = useRegistrations();
  const attendanceQuery = useStudentAttendance(studentId);
  const notesQuery = useStudentNotes(studentId);
  const addNote = useAddStudentNote(studentId);
  const removeNote = useDeleteStudentNote(studentId);

  const [draft, setDraft] = useState("");

  const student = studentsQuery.data?.find((s) => s.id === studentId);
  const summary = summarise((attendanceQuery.data ?? []).map((a) => a.status));

  const myGroups = registrations
    .filter((r) => r.studentId === studentId && r.status === "approved")
    .map((r) => groups.find((g) => g.id === r.groupId))
    .filter((g): g is NonNullable<typeof g> => !!g);

  const error = studentsQuery.error ?? attendanceQuery.error;

  if (error) {
    return (
      <>
        <BackLink />
        <ErrorState
          error={error}
          onRetry={() => {
            void studentsQuery.refetch();
            void attendanceQuery.refetch();
          }}
          isRetrying={studentsQuery.isFetching || attendanceQuery.isFetching}
        />
      </>
    );
  }

  if (studentsQuery.isLoading) {
    return (
      <>
        <BackLink />
        <Skeleton className="h-36 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (!student) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={GraduationCap}
          title={t("student.notFoundTitle")}
          description={t("student.notFoundBody")}
        />
      </>
    );
  }

  const submitNote = () => {
    if (addNote.isPending) return;
    const body = draft.trim();
    if (!body) {
      toast.error(t("student.noteRequired"));
      return;
    }
    if (!user) return;
    addNote.mutate(
      { body, authorId: user.id },
      {
        onSuccess: () => {
          notifySuccess("student.noteAdded");
          setDraft("");
        },
        onError: (e) => notifyError(e),
      },
    );
  };

  return (
    <>
      <BackLink />

      <PageHeader title={student.fullName} description={t("student.detailDescription")} />

      <SectionCard title={t("student.identityTitle")} description={t("student.identityDesc")}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <PersonAvatar
            name={student.fullName}
            url={student.avatarUrl}
            accent="var(--color-primary)"
            className="size-20 shrink-0 text-lg"
          />
          <dl className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("student.email")} value={student.email ?? "—"} />
            <Field label={t("student.phone")} value={student.phone ?? "—"} />
            <Field
              label={t("student.level")}
              value={student.levelName ?? t("entity.common.notAssigned")}
            />
            <Field
              label={t("student.registeredAt")}
              value={formatDate(student.registeredAt, locale)}
            />
            <div className="rounded-xl bg-muted/60 px-4 py-3">
              <dt className="text-xs text-muted-foreground">{t("student.status")}</dt>
              <dd className="mt-1">
                <StatusBadge status={student.status} />
              </dd>
            </div>
            <Field label={t("student.groupCount")} value={String(myGroups.length)} />
          </dl>
        </div>
      </SectionCard>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("attendance.rate")}
          value={`${summary.rate}%`}
          icon={CalendarCheck}
          tone="success"
        />
        <StatCard
          label={t("attendance.present")}
          value={String(summary.present)}
          icon={CalendarCheck}
        />
        <StatCard
          label={t("attendance.absent")}
          value={String(summary.absent)}
          icon={CalendarCheck}
          tone="accent"
        />
        <StatCard
          label={t("attendance.sessions")}
          value={String(summary.total)}
          icon={CalendarCheck}
        />
      </div>

      <SectionCard title={t("student.groupsTitle")} description={t("student.groupsDesc")}>
        {myGroups.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title={t("student.noGroupTitle")}
            description={t("student.noGroupBody")}
            className="border-none shadow-none"
          />
        ) : (
          <ul className="divide-y divide-border">
            {myGroups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    to="/dashboard/groups/$groupId"
                    params={{ groupId: g.id }}
                    className="focus-ring truncate rounded text-sm font-medium hover:text-primary"
                  >
                    {g.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {g.subjectName ?? "—"} · {g.teacherName ?? t("entity.common.notAssigned")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.schedules.map((s) => (
                    <span
                      key={s.id}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {weekdayLabel(s.weekday, t).slice(0, 3)} {s.startTime}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {isAdmin && (
        <StudentFeesSection studentId={studentId} registrations={registrations} groups={groups} />
      )}

      <SectionCard title={t("attendance.historyTitle")} description={t("attendance.historyDesc")}>
        {attendanceQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : (attendanceQuery.data ?? []).length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title={t("attendance.noHistoryTitle")}
            description={t("attendance.noHistoryBody")}
            className="border-none shadow-none"
          />
        ) : (
          <>
            <AttendanceBreakdown summary={summary} />
            <ul className="mt-4 divide-y divide-border">
              {(attendanceQuery.data ?? []).slice(0, 20).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="tabular-nums text-muted-foreground">
                    {formatDate(a.sessionDate, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate px-3">{a.groupName}</span>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard title={t("student.notesTitle")} description={t("student.notesDesc")}>
        <div className="space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("student.notePlaceholder")}
            className="min-h-24 rounded-xl"
            maxLength={2000}
            aria-label={t("student.notePlaceholder")}
          />
          <div className="flex justify-end">
            <Button className="rounded-xl" onClick={submitNote} disabled={addNote.isPending}>
              {addNote.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <NotebookPen className="size-4" aria-hidden />
              )}
              {addNote.isPending ? t("ui.saving") : t("student.addNote")}
            </Button>
          </div>
        </div>

        {notesQuery.isLoading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : (notesQuery.data ?? []).length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title={t("student.noNotesTitle")}
            description={t("student.noNotesBody")}
            className="mt-4 border-none shadow-none"
          />
        ) : (
          <ul className="mt-4 space-y-3">
            {(notesQuery.data ?? []).map((n) => (
              <li key={n.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 whitespace-pre-wrap text-sm">{n.body}</p>
                  {n.authorId === user?.id && (
                    <ConfirmDialog
                      title={t("student.deleteNoteTitle")}
                      description={t("student.deleteNoteBody")}
                      confirmLabel={t("student.deleteNoteConfirm")}
                      onConfirm={async () => {
                        try {
                          await removeNote.mutateAsync(n.id);
                          notifySuccess("student.noteDeleted");
                        } catch (e) {
                          notifyError(e);
                        }
                      }}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 rounded-lg text-destructive"
                          aria-label={t("student.deleteNoteTitle")}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      }
                    />
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {n.authorName} · {formatDate(n.createdAt, locale)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Button asChild variant="ghost" size="sm" className="w-fit rounded-xl">
      <Link to="/dashboard/students">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("student.backToList")}
      </Link>
    </Button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
