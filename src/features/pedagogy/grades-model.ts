/**
 * Notes & bulletins (ADR-008): averages, ranks and statistics. PURE.
 *
 * Rules:
 * - every score is brought to /20 (score / max * 20) and weighted by its assessment's coefficient;
 * - an absence, or a score not entered yet, is left out (never counted as zero);
 * - a student with no counted score has no average and no rank;
 * - ranks are competition ranks (1, 2, 2, 4) on the average rounded to two decimals;
 * - the general average is the plain mean of the student's group averages.
 * An assessment belongs to the period whose dates contain its date.
 */

import type { Assessment, Period, RosterStudent, Score } from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** The period containing an ISO date, or null. */
export function periodOf(date: string, periods: Period[]): Period | null {
  return periods.find((p) => p.startsOn <= date && date <= p.endsOn) ?? null;
}

/** Assessments held within a period (all of them when no period is given). */
export function inPeriod<T extends { heldOn: string }>(rows: T[], period: Period | null): T[] {
  if (!period) return rows;
  return rows.filter((a) => period.startsOn <= a.heldOn && a.heldOn <= period.endsOn);
}

export function on20(score: number, max: number): number {
  return (score / max) * 20;
}

const scoreKey = (assessmentId: string, studentId: string) => `${assessmentId}:${studentId}`;

export function indexScores(scores: Score[]): Map<string, Score> {
  return new Map(scores.map((s) => [scoreKey(s.assessmentId, s.studentId), s]));
}

export function scoreFor(index: Map<string, Score>, assessmentId: string, studentId: string) {
  return index.get(scoreKey(assessmentId, studentId)) ?? null;
}

/** A student's weighted average /20 over the given assessments, or null. */
export function studentAverage(
  assessments: Assessment[],
  index: Map<string, Score>,
  studentId: string,
): { average: number | null; counted: number } {
  let sum = 0;
  let weights = 0;
  let counted = 0;
  for (const a of assessments) {
    const s = scoreFor(index, a.id, studentId);
    if (!s || s.absent || s.score === null) continue;
    sum += on20(s.score, a.maxScore) * a.coefficient;
    weights += a.coefficient;
    counted += 1;
  }
  return { average: weights > 0 ? round2(sum / weights) : null, counted };
}

/** Competition ranks over averages; students without an average get null. */
export function rankAverages(values: (number | null)[]): (number | null)[] {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => b - a);
  return values.map((v) => (v === null ? null : sorted.findIndex((x) => x === v) + 1));
}

export interface Spread {
  average: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

export function spread(values: (number | null)[]): Spread {
  const v = values.filter((x): x is number => x !== null);
  if (v.length === 0) return { average: null, min: null, max: null, count: 0 };
  return {
    average: round2(v.reduce((s, x) => s + x, 0) / v.length),
    min: Math.min(...v),
    max: Math.max(...v),
    count: v.length,
  };
}

export interface MatrixRow {
  student: RosterStudent;
  average: number | null;
  counted: number;
  rank: number | null;
}

export interface GroupMatrix {
  rows: MatrixRow[];
  /** Class figures on the students' averages (/20). */
  classStats: Spread;
}

/** One group's results: each roster student's average and rank, and the class figures. */
export function groupMatrix(
  assessments: Assessment[],
  scores: Score[],
  roster: RosterStudent[],
): GroupMatrix {
  const index = indexScores(scores);
  const base = roster.map((student) => ({
    student,
    ...studentAverage(assessments, index, student.studentId),
  }));
  const ranks = rankAverages(base.map((r) => r.average));
  const rows = base.map((r, i) => ({ ...r, rank: ranks[i] ?? null }));
  return { rows, classStats: spread(rows.map((r) => r.average)) };
}

export interface AssessmentStats extends Spread {
  absent: number;
  /** Roster students with neither a score nor an absence. */
  missing: number;
}

/** Figures of one assessment, on its own scale (not /20). */
export function assessmentStats(
  assessment: Assessment,
  scores: Score[],
  roster: RosterStudent[],
): AssessmentStats {
  const index = indexScores(scores);
  let absent = 0;
  let missing = 0;
  const values: number[] = [];
  for (const st of roster) {
    const s = scoreFor(index, assessment.id, st.studentId);
    if (s?.absent) absent += 1;
    else if (s && s.score !== null) values.push(s.score);
    else missing += 1;
  }
  return { ...spread(values), absent, missing };
}

/** Mean of the available group averages, or null. */
export function generalAverage(averages: (number | null)[]): number | null {
  return spread(averages).average;
}

export type Mention = "excellent" | "veryGood" | "good" | "fair" | "insufficient";

/** The usual Algerian appreciation thresholds on /20. */
export function mentionOf(average: number | null): Mention | null {
  if (average === null) return null;
  if (average >= 16) return "excellent";
  if (average >= 14) return "veryGood";
  if (average >= 12) return "good";
  if (average >= 10) return "fair";
  return "insufficient";
}

/** Class average per period, in period order, for the progression trend. */
export function periodTrend(
  periods: Period[],
  assessments: Assessment[],
  scores: Score[],
  roster: RosterStudent[],
): { period: Period; classAverage: number | null; assessments: number }[] {
  return [...periods]
    .sort((a, b) => a.position - b.position || a.startsOn.localeCompare(b.startsOn))
    .map((period) => {
      const list = inPeriod(assessments, period);
      return {
        period,
        classAverage: groupMatrix(list, scores, roster).classStats.average,
        assessments: list.length,
      };
    });
}

/**
 * Validates one score-sheet line before saving. Returns an i18n key, or null when valid.
 * `raw` is the typed text: empty means "no score".
 */
export function scoreError(raw: string, absent: boolean, max: number): string | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (absent) return "assessments.error.absentWithScore";
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > max) return "assessments.error.range";
  // On the text, not n * 100: 12.35 * 100 is 1234.9999999999998 in floating point.
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "assessments.error.decimals";
  return null;
}

export function parseScore(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  return text === "" ? null : Number(text);
}
