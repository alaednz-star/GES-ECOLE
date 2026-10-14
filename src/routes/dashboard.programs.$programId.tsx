/**
 * One formation (table `programs`, ADR-004) and the groups that deliver it.
 *
 * The formation says WHAT is offered (type, subject/level when it names them, planned period,
 * duration, description, content); each group says HOW it is delivered (teacher, places, weekly
 * slots, room, term). The page adapts to how many groups exist:
 *
 *   none   a valid state; the next useful action ("add the first group") is offered, not forced
 *   one    the formation reads as one offering: the group's teacher, timetable, room, term,
 *          places and enrolled students are shown in place, without a list to navigate
 *   many   the formation is the parent view: one row per group with its operational facts
 *
 * Places and teachers are DERIVED from the groups (`summariseProgramGroups`), never stored.
 * Groups are added here with the formation fixed and its group-compatible facts prefilled
 * (`groupDefaultsFromProgram`), through the same form the Groups page uses.
 *
 * Security is RLS (20261001100000): administrators write formations and groups; the route
 * guard is navigation.
 */

import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  GraduationCap,
  Library,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  UserPlus,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequireAuth } from "@/features/auth/require-auth";
import { usePrograms } from "@/features/school/programs";
import { useFormationTypeLabels } from "@/features/school/formation-types";
import { PublicLinkCard } from "@/features/admissions/components/public-link-card";
import { FeeTemplatesCard } from "@/features/school/components/fee-templates-card";
import { useLevelSystemLabel, useProgramLevelLabel } from "@/features/school/level-system-label";
import { useGroupRegistrations, useGroups, type GroupInput } from "@/features/school/queries";
import { weekdayLabel } from "@/features/school/schedule";
import {
  groupDefaultsFromProgram,
  nextGroupLetter,
  nextStatuses,
  summariseProgramGroups,
} from "@/features/school/program-model";
import { placesLeft } from "@/features/school/group-model";
import {
  ProgramFormDialog,
  ProgramStatusDialog,
  type ProgramFormState,
  type ProgramStatusChange,
} from "@/features/school/components/program-dialogs";
import { GroupFormDialog } from "@/features/school/components/group-form-dialog";
import { EnrollStudentDialog } from "@/features/school/components/enrollment-dialogs";
import { emptyGroupDraft, groupToDraft } from "@/features/school/group-draft";
import type { GroupRow } from "@/features/school/types";
import { formatDate, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/programs/$programId")({
  head: () => ({
    meta: [{ title: "Formation — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <ProgramPage />
    </RequireAuth>
  ),
});

/** How many enrolled names a single-group formation lists before linking to the full roster. */
const ROSTER_PREVIEW = 8;

function ProgramPage() {
  const { t, locale } = useI18n();
  const levelLabel = useProgramLevelLabel();
  const typeLabels = useFormationTypeLabels();
  const systemLabel = useLevelSystemLabel();
  const { programId } = Route.useParams();
  const programs = usePrograms();
  const groupsQuery = useGroups();
  const [form, setForm] = useState<ProgramFormState | null>(null);
  const [change, setChange] = useState<ProgramStatusChange | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupInput | null>(null);
  // Enrolling from the formation page: the group chosen (one group, or a row of several).
  const [enrollInto, setEnrollInto] = useState<GroupRow | null>(null);

  const program = (programs.data ?? []).find((p) => p.id === programId) ?? null;
  // The full group rows (schedule, teacher, enrolment) come from the same cached query as the
  // Groups page; the formation's own embed carries only what its list needs.
  const groups = useMemo(
    () => (groupsQuery.data ?? []).filter((g) => g.programId === programId),
    [groupsQuery.data, programId],
  );

  const none = t("programs.none");
  const isLoading = programs.isLoading || groupsQuery.isLoading;
  const error = programs.error ?? groupsQuery.error;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <BackLink />
        <ErrorState
          error={error}
          onRetry={() => {
            void programs.refetch();
            void groupsQuery.refetch();
          }}
          isRetrying={programs.isFetching || groupsQuery.isFetching}
        />
      </div>
    );
  }
  if (!program) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={Library}
          title={t("programs.title")}
          description={t("programs.notFound")}
        />
      </div>
    );
  }

  const summary = summariseProgramGroups(program.groups);
  // An archived formation takes no new groups -- the group form does not offer it either.
  const canAddGroups = program.status !== "archived";
  const canEdit = program.status !== "archived";
  const lockedProgram = { id: program.id, name: program.name };

  const newGroup = () =>
    setGroupDraft({
      ...emptyGroupDraft(),
      ...groupDefaultsFromProgram(program, todayIso()),
      name: t("programs.page.groupName", {
        program: program.name,
        letter: nextGroupLetter(program.groups.length),
      }),
    });
  const editGroup = canEdit ? (g: GroupRow) => setGroupDraft(groupToDraft(g)) : undefined;
  const enrollGroup = (g: GroupRow) => setEnrollInto(g);

  const addGroupButton = canAddGroups ? (
    <Button variant="outline" className="rounded-xl" onClick={newGroup}>
      <Plus className="size-4" aria-hidden />
      {t("programs.page.newGroup")}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={program.name}
        description={[
          typeLabels.labelOf(program.category),
          levelLabel(program),
          program.subjectName,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {canEdit && (
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setForm({ mode: "edit", program })}
              >
                <Pencil className="size-4" aria-hidden />
                {t("programs.edit")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-10 rounded-xl"
                  aria-label={t("programs.actionsAria", { name: program.name })}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl">
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                  {program.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {nextStatuses(program.status).map((to) => (
                  <DropdownMenuItem
                    key={to}
                    onSelect={() => setChange({ program, to })}
                    className={
                      to === "cancelled" ? "text-destructive focus:text-destructive" : undefined
                    }
                  >
                    {t(`programs.action.${to}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={program.status} />
        {program.registrationOpen && (
          <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
            {t("programs.registrationOpen")}
          </span>
        )}
      </div>

      <SectionCard title={t("programs.page.info")}>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          <Detail label={t("programs.col.category")}>{typeLabels.labelOf(program.category)}</Detail>
          <Detail label={t("programs.detail.subject")}>{program.subjectName ?? none}</Detail>
          <Detail label={t("programs.detail.levelSystem")}>
            {program.levelSystemId
              ? systemLabel({ code: program.levelSystemCode, name: program.levelSystemName })
              : t("programs.form.noLevel")}
          </Detail>
          {program.levelSystemId && (
            <Detail label={t("programs.detail.level")}>
              {program.levelName ?? t("programs.form.allLevels")}
            </Detail>
          )}
          <Detail label={t("programs.detail.dates")}>
            <span className="tabular-nums">
              {formatPeriod(program.startDate, program.endDate, locale, t)}
            </span>
          </Detail>
          <Detail label={t("programs.detail.duration")}>
            {program.durationHours != null
              ? t("programs.detail.hours", { hours: program.durationHours })
              : none}
          </Detail>
          {/* With several groups these are the formation's totals. With one group they are
              that group's facts, shown with it below -- not repeated here. */}
          {groups.length > 1 && (
            <>
              <Detail label={t("programs.detail.teachers")}>
                {summary.teachers.length > 0
                  ? summary.teachers.map((x) => x.name ?? none).join(", ")
                  : t("programs.detail.noTeacher")}
              </Detail>
              <Detail label={t("programs.col.seats")}>
                <span className="tabular-nums" dir="ltr">
                  {t("programs.seats", { enrolled: summary.enrolled, seats: summary.seats })}
                </span>
              </Detail>
            </>
          )}
          {program.description && (
            <Detail label={t("programs.detail.description")}>
              <span className="whitespace-pre-line">{program.description}</span>
            </Detail>
          )}
          {program.curriculum && (
            <Detail label={t("programs.detail.curriculum")}>
              <span className="whitespace-pre-line">{program.curriculum}</span>
            </Detail>
          )}
        </dl>
      </SectionCard>

      <PublicLinkCard
        programId={program.id}
        programName={program.name}
        open={program.status === "active" && program.registrationOpen}
      />

      {groups.length === 0 ? (
        <SectionCard title={t("programs.detail.groups")}>
          <EmptyState
            icon={GraduationCap}
            title={t("programs.page.noGroupsTitle")}
            description={t(
              canAddGroups ? "programs.page.noGroupsBody" : "programs.page.archivedNoGroups",
            )}
            className="border-none shadow-none"
            action={
              canAddGroups ? (
                <Button className="mt-2 rounded-xl" onClick={newGroup}>
                  <Plus className="size-4" aria-hidden />
                  {t("programs.page.firstGroup")}
                </Button>
              ) : undefined
            }
          />
        </SectionCard>
      ) : groups.length === 1 ? (
        <SingleGroup
          group={groups[0] as GroupRow}
          onEdit={editGroup}
          onEnroll={enrollGroup}
          actions={addGroupButton}
        />
      ) : (
        <SectionCard
          title={`${t("programs.detail.groups")} (${groups.length})`}
          description={t("programs.detail.capacity", {
            enrolled: summary.enrolled,
            seats: summary.seats,
            groups: summary.activeGroupCount,
          })}
          actions={addGroupButton}
        >
          <ul className="space-y-2" aria-label={t("programs.detail.groups")}>
            {groups.map((g) => (
              <GroupRowItem key={g.id} group={g} onEdit={editGroup} onEnroll={enrollGroup} />
            ))}
          </ul>
        </SectionCard>
      )}

      <FeeTemplatesCard programId={program.id} />

      {form && (
        <ProgramFormDialog
          key={form.mode === "edit" ? form.program.id : "create"}
          state={form}
          onClose={() => setForm(null)}
        />
      )}
      <ProgramStatusDialog change={change} onClose={() => setChange(null)} />
      {enrollInto && (
        <EnrollStudentDialog
          group={{
            id: enrollInto.id,
            name: enrollInto.name,
            maxStudents: enrollInto.maxStudents,
            enrolled: enrollInto.enrolled,
          }}
          onClose={() => setEnrollInto(null)}
        />
      )}
      {groupDraft && (
        <GroupFormDialog
          key={groupDraft.id ?? "new"}
          initial={groupDraft}
          lockedProgram={lockedProgram}
          onClose={() => setGroupDraft(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

/**
 * A formation delivered by exactly one group: the group's operational facts and its enrolled
 * students, in place. The group keeps its own page (roster, attendance, resources, exports).
 */
function SingleGroup({
  group: g,
  onEdit,
  onEnroll,
  actions,
}: {
  group: GroupRow;
  onEdit?: ((g: GroupRow) => void) | undefined;
  onEnroll: (g: GroupRow) => void;
  actions?: ReactNode;
}) {
  const { t, locale } = useI18n();
  // BOUNDED (BUG-01): this group's registrations only.
  const registrations = useGroupRegistrations(g.id);
  const enrolled = useMemo(
    () =>
      (registrations.data?.rows ?? [])
        .filter((r) => r.status === "approved")
        .map((r) => r.studentName)
        .sort((a, b) => a.localeCompare(b)),
    [registrations.data],
  );
  const pendingCount = (registrations.data?.rows ?? []).filter(
    (r) => r.status === "pending",
  ).length;
  const left = placesLeft(g);

  return (
    <SectionCard title={t("programs.page.groupSection")} actions={actions}>
      <div className="space-y-5" data-testid="single-group">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Link
              to="/dashboard/groups/$groupId"
              params={{ groupId: g.id }}
              className="focus-ring inline-flex max-w-full items-center gap-1 truncate rounded font-medium hover:text-primary"
            >
              <span className="truncate">{g.name}</span>
              <ArrowUpRight className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
            </Link>
          </div>
          <StatusBadge status={g.status} />
          <Button size="sm" className="rounded-lg" onClick={() => onEnroll(g)}>
            <UserPlus className="size-4" aria-hidden />
            {t("enroll.title")}
          </Button>
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label={t("form.groups.editAria", { name: g.name })}
              onClick={() => onEdit(g)}
            >
              <Pencil className="size-4" aria-hidden />
            </Button>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          <Detail label={t("programs.page.teacher")}>
            {g.teacherName ?? (
              <span className="text-muted-foreground">{t("programs.detail.noTeacher")}</span>
            )}
          </Detail>
          <Detail label={t("programs.page.schedule")}>
            <SlotList group={g} />
          </Detail>
          <Detail label={t("programs.page.term")}>
            <span className="tabular-nums">{formatPeriod(g.startDate, g.endDate, locale, t)}</span>
          </Detail>
          <Detail label={t("programs.col.seats")}>
            <span className="tabular-nums" dir="ltr">
              {t("programs.seats", { enrolled: g.enrolled, seats: g.maxStudents })}
            </span>{" "}
            <span className="text-muted-foreground">
              · {t("programs.page.placesLeft", { count: left })}
            </span>
            {pendingCount > 0 && (
              <Link
                to="/dashboard/groups/$groupId"
                params={{ groupId: g.id }}
                className="focus-ring ms-2 rounded text-xs text-accent hover:underline"
              >
                {t("programs.page.pendingRequests", { count: pendingCount })}
              </Link>
            )}
          </Detail>
          <Detail label={t("programs.page.enrolled")}>
            {enrolled.length === 0 ? (
              <span className="text-muted-foreground">{t("programs.page.noEnrolled")}</span>
            ) : (
              <div className="space-y-1.5">
                <ul className="flex flex-wrap gap-1.5" aria-label={t("programs.page.enrolled")}>
                  {enrolled.slice(0, ROSTER_PREVIEW).map((name, i) => (
                    <li
                      key={`${name}-${i}`}
                      className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/dashboard/groups/$groupId"
                  params={{ groupId: g.id }}
                  className="focus-ring inline-block rounded text-xs text-primary hover:underline"
                >
                  {enrolled.length > ROSTER_PREVIEW
                    ? t("programs.page.moreEnrolled", { count: enrolled.length - ROSTER_PREVIEW })
                    : t("programs.page.openRoster")}
                </Link>
              </div>
            )}
          </Detail>
        </dl>
      </div>
    </SectionCard>
  );
}

/** One group of a multi-group formation: everything an administrator checks at a glance. */
function GroupRowItem({
  group: g,
  onEdit,
  onEnroll,
}: {
  group: GroupRow;
  onEdit?: ((g: GroupRow) => void) | undefined;
  onEnroll: (g: GroupRow) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <li className="surface-row flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-48">
        <Link
          to="/dashboard/groups/$groupId"
          params={{ groupId: g.id }}
          className="focus-ring block truncate rounded text-sm font-medium hover:text-primary"
        >
          {g.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {g.teacherName ?? t("programs.detail.noTeacher")} ·{" "}
          <span className="tabular-nums">{formatPeriod(g.startDate, g.endDate, locale, t)}</span>
        </p>
      </div>
      <SlotList group={g} />
      <span className="text-xs tabular-nums text-muted-foreground">
        <span dir="ltr">{t("programs.seats", { enrolled: g.enrolled, seats: g.maxStudents })}</span>
        {" · "}
        {t("programs.page.placesLeft", { count: placesLeft(g) })}
      </span>
      <StatusBadge status={g.status} />
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-lg"
        aria-label={t("enroll.inGroupAria", { group: g.name })}
        onClick={() => onEnroll(g)}
      >
        <UserPlus className="size-4" aria-hidden />
      </Button>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-lg"
          aria-label={t("form.groups.editAria", { name: g.name })}
          onClick={() => onEdit(g)}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      )}
    </li>
  );
}

/** Weekly slots as chips: day, time and, when set, the room. */
function SlotList({ group: g }: { group: GroupRow }) {
  const { t } = useI18n();
  if (g.schedules.length === 0) {
    return <span className="text-xs text-muted-foreground">{t("entity.groups.noSchedule")}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {g.schedules.map((s) => (
        <span
          key={s.id}
          className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          {weekdayLabel(s.weekday, t).slice(0, 3)}{" "}
          <span dir="ltr" className="tabular-nums">
            {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
          </span>
          {s.room ? ` · ${s.room}` : ""}
        </span>
      ))}
    </span>
  );
}

function formatPeriod(
  start: string | null,
  end: string | null,
  locale: Parameters<typeof formatDate>[1],
  t: (key: string) => string,
): string {
  if (!start && !end) return t("programs.none");
  return `${start ? formatDate(start, locale) : t("programs.none")} → ${
    end ? formatDate(end, locale) : t("programs.detail.openEnded")
  }`;
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Button asChild variant="ghost" size="sm" className="-ms-2 rounded-xl text-muted-foreground">
      <Link to="/dashboard/programs">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("programs.back")}
      </Link>
    </Button>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
