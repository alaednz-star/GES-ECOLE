/**
 * HR: vocabulary, validation and derived figures. PURE.
 *
 * No runtime imports, so `node --test` can load it. Every rule here is also enforced by the
 * database (20261001110100_hr_foundation.sql); this file lets forms explain a problem before
 * a request is refused, and computes the HR dashboard and the availability/timetable
 * comparison without fetching anything.
 *
 * NOT HERE: payroll. No salary, rate or amount appears anywhere in HR.
 */

export const STAFF_TYPES = ["teacher", "trainer", "administrative", "other"] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export const EMPLOYMENT_STATUSES = [
  "active",
  "on_leave",
  "suspended",
  "ended",
  "archived",
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const CONTRACT_TYPES = [
  "permanent",
  "fixed_term",
  "temporary",
  "freelance",
  "other",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const WORKING_TIMES = ["full_time", "part_time"] as const;
export type WorkingTime = (typeof WORKING_TIMES)[number];

export const CONTRACT_STATUSES = ["active", "ended", "cancelled"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const STAFF_ATTENDANCE_STATUSES = ["present", "late", "partial", "absent", "leave"] as const;
export type StaffAttendanceStatus = (typeof STAFF_ATTENDANCE_STATUSES)[number];

export const LEAVE_TYPES = ["annual", "sick", "unpaid", "training", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  "contract",
  "identity",
  "certificate",
  "qualification",
  "administrative",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Matches the `hr-documents` bucket. */
export const HR_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const HR_DOCUMENT_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Days ahead within which an active contract counts as "expiring soon". */
export const CONTRACT_EXPIRY_WINDOW_DAYS = 30;

type Errors<F extends string> = Partial<Record<F, string>>;
export type Validation<V, F extends string> =
  { ok: true; values: V } | { ok: false; errors: Errors<F> };

/* ------------------------------------------------------------------ dates & times */

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "HH:MM" or "HH:MM:SS" -> minutes since midnight, or null when malformed. */
export function toMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Adds `days` to an ISO date (UTC arithmetic on a calendar date, no time zone involved). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Weekday of an ISO date, 0 = Sunday (matches group_schedules and employee_availability). */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function trimOrNull(v: string, max: number): { value: string | null; tooLong: boolean } {
  const t = v.trim();
  return { value: t || null, tooLong: t.length > max };
}

/* ------------------------------------------------------------------ employee */

export interface EmployeeDraft {
  staffType: StaffType;
  employmentStatus: EmploymentStatus;
  position: string;
  department: string;
  employeeCode: string;
  startDate: string;
  endDate: string;
  address: string;
  dateOfBirth: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
}

export interface EmployeeValues {
  staffType: StaffType;
  employmentStatus: EmploymentStatus;
  position: string | null;
  department: string | null;
  employeeCode: string | null;
  startDate: string;
  endDate: string | null;
  address: string | null;
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
}

export type EmployeeField =
  | "staffType"
  | "employmentStatus"
  | "position"
  | "department"
  | "employeeCode"
  | "dates"
  | "address"
  | "dateOfBirth"
  | "emergencyContact"
  | "notes";

export function validateEmployeeDraft(d: EmployeeDraft): Validation<EmployeeValues, EmployeeField> {
  const e: Errors<EmployeeField> = {};
  if (!(STAFF_TYPES as readonly string[]).includes(d.staffType)) e.staffType = "hr.error.staffType";
  if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(d.employmentStatus)) {
    e.employmentStatus = "hr.error.status";
  }
  const position = trimOrNull(d.position, 120);
  if (position.tooLong) e.position = "hr.error.tooLong";
  const department = trimOrNull(d.department, 120);
  if (department.tooLong) e.department = "hr.error.tooLong";
  const code = trimOrNull(d.employeeCode, 40);
  if (code.tooLong) e.employeeCode = "hr.error.tooLong";

  const start = d.startDate.trim();
  const end = d.endDate.trim();
  if (!isIsoDate(start) || (end && !isIsoDate(end))) e.dates = "hr.error.date";
  else if (end && end < start) e.dates = "hr.error.endBeforeStart";
  else if (d.employmentStatus === "ended" && !end) e.dates = "hr.error.endedNeedsEnd";

  const dob = d.dateOfBirth.trim();
  if (dob && (!isIsoDate(dob) || dob < "1900-01-01" || dob > "2100-01-01")) {
    e.dateOfBirth = "hr.error.date";
  }
  const address = trimOrNull(d.address, 300);
  if (address.tooLong) e.address = "hr.error.tooLong";
  const ecName = trimOrNull(d.emergencyContactName, 120);
  const ecPhone = trimOrNull(d.emergencyContactPhone, 30);
  if (ecName.tooLong || ecPhone.tooLong) e.emergencyContact = "hr.error.tooLong";
  const notes = trimOrNull(d.notes, 2000);
  if (notes.tooLong) e.notes = "hr.error.tooLong";

  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    values: {
      staffType: d.staffType,
      employmentStatus: d.employmentStatus,
      position: position.value,
      department: department.value,
      employeeCode: code.value,
      startDate: start,
      endDate: end || null,
      address: address.value,
      dateOfBirth: dob || null,
      emergencyContactName: ecName.value,
      emergencyContactPhone: ecPhone.value,
      notes: notes.value,
    },
  };
}

/* ------------------------------------------------------------------ contract */

export interface ContractDraft {
  contractType: ContractType;
  workingTime: WorkingTime | null;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  notes: string;
}

export interface ContractValues {
  contractType: ContractType;
  workingTime: WorkingTime | null;
  startDate: string;
  endDate: string | null;
  status: ContractStatus;
  notes: string | null;
}

export type ContractField = "contractType" | "dates" | "status" | "notes";

export function validateContractDraft(d: ContractDraft): Validation<ContractValues, ContractField> {
  const e: Errors<ContractField> = {};
  if (!(CONTRACT_TYPES as readonly string[]).includes(d.contractType))
    e.contractType = "hr.error.contractType";
  if (!(CONTRACT_STATUSES as readonly string[]).includes(d.status)) e.status = "hr.error.status";
  const start = d.startDate.trim();
  const end = d.endDate.trim();
  if (!isIsoDate(start) || (end && !isIsoDate(end))) e.dates = "hr.error.date";
  else if (end && end < start) e.dates = "hr.error.endBeforeStart";
  else if (d.contractType === "fixed_term" && !end) e.dates = "hr.error.fixedTermNeedsEnd";
  else if (d.status === "ended" && !end) e.dates = "hr.error.endedNeedsEnd";
  const notes = trimOrNull(d.notes, 2000);
  if (notes.tooLong) e.notes = "hr.error.tooLong";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    values: {
      contractType: d.contractType,
      workingTime: d.workingTime,
      startDate: start,
      endDate: end || null,
      status: d.status,
      notes: notes.value,
    },
  };
}

/* ------------------------------------------------------------------ availability */

export interface AvailabilitySlot {
  id?: string;
  weekday: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}

export interface AvailabilityDraft {
  weekday: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveUntil: string;
  note: string;
}

export type AvailabilityField = "weekday" | "times" | "window" | "note" | "overlap";

function windowsOverlap(
  aFrom: string | null,
  aUntil: string | null,
  bFrom: string | null,
  bUntil: string | null,
): boolean {
  return (
    (aFrom ?? "0001-01-01") <= (bUntil ?? "9999-12-31") &&
    (bFrom ?? "0001-01-01") <= (aUntil ?? "9999-12-31")
  );
}

/** Same rule as `validate_employee_availability`: same weekday, overlapping times and windows. */
export function availabilityOverlaps(
  slot: AvailabilitySlot,
  others: readonly AvailabilitySlot[],
): boolean {
  const s = toMinutes(slot.startTime);
  const en = toMinutes(slot.endTime);
  if (s === null || en === null) return false;
  return others.some((o) => {
    if (o.id && slot.id && o.id === slot.id) return false;
    if (o.weekday !== slot.weekday) return false;
    const os = toMinutes(o.startTime);
    const oe = toMinutes(o.endTime);
    if (os === null || oe === null) return false;
    return (
      os < en &&
      s < oe &&
      windowsOverlap(o.effectiveFrom, o.effectiveUntil, slot.effectiveFrom, slot.effectiveUntil)
    );
  });
}

export function validateAvailabilityDraft(
  d: AvailabilityDraft,
  existing: readonly AvailabilitySlot[],
  editingId?: string,
): Validation<AvailabilitySlot & { note: string | null }, AvailabilityField> {
  const e: Errors<AvailabilityField> = {};
  if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6)
    e.weekday = "hr.error.weekday";
  const s = toMinutes(d.startTime);
  const en = toMinutes(d.endTime);
  if (s === null || en === null) e.times = "hr.error.time";
  else if (en <= s) e.times = "hr.error.endBeforeStartTime";
  const from = d.effectiveFrom.trim();
  const until = d.effectiveUntil.trim();
  if ((from && !isIsoDate(from)) || (until && !isIsoDate(until))) e.window = "hr.error.date";
  else if (from && until && until < from) e.window = "hr.error.endBeforeStart";
  const note = trimOrNull(d.note, 300);
  if (note.tooLong) e.note = "hr.error.tooLong";
  const slot: AvailabilitySlot = {
    ...(editingId ? { id: editingId } : {}),
    weekday: d.weekday,
    startTime: d.startTime.trim(),
    endTime: d.endTime.trim(),
    effectiveFrom: from || null,
    effectiveUntil: until || null,
  };
  if (Object.keys(e).length === 0 && availabilityOverlaps(slot, existing))
    e.overlap = "hr.error.availabilityOverlap";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, values: { ...slot, note: note.value } };
}

/* ------------------------------------------------------------------ staff attendance */

export interface StaffAttendanceDraft {
  workDate: string;
  status: StaffAttendanceStatus;
  checkIn: string;
  checkOut: string;
  note: string;
}

export interface StaffAttendanceValues {
  workDate: string;
  status: StaffAttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
}

export type StaffAttendanceField = "workDate" | "status" | "times" | "note";

/** Same rules as the `staff_attendance` CHECKs and trigger. `today` is the caller's local date. */
export function validateStaffAttendanceDraft(
  d: StaffAttendanceDraft,
  today: string,
): Validation<StaffAttendanceValues, StaffAttendanceField> {
  const e: Errors<StaffAttendanceField> = {};
  const date = d.workDate.trim();
  if (!isIsoDate(date)) e.workDate = "hr.error.date";
  else if (date > today) e.workDate = "hr.error.future";
  if (!(STAFF_ATTENDANCE_STATUSES as readonly string[]).includes(d.status))
    e.status = "hr.error.status";

  const away = d.status === "absent" || d.status === "leave";
  const inText = d.checkIn.trim();
  const outText = d.checkOut.trim();
  const inM = toMinutes(inText);
  const outM = toMinutes(outText);
  if (away) {
    if (inText || outText) e.times = "hr.error.noTimesWhenAway";
  } else if (inM === null) {
    e.times = "hr.error.checkInRequired";
  } else if (outText && outM === null) {
    e.times = "hr.error.time";
  } else if (outM !== null && outM <= inM) {
    e.times = "hr.error.checkOutBeforeIn";
  }
  const note = trimOrNull(d.note, 500);
  if (note.tooLong) e.note = "hr.error.tooLong";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    values: {
      workDate: date,
      status: d.status,
      checkIn: away ? null : inText,
      checkOut: away || !outText ? null : outText,
      note: note.value,
    },
  };
}

/** Minutes between two "HH:MM" times, or null. Mirrors the generated `worked_minutes`. */
export function workedMinutes(checkIn: string | null, checkOut: string | null): number | null {
  const a = toMinutes(checkIn);
  const b = toMinutes(checkOut);
  return a !== null && b !== null && b > a ? b - a : null;
}

/* ------------------------------------------------------------------ leave */

export interface LeaveDraft {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  note: string;
}

export interface LeaveValues {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  note: string | null;
}

export type LeaveField = "leaveType" | "dates" | "note";

export function validateLeaveDraft(d: LeaveDraft): Validation<LeaveValues, LeaveField> {
  const e: Errors<LeaveField> = {};
  if (!(LEAVE_TYPES as readonly string[]).includes(d.leaveType)) e.leaveType = "hr.error.leaveType";
  const start = d.startDate.trim();
  const end = d.endDate.trim();
  if (!isIsoDate(start) || !isIsoDate(end)) e.dates = "hr.error.date";
  else if (end < start) e.dates = "hr.error.endBeforeStart";
  const note = trimOrNull(d.note, 500);
  if (note.tooLong) e.note = "hr.error.tooLong";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    values: { leaveType: d.leaveType, startDate: start, endDate: end, note: note.value },
  };
}

/** Which statuses a leave may move to: decisions from pending, withdrawal of a granted leave. */
export function nextLeaveStatuses(status: LeaveStatus): readonly LeaveStatus[] {
  switch (status) {
    case "pending":
      return ["approved", "rejected", "cancelled"];
    case "approved":
      return ["cancelled"];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ timetable (derived) */

export interface TeachingSlot {
  groupId: string;
  groupName: string;
  groupStatus: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Weekly teaching minutes across the ACTIVE groups' schedule slots. */
export function weeklyTeachingMinutes(slots: readonly TeachingSlot[]): number {
  let total = 0;
  for (const s of slots) {
    if (s.groupStatus !== "active") continue;
    const a = toMinutes(s.startTime);
    const b = toMinutes(s.endTime);
    if (a !== null && b !== null && b > a) total += b - a;
  }
  return total;
}

/**
 * Active teaching slots not fully covered by one availability range on that weekday, as of
 * `onDate` (ranges whose effective window excludes `onDate` do not count). When an employee has
 * declared NO availability at all, nothing is reported -- absence of data is not a conflict.
 */
export function slotsOutsideAvailability(
  slots: readonly TeachingSlot[],
  availability: readonly AvailabilitySlot[],
  onDate: string,
): TeachingSlot[] {
  const current = availability.filter(
    (a) =>
      (a.effectiveFrom ?? "0001-01-01") <= onDate && onDate <= (a.effectiveUntil ?? "9999-12-31"),
  );
  if (current.length === 0) return [];
  return slots.filter((s) => {
    if (s.groupStatus !== "active") return false;
    const a = toMinutes(s.startTime);
    const b = toMinutes(s.endTime);
    if (a === null || b === null) return false;
    return !current.some((r) => {
      if (r.weekday !== s.weekday) return false;
      const rs = toMinutes(r.startTime);
      const re = toMinutes(r.endTime);
      return rs !== null && re !== null && rs <= a && b <= re;
    });
  });
}

/* ------------------------------------------------------------------ dashboard */

export interface HrSummaryInput {
  employees: readonly { id: string; staffType: StaffType; employmentStatus: EmploymentStatus }[];
  activeContracts: readonly { employeeId: string; endDate: string | null }[];
  approvedLeaves: readonly { employeeId: string; startDate: string; endDate: string }[];
  attendanceThisMonth: readonly {
    employeeId: string;
    workDate: string;
    status: string;
    workedMinutes: number | null;
  }[];
}

export interface HrSummary {
  activeEmployees: number;
  teachers: number;
  trainers: number;
  onLeaveToday: number;
  contractsExpiringSoon: number;
  attendanceRecordedToday: number;
  minutesWorkedThisMonth: number;
}

/**
 * The HR header, from records only -- nothing estimated.
 *
 *   activeEmployees   employment_status active or on_leave (still employed)
 *   teachers/trainers among those
 *   onLeaveToday      employed, and either marked on_leave or covered today by an approved leave
 *   contractsExpiringSoon  active contracts ending within the window (today included)
 *   attendanceRecordedToday  time records dated today
 *   minutesWorkedThisMonth   sum of worked minutes of this month's records
 */
export function summariseHr(input: HrSummaryInput, today: string): HrSummary {
  const employed = input.employees.filter(
    (e) => e.employmentStatus === "active" || e.employmentStatus === "on_leave",
  );
  const employedIds = new Set(employed.map((e) => e.id));
  const onLeave = new Set(
    employed.filter((e) => e.employmentStatus === "on_leave").map((e) => e.id),
  );
  for (const l of input.approvedLeaves) {
    if (employedIds.has(l.employeeId) && l.startDate <= today && today <= l.endDate)
      onLeave.add(l.employeeId);
  }
  const horizon = addDays(today, CONTRACT_EXPIRY_WINDOW_DAYS);
  const month = today.slice(0, 7);
  let minutes = 0;
  let recordedToday = 0;
  for (const a of input.attendanceThisMonth) {
    if (a.workDate.slice(0, 7) !== month) continue;
    if (a.workDate === today) recordedToday += 1;
    const m = Number(a.workedMinutes);
    if (Number.isFinite(m) && m > 0) minutes += m;
  }
  return {
    activeEmployees: employed.length,
    teachers: employed.filter((e) => e.staffType === "teacher").length,
    trainers: employed.filter((e) => e.staffType === "trainer").length,
    onLeaveToday: onLeave.size,
    contractsExpiringSoon: input.activeContracts.filter(
      (c) => c.endDate !== null && c.endDate >= today && c.endDate <= horizon,
    ).length,
    attendanceRecordedToday: recordedToday,
    minutesWorkedThisMonth: minutes,
  };
}

/** "7h30" style duration from minutes (locale-neutral digits). */
export function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Supabase's error code, when present (23505 duplicate, 23514 rule, 23503 in use). */
export function errorCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}
