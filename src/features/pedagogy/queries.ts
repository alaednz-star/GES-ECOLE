/**
 * Pédagogie data (ADR-008): lesson log, chapters' completion, assessments and scores, periods,
 * report-card remarks. Fetches and writes only; figures come from the pure models.
 *
 * SECURITY is the database's: a group's teacher or an administrator reads and writes its pedagogy
 * (can_manage_group, RLS); periods are admin-written; students read only their own published
 * results. A write that RLS silently filters (0 rows) is reported as "not allowed".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OFFLINE_MUTATIONS } from "@/features/desktop/offline-model";
import type {
  Assessment,
  AssessmentKind,
  LessonEntry,
  PedChapter,
  Period,
  ReportComment,
  RosterStudent,
  Score,
} from "./types";

export const pedKeys = {
  all: ["pedagogy"] as const,
  entries: (groupId: string | null) => ["pedagogy", "entries", groupId ?? "all"] as const,
  chapters: (groupId: string | null) => ["pedagogy", "chapters", groupId ?? "all"] as const,
  roster: (groupId: string) => ["pedagogy", "roster", groupId] as const,
  assessments: (groupId: string | null) => ["pedagogy", "assessments", groupId ?? "all"] as const,
  scores: (key: string) => ["pedagogy", "scores", key] as const,
  periods: () => ["pedagogy", "periods"] as const,
  comments: (periodId: string) => ["pedagogy", "comments", periodId] as const,
  reportCard: (periodId: string, studentId: string) =>
    ["pedagogy", "report-card", periodId, studentId] as const,
};

const NOT_ALLOWED = { code: "42501", message: "Not allowed" };

function touched(data: unknown[] | null) {
  if (!data || data.length === 0) throw NOT_ALLOWED;
}

/* ------------------------------------------------------------------ lesson log */

const ENTRY_SELECT =
  "id, group_id, session_date, chapter_id, summary, homework, homework_due, updated_at";

interface RawEntry {
  id: string;
  group_id: string;
  session_date: string;
  chapter_id: string | null;
  summary: string;
  homework: string | null;
  homework_due: string | null;
  updated_at: string;
}

const toEntry = (r: RawEntry): LessonEntry => ({
  id: r.id,
  groupId: r.group_id,
  sessionDate: r.session_date,
  chapterId: r.chapter_id,
  summary: r.summary,
  homework: r.homework,
  homeworkDue: r.homework_due,
  updatedAt: r.updated_at,
});

/** One group's entries, or every entry the caller may read (progression overview). */
export function useLessonEntries(groupId: string | null, enabled = true) {
  return useQuery({
    queryKey: pedKeys.entries(groupId),
    enabled,
    queryFn: async (): Promise<LessonEntry[]> => {
      let q = supabase.from("lesson_entries").select(ENTRY_SELECT);
      if (groupId) q = q.eq("group_id", groupId);
      const { data, error } = await q.order("session_date", { ascending: false }).limit(5000);
      if (error) throw error;
      return ((data ?? []) as RawEntry[]).map(toEntry);
    },
  });
}

export interface LessonEntryInput {
  id?: string;
  groupId: string;
  sessionDate: string;
  chapterId: string | null;
  summary: string;
  homework: string | null;
  homeworkDue: string | null;
}

/** The lesson-entry write. Standalone so the desktop app can replay it after a restart. */
export async function saveLessonEntryRequest(input: LessonEntryInput): Promise<void> {
  const row = {
    chapter_id: input.chapterId,
    summary: input.summary,
    homework: input.homework,
    homework_due: input.homeworkDue,
  };
  const { data, error } = input.id
    ? await supabase.from("lesson_entries").update(row).eq("id", input.id).select("id")
    : await supabase
        .from("lesson_entries")
        .insert({ ...row, group_id: input.groupId, session_date: input.sessionDate })
        .select("id");
  if (error) throw error;
  touched(data);
}

export function useSaveLessonEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: OFFLINE_MUTATIONS.lessonEntry,
    mutationFn: saveLessonEntryRequest,
    // Shown at once, so a session filled in offline no longer reads « à renseigner »; the real
    // row replaces it when the write reaches the server.
    onMutate: (input) => {
      qc.setQueriesData<LessonEntry[]>({ queryKey: ["pedagogy", "entries"] }, (old) => {
        if (!old) return old;
        const entry: LessonEntry = {
          id: input.id ?? `pending-${input.groupId}-${input.sessionDate}`,
          groupId: input.groupId,
          sessionDate: input.sessionDate,
          chapterId: input.chapterId,
          summary: input.summary,
          homework: input.homework,
          homeworkDue: input.homeworkDue,
          updatedAt: new Date().toISOString(),
        };
        const rest = old.filter((e) => !(e.groupId === input.groupId && e.sessionDate === input.sessionDate));
        return [entry, ...rest];
      });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["pedagogy", "entries"] }),
  });
}

export function useDeleteLessonEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("lesson_entries")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedagogy", "entries"] }),
  });
}

/* ------------------------------------------------------------------ chapters */

export function useChapters(groupId: string | null, enabled = true) {
  return useQuery({
    queryKey: pedKeys.chapters(groupId),
    enabled,
    queryFn: async (): Promise<PedChapter[]> => {
      let q = supabase.from("chapters").select("id, group_id, title, position, completed_on");
      if (groupId) q = q.eq("group_id", groupId);
      const { data, error } = await q.order("position").limit(5000);
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id,
        groupId: c.group_id,
        title: c.title,
        position: c.position,
        completedOn: c.completed_on,
      }));
    },
  });
}

export function useSetChapterCompleted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, completedOn }: { id: string; completedOn: string | null }) => {
      const { data, error } = await supabase
        .from("chapters")
        .update({ completed_on: completedOn })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pedagogy", "chapters"] });
      void qc.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}

/* ------------------------------------------------------------------ roster */

interface RawRosterRow {
  student_id: string;
  group_id: string;
  students: { profiles: { full_name: string | null } | null } | null;
}

function toRoster(rows: RawRosterRow[]): RosterStudent[] {
  return rows
    .map((r) => ({ studentId: r.student_id, fullName: r.students?.profiles?.full_name ?? "—" }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** The group's enrolled students (approved), by name. */
export function useGroupRoster(groupId: string | null) {
  return useQuery({
    queryKey: pedKeys.roster(groupId ?? "none"),
    enabled: !!groupId,
    queryFn: async (): Promise<RosterStudent[]> => {
      const { data, error } = await supabase
        .from("registrations")
        .select("student_id, group_id, students(profiles(full_name))")
        .eq("group_id", groupId as string)
        .eq("status", "approved");
      if (error) throw error;
      return toRoster((data ?? []) as unknown as RawRosterRow[]);
    },
  });
}

/* ------------------------------------------------------------------ assessments */

const ASSESSMENT_SELECT = "id, group_id, title, kind, held_on, max_score, coefficient, published";

interface RawAssessment {
  id: string;
  group_id: string;
  title: string;
  kind: string;
  held_on: string;
  max_score: number;
  coefficient: number;
  published: boolean;
}

const toAssessment = (r: RawAssessment): Assessment => ({
  id: r.id,
  groupId: r.group_id,
  title: r.title,
  kind: r.kind as AssessmentKind,
  heldOn: r.held_on,
  maxScore: Number(r.max_score),
  coefficient: Number(r.coefficient),
  published: r.published,
});

export function useAssessments(groupId: string | null) {
  return useQuery({
    queryKey: pedKeys.assessments(groupId),
    queryFn: async (): Promise<Assessment[]> => {
      let q = supabase.from("assessments").select(ASSESSMENT_SELECT);
      if (groupId) q = q.eq("group_id", groupId);
      const { data, error } = await q.order("held_on", { ascending: false }).limit(2000);
      if (error) throw error;
      return ((data ?? []) as RawAssessment[]).map(toAssessment);
    },
  });
}

export interface AssessmentInput {
  id?: string;
  groupId: string;
  title: string;
  kind: AssessmentKind;
  heldOn: string;
  maxScore: number;
  coefficient: number;
  published: boolean;
}

export function useSaveAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssessmentInput) => {
      const row = {
        title: input.title,
        kind: input.kind,
        held_on: input.heldOn,
        max_score: input.maxScore,
        coefficient: input.coefficient,
        published: input.published,
      };
      const { data, error } = input.id
        ? await supabase.from("assessments").update(row).eq("id", input.id).select("id")
        : await supabase
            .from("assessments")
            .insert({ ...row, group_id: input.groupId })
            .select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedagogy"] }),
  });
}

export function useSetAssessmentPublished() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const { data, error } = await supabase
        .from("assessments")
        .update({ published })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedagogy"] }),
  });
}

export function useDeleteAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("assessments").delete().eq("id", id).select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedagogy"] }),
  });
}

/* ------------------------------------------------------------------ scores */

interface RawScore {
  assessment_id: string;
  student_id: string;
  score: number | null;
  absent: boolean;
  comment: string | null;
}

const toScore = (r: RawScore): Score => ({
  assessmentId: r.assessment_id,
  studentId: r.student_id,
  score: r.score === null ? null : Number(r.score),
  absent: r.absent,
  comment: r.comment,
});

async function fetchScores(assessmentIds: string[]): Promise<Score[]> {
  if (assessmentIds.length === 0) return [];
  const out: Score[] = [];
  // Chunked: an `in (...)` list travels in the URL.
  for (let i = 0; i < assessmentIds.length; i += 150) {
    const { data, error } = await supabase
      .from("assessment_scores")
      .select("assessment_id, student_id, score, absent, comment")
      .in("assessment_id", assessmentIds.slice(i, i + 150));
    if (error) throw error;
    out.push(...((data ?? []) as RawScore[]).map(toScore));
  }
  return out;
}

/** Scores of the given assessments (a score sheet, a group's matrix). */
export function useScores(assessmentIds: string[]) {
  const key = [...assessmentIds].sort().join(",");
  return useQuery({
    queryKey: pedKeys.scores(key || "none"),
    enabled: assessmentIds.length > 0,
    queryFn: () => fetchScores(assessmentIds),
  });
}

export interface ScoreLine {
  studentId: string;
  score: number | null;
  absent: boolean;
  comment: string | null;
}

/**
 * Saves the CHANGED lines of a score sheet: a line with a score, an absence or a comment is
 * upserted; a line emptied entirely is deleted.
 */
/** The score-sheet write. Standalone so the desktop app can replay it after a restart. */
export async function saveScoresRequest({
  assessmentId,
  lines,
}: {
  assessmentId: string;
  lines: ScoreLine[];
}): Promise<void> {
  {
      const keep = lines.filter((l) => l.score !== null || l.absent || l.comment);
      const drop = lines.filter((l) => !(l.score !== null || l.absent || l.comment));
      if (keep.length) {
        const { error } = await supabase.from("assessment_scores").upsert(
          keep.map((l) => ({
            assessment_id: assessmentId,
            student_id: l.studentId,
            score: l.absent ? null : l.score,
            absent: l.absent,
            comment: l.comment,
          })),
          { onConflict: "assessment_id,student_id" },
        );
        if (error) throw error;
      }
      if (drop.length) {
        const { error } = await supabase
          .from("assessment_scores")
          .delete()
          .eq("assessment_id", assessmentId)
          .in(
            "student_id",
            drop.map((l) => l.studentId),
          );
        if (error) throw error;
      }
  }
}

export function useSaveScores() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: OFFLINE_MUTATIONS.scores,
    mutationFn: saveScoresRequest,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedagogy"] }),
  });
}

/* ------------------------------------------------------------------ periods */

export function usePeriods() {
  return useQuery({
    queryKey: pedKeys.periods(),
    queryFn: async (): Promise<Period[]> => {
      const { data, error } = await supabase
        .from("academic_periods")
        .select("id, name, academic_year, starts_on, ends_on, position")
        .order("starts_on");
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        academicYear: p.academic_year,
        startsOn: p.starts_on,
        endsOn: p.ends_on,
        position: p.position,
      }));
    },
  });
}

export interface PeriodInput {
  id?: string;
  name: string;
  academicYear: string | null;
  startsOn: string;
  endsOn: string;
  position: number;
}

export function useSavePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PeriodInput) => {
      const row = {
        name: input.name,
        academic_year: input.academicYear,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        position: input.position,
      };
      const { data, error } = input.id
        ? await supabase.from("academic_periods").update(row).eq("id", input.id).select("id")
        : await supabase.from("academic_periods").insert(row).select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: pedKeys.periods() }),
  });
}

export function useDeletePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("academic_periods")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedagogy"] }),
  });
}

/* ------------------------------------------------------------------ remarks */

export function useReportComments(periodId: string | null) {
  return useQuery({
    queryKey: pedKeys.comments(periodId ?? "none"),
    enabled: !!periodId,
    queryFn: async (): Promise<ReportComment[]> => {
      const { data, error } = await supabase
        .from("report_comments")
        .select("id, period_id, student_id, group_id, comment")
        .eq("period_id", periodId as string)
        .limit(5000);
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id,
        periodId: c.period_id,
        studentId: c.student_id,
        groupId: c.group_id,
        comment: c.comment,
      }));
    },
  });
}

/** Writes one remark: creates, updates, or deletes it when emptied. */
export function useSaveReportComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string | null;
      periodId: string;
      studentId: string;
      groupId: string | null;
      comment: string;
    }) => {
      const text = input.comment.trim();
      if (input.id && !text) {
        const { data, error } = await supabase
          .from("report_comments")
          .delete()
          .eq("id", input.id)
          .select("id");
        if (error) throw error;
        touched(data);
        return;
      }
      if (!text) return;
      const { data, error } = input.id
        ? await supabase
            .from("report_comments")
            .update({ comment: text })
            .eq("id", input.id)
            .select("id")
        : await supabase
            .from("report_comments")
            .insert({
              period_id: input.periodId,
              student_id: input.studentId,
              group_id: input.groupId,
              comment: text,
            })
            .select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedagogy"] }),
  });
}

/* ------------------------------------------------------------------ report card */

export interface ReportCardData {
  student: { id: string; fullName: string; dateOfBirth: string | null };
  groups: {
    groupId: string;
    roster: RosterStudent[];
    assessments: Assessment[];
  }[];
  scores: Score[];
  comments: ReportComment[];
}

/**
 * Everything one student's report card needs for a period: the student's enrolled groups, their
 * assessments in the period, every score of those assessments (class average and rank) and the
 * remarks. RLS narrows it: a teacher only gets their own groups.
 */
export function useReportCard(period: Period | null, studentId: string | null) {
  return useQuery({
    queryKey: pedKeys.reportCard(period?.id ?? "none", studentId ?? "none"),
    enabled: !!period && !!studentId,
    queryFn: async (): Promise<ReportCardData> => {
      const p = period as Period;
      const sid = studentId as string;
      const [student, regs] = await Promise.all([
        supabase
          .from("students")
          .select("id, date_of_birth, profiles(full_name)")
          .eq("id", sid)
          .maybeSingle(),
        supabase
          .from("registrations")
          .select("group_id")
          .eq("student_id", sid)
          .in("status", ["approved", "withdrawn"]),
      ]);
      if (student.error) throw student.error;
      if (regs.error) throw regs.error;
      const groupIds = [...new Set((regs.data ?? []).map((r) => r.group_id))];
      if (groupIds.length === 0) {
        return {
          student: {
            id: sid,
            fullName: student.data?.profiles?.full_name ?? "—",
            dateOfBirth: student.data?.date_of_birth ?? null,
          },
          groups: [],
          scores: [],
          comments: [],
        };
      }
      const [assessments, rosters, comments] = await Promise.all([
        supabase
          .from("assessments")
          .select(ASSESSMENT_SELECT)
          .in("group_id", groupIds)
          .gte("held_on", p.startsOn)
          .lte("held_on", p.endsOn),
        supabase
          .from("registrations")
          .select("student_id, group_id, students(profiles(full_name))")
          .in("group_id", groupIds)
          .eq("status", "approved"),
        supabase
          .from("report_comments")
          .select("id, period_id, student_id, group_id, comment")
          .eq("period_id", p.id)
          .eq("student_id", sid),
      ]);
      if (assessments.error) throw assessments.error;
      if (rosters.error) throw rosters.error;
      if (comments.error) throw comments.error;
      const list = ((assessments.data ?? []) as RawAssessment[]).map(toAssessment);
      const rosterRows = (rosters.data ?? []) as unknown as RawRosterRow[];
      const scores = await fetchScores(list.map((a) => a.id));
      return {
        student: {
          id: sid,
          fullName: student.data?.profiles?.full_name ?? "—",
          dateOfBirth: student.data?.date_of_birth ?? null,
        },
        groups: groupIds.map((groupId) => ({
          groupId,
          roster: toRoster(rosterRows.filter((r) => r.group_id === groupId)),
          assessments: list.filter((a) => a.groupId === groupId),
        })),
        scores,
        comments: (comments.data ?? []).map((c) => ({
          id: c.id,
          periodId: c.period_id,
          studentId: c.student_id,
          groupId: c.group_id,
          comment: c.comment,
        })),
      };
    },
  });
}
