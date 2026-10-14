import type { SubjectDomain } from "./subject-domain";

export type EntityStatus = "active" | "inactive";
export type RegistrationStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type LevelStage = "primary" | "middle" | "high";

export interface Level {
  id: string;
  name: string;
  stage: LevelStage;
  position: number;
  status: EntityStatus;
}

export interface Subject {
  id: string;
  /** Stable locale-independent identity; the UI renders t(`subject.${key}`). */
  key: string;
  name: string;
  color: string;
  description: string | null;
  /** What the subject is (languages, school subjects...): filters the formation form. */
  domain: SubjectDomain;
  status: EntityStatus;
}

export interface TeacherRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  experienceYears: number;
  bio: string | null;
  status: EntityStatus;
  subjects: string[];
  subjectIds: string[];
  groupCount: number;
}

export interface StudentRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  levelId: string | null;
  levelName: string | null;
  streamId: string | null;
  status: EntityStatus;
  registeredAt: string;
  groupCount: number;
}

/** An academic stream (filière). Belongs to exactly one level. */
export interface StreamRow {
  id: string;
  levelId: string;
  /** Stable machine key, e.g. "maths". Safe to match on; names may be edited. */
  code: string;
  nameFr: string;
  nameAr: string;
  nameEn: string;
  position: number;
  status: EntityStatus;
}

export interface ScheduleSlot {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  room: string | null;
  /** The managed room (rooms, ADR-007); `room` is its name, or legacy free text. */
  roomId?: string | null;
}

export interface GroupRow {
  id: string;
  name: string;
  subjectId: string | null;
  subjectKey: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  teacherId: string | null;
  teacherName: string | null;
  /**
   * The teacher's photo, from `profiles.avatar_url`. Read through the group's teacher
   * relationship -- never copied onto `groups` -- so there is one place a photo lives.
   */
  teacherAvatarUrl: string | null;
  levelId: string | null;
  levelName: string | null;
  /** NULL means the group is open to every stream of its level. */
  streamId: string | null;
  /** Optional programme (20261001100000). NULL for a standalone group. */
  programId: string | null;
  /** Null when there is no programme OR the viewer may not read it (RLS). */
  programName: string | null;
  /** First day the weekly pattern applies (ISO YYYY-MM-DD). */
  startDate: string | null;
  /** Last day the pattern applies; null means open-ended. */
  endDate: string | null;
  maxStudents: number;
  priceDzd: number;
  status: EntityStatus;
  enrolled: number;
  schedules: ScheduleSlot[];
}

export interface RegistrationRow {
  id: string;
  studentId: string;
  studentName: string;
  groupId: string;
  groupName: string;
  subjectKey: string | null;
  subjectName: string | null;
  levelName: string | null;
  status: RegistrationStatus;
  createdAt: string;
  /** The administration's note on a decision (shown to the student on a rejection). */
  note?: string | null;
  decidedAt?: string | null;
  /** Set when an approved place was given up (status `withdrawn`). */
  withdrawnAt?: string | null;
  withdrawalReason?: string | null;
}

/* --------------------------- NOTES & NOTICES --------------------------- */

export interface StudentNote {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
}

export type NotificationKind =
  | "registration_approved"
  | "registration_rejected"
  | "attendance_marked"
  | "teacher_assigned"
  | "group_updated"
  | "announcement"
  | "resource_published"
  | "chapter_published"
  | "application_received"
  // Communication (ADR-009)
  | "message_received"
  | "payment_reminder"
  | "absence_alert"
  | "lesson_log_reminder";

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  /** Interpolated into the `notification.<kind>` translation template. */
  params: Record<string, string>;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------ ATTENDANCE ------------------------------ */

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Percentage of sessions attended; `late` counts as attended. */
  rate: number;
}

export interface AttendanceHistoryRow {
  id: string;
  sessionDate: string;
  status: AttendanceStatus;
  groupId: string;
  groupName: string;
  subjectName: string | null;
  studentId: string;
  studentName: string;
}
