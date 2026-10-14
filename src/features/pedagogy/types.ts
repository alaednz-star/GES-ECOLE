/**
 * Pédagogie (ADR-008): the shapes the pages work with, mapped from the database rows by
 * `queries.ts`. Averages, ranks and coverage are never stored; the pure models derive them.
 */

export const ASSESSMENT_KINDS = ["exam", "test", "quiz", "homework", "oral", "project"] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export interface LessonEntry {
  id: string;
  groupId: string;
  sessionDate: string;
  chapterId: string | null;
  summary: string;
  homework: string | null;
  homeworkDue: string | null;
  updatedAt: string;
}

export interface Assessment {
  id: string;
  groupId: string;
  title: string;
  kind: AssessmentKind;
  heldOn: string;
  maxScore: number;
  coefficient: number;
  published: boolean;
}

export interface Score {
  assessmentId: string;
  studentId: string;
  /** NULL when absent, or not graded yet. */
  score: number | null;
  absent: boolean;
  comment: string | null;
}

export interface Period {
  id: string;
  name: string;
  academicYear: string | null;
  startsOn: string;
  endsOn: string;
  position: number;
}

export interface ReportComment {
  id: string;
  periodId: string;
  studentId: string;
  /** NULL = the general remark (administrators). */
  groupId: string | null;
  comment: string;
}

export interface PedChapter {
  id: string;
  groupId: string;
  title: string;
  position: number;
  completedOn: string | null;
}

export interface RosterStudent {
  studentId: string;
  fullName: string;
}
