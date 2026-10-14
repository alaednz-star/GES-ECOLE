import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/features/auth/require-auth";
import { StudentRosterExport } from "@/features/school/student-roster-export";
import type { RosterSourceRow } from "@/features/school/roster-model";
import { useGroups, useRegistrations } from "@/features/school/queries";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/dashboard/my-students")({
  head: () => ({
    meta: [
      { title: "Mes élèves — Gestion École" },
      { name: "description", content: "Les élèves inscrits dans vos groupes." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["teacher", "admin"]}>
      <MyStudentsPage />
    </RequireAuth>
  ),
});

interface Row {
  id: string;
  registrationId: string;
  studentName: string;
  groupId: string;
  groupName: string;
  subjectName: string | null;
  levelName: string | null;
  since: string;
}

function MyStudentsPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const groupsQuery = useGroups();
  const registrationsQuery = useRegistrations();

  // Teachers see only their own groups. Admins land here from the sidebar too,
  // in which case "mine" is every group.
  const myGroups = useMemo(
    () =>
      (groupsQuery.data ?? []).filter((g) => user?.role !== "teacher" || g.teacherId === user.id),
    [groupsQuery.data, user?.role, user?.id],
  );

  /*
    The roster reuses `myGroups` -- the list this page already computed -- rather than
    re-deriving who may see what. A teacher's `myGroups` is filtered to their own
    `teacherId`, and `useRegistrations` is scoped by RLS on top of that, so the export can
    only ever contain what the page itself is allowed to show. No second authorization
    mechanism exists to fall out of step with the first.

    Unlike `rows` below, this is one entry per ENROLMENT: a roster lists places in groups,
    and a student taught two subjects belongs on both class lists.
  */
  const rosterSource: RosterSourceRow[] = useMemo(() => {
    const ids = new Set(myGroups.map((g) => g.id));
    return (registrationsQuery.data ?? [])
      .filter((r) => ids.has(r.groupId))
      .map((r) => ({
        studentId: r.studentId,
        studentName: r.studentName,
        groupId: r.groupId,
        groupName: r.groupName,
        subjectName: r.subjectName,
        levelName: r.levelName,
        status: r.status,
      }));
  }, [registrationsQuery.data, myGroups]);

  const rosterGroups = useMemo(() => myGroups.map((g) => ({ id: g.id, name: g.name })), [myGroups]);

  /**
   * One row per STUDENT, not per enrolment.
   *
   * A student taught in two subjects previously produced two rows, so the list
   * read as if there were more students than exist and the count disagreed with
   * My Groups. Their groups are collapsed into one cell instead; the earliest
   * enrolment date is kept as "since", because that is when they joined.
   */
  const rows: Row[] = useMemo(() => {
    const ids = new Set(myGroups.map((g) => g.id));
    const byStudent = new Map<string, Row>();

    for (const r of registrationsQuery.data ?? []) {
      if (r.status !== "approved" || !ids.has(r.groupId)) continue;
      const g = myGroups.find((x) => x.id === r.groupId);
      const existing = byStudent.get(r.studentId);

      if (!existing) {
        byStudent.set(r.studentId, {
          id: r.studentId,
          registrationId: r.id,
          studentName: r.studentName,
          groupId: r.groupId,
          groupName: r.groupName,
          subjectName: g?.subjectName ?? r.subjectName,
          levelName: g?.levelName ?? r.levelName,
          since: r.createdAt,
        });
        continue;
      }

      // Second (legitimate) enrolment: a different subject with the same teacher.
      existing.groupName = `${existing.groupName}, ${r.groupName}`;
      const subject = g?.subjectName ?? r.subjectName;
      if (subject && !existing.subjectName?.includes(subject)) {
        existing.subjectName = existing.subjectName
          ? `${existing.subjectName}, ${subject}`
          : subject;
      }
      if (r.createdAt < existing.since) existing.since = r.createdAt;
    }

    return [...byStudent.values()].sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [registrationsQuery.data, myGroups]);

  const columns: Column<Row>[] = [
    {
      key: "student",
      header: t("myStudents.columnStudent"),
      sortValue: (r) => r.studentName,
      cell: (r) => (
        <Link
          to="/dashboard/students/$studentId"
          params={{ studentId: r.id }}
          className="focus-ring rounded font-medium hover:text-primary"
        >
          {r.studentName}
        </Link>
      ),
    },
    {
      key: "group",
      header: t("myStudents.columnGroup"),
      sortValue: (r) => r.groupName,
      cell: (r) => (
        <Link
          to="/dashboard/groups/$groupId"
          params={{ groupId: r.groupId }}
          className="focus-ring rounded hover:text-primary"
        >
          {r.groupName}
        </Link>
      ),
    },
    { key: "subject", header: t("myStudents.columnSubject"), cell: (r) => r.subjectName ?? "—" },
    { key: "level", header: t("myStudents.columnLevel"), cell: (r) => r.levelName ?? "—" },
    {
      key: "since",
      header: t("myStudents.columnSince"),
      sortValue: (r) => r.since,
      cell: (r) => formatDate(r.since, locale),
    },
  ];

  const error = groupsQuery.error ?? registrationsQuery.error;

  return (
    <>
      <PageHeader
        title={t("myStudents.title")}
        description={t("myStudents.description", { count: String(rows.length) })}
        actions={
          <Button asChild className="rounded-xl">
            <Link to="/dashboard/attendance">{t("myStudents.markAttendance")}</Link>
          </Button>
        }
      />

      {/* The same control the admin page mounts. It is given this page's own authorized
          groups and registrations, so a teacher's scope select offers only their groups. */}
      <section className="surface-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("roster.export")}</h2>
        <StudentRosterExport source={rosterSource} groups={rosterGroups} />
      </section>

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={groupsQuery.isLoading || registrationsQuery.isLoading}
        error={error}
        onRetry={() => {
          void groupsQuery.refetch();
          void registrationsQuery.refetch();
        }}
        isRetrying={groupsQuery.isFetching || registrationsQuery.isFetching}
        rowKey={(r) => r.id}
        searchable={(r) => `${r.studentName} ${r.groupName} ${r.subjectName ?? ""}`}
        searchPlaceholder={t("myStudents.searchPlaceholder")}
        emptyState={
          <EmptyState
            icon={Users}
            title={t("myStudents.emptyTitle")}
            description={t("myStudents.emptyBody")}
            className="border-none shadow-none"
          />
        }
      />
    </>
  );
}
