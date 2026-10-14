/**
 * HR data layer (20261001110100_hr_foundation.sql).
 *
 * SECURITY is RLS: every HR table is administrator-only, and HR documents live in the PRIVATE
 * `hr-documents` bucket, read through 60-second signed URLs minted with the admin's own
 * session. No service-role code is involved. The route guard is navigation.
 *
 * AUDIT is a database trigger on every HR table, so nothing here needs to remember it.
 *
 * REUSED, NOT DUPLICATED: the person (name, email, phone, photo) is `profiles`; the teaching
 * assignments are `groups` + `group_schedules` (+ `programs`); the account lifecycle is the
 * existing teacher/admin lifecycle. HR reads those, and writes only HR tables.
 *
 * Errors are thrown as the Supabase error object so `lib/errors.ts` can classify by code.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  AvailabilitySlot,
  ContractStatus,
  ContractType,
  ContractValues,
  DocumentCategory,
  EmployeeValues,
  EmploymentStatus,
  LeaveStatus,
  LeaveType,
  LeaveValues,
  StaffAttendanceStatus,
  StaffAttendanceValues,
  StaffType,
  TeachingSlot,
  WorkingTime,
} from "./hr-model";

export const HR_BUCKET = "hr-documents";

export const hrKeys = {
  root: ["hr"] as const,
  employees: () => ["hr", "employees"] as const,
  candidates: () => ["hr", "candidates"] as const,
  overview: (today: string) => ["hr", "overview", today] as const,
  employee: (id: string) => ["hr", "employee", id] as const,
  attendance: (id: string, from: string, to: string) => ["hr", "attendance", id, from, to] as const,
  teaching: (profileId: string) => ["hr", "teaching", profileId] as const,
  activity: (profileId: string) => ["hr", "activity", profileId] as const,
};

/* ------------------------------------------------------------------ types */

export interface EmployeeListRow {
  id: string;
  profileId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  staffType: StaffType;
  employmentStatus: EmploymentStatus;
  position: string | null;
  department: string | null;
  employeeCode: string | null;
  startDate: string;
  endDate: string | null;
  activeContract: {
    contractType: ContractType;
    workingTime: WorkingTime | null;
    endDate: string | null;
  } | null;
}

export interface ContractRow {
  id: string;
  contractType: ContractType;
  workingTime: WorkingTime | null;
  startDate: string;
  endDate: string | null;
  status: ContractStatus;
  notes: string | null;
  createdAt: string;
}

export interface AvailabilityRow extends AvailabilitySlot {
  id: string;
  note: string | null;
}

export interface LeaveRow {
  id: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  note: string | null;
  decidedAt: string | null;
}

export interface DocumentRow {
  id: string;
  category: DocumentCategory;
  title: string;
  storagePath: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  contractId: string | null;
  createdAt: string;
}

export interface EmployeeDetail extends EmployeeListRow {
  address: string | null;
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  roles: string[];
  teacherStatus: string | null;
  contracts: ContractRow[];
  availability: AvailabilityRow[];
  leaves: LeaveRow[];
  documents: DocumentRow[];
}

export interface StaffAttendanceRow {
  id: string;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
  status: StaffAttendanceStatus;
  note: string | null;
  workedMinutes: number | null;
}

/* ------------------------------------------------------------------ reads */

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

interface RawEmployee {
  id: string;
  profile_id: string;
  staff_type: string;
  employment_status: string;
  position: string | null;
  department: string | null;
  employee_code: string | null;
  start_date: string;
  end_date: string | null;
  profile: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
  employee_contracts: {
    contract_type: string;
    working_time: string | null;
    end_date: string | null;
    status: string;
  }[];
}

function toListRow(
  e: Omit<RawEmployee, "employee_contracts"> & {
    employee_contracts: RawEmployee["employee_contracts"];
  },
): EmployeeListRow {
  const active = (e.employee_contracts ?? []).find((c) => c.status === "active") ?? null;
  return {
    id: e.id,
    profileId: e.profile_id,
    fullName: e.profile?.full_name || null,
    email: e.profile?.email ?? null,
    phone: e.profile?.phone ?? null,
    avatarUrl: e.profile?.avatar_url ?? null,
    staffType: e.staff_type as StaffType,
    employmentStatus: e.employment_status as EmploymentStatus,
    position: e.position,
    department: e.department,
    employeeCode: e.employee_code,
    startDate: e.start_date,
    endDate: e.end_date,
    activeContract: active
      ? {
          contractType: active.contract_type as ContractType,
          workingTime: (active.working_time as WorkingTime | null) ?? null,
          endDate: active.end_date,
        }
      : null,
  };
}

const EMPLOYEE_LIST_SELECT = `id, profile_id, staff_type, employment_status, position, department, employee_code,
  start_date, end_date,
  profile:profiles ( full_name, email, phone, avatar_url ),
  employee_contracts ( contract_type, working_time, end_date, status )`;

/** Every HR file with its person and active contract. One request. */
export function useEmployees() {
  return useQuery({
    queryKey: hrKeys.employees(),
    queryFn: async (): Promise<EmployeeListRow[]> => {
      const { data, error } = await supabase.from("employees").select(EMPLOYEE_LIST_SELECT);
      if (error) throw error;
      return ((data ?? []) as unknown as RawEmployee[])
        .map(toListRow)
        .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
    },
  });
}

export interface StaffCandidate {
  profileId: string;
  fullName: string | null;
  email: string | null;
  roles: string[];
}

/** Staff accounts (admin or teacher role) that do not have an HR file yet. */
export function useStaffCandidates(enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.candidates(),
    enabled,
    queryFn: async (): Promise<StaffCandidate[]> => {
      const [roles, files] = await Promise.all([
        supabase.from("user_roles").select("user_id, role").in("role", ["admin", "teacher"]),
        supabase.from("employees").select("profile_id"),
      ]);
      if (roles.error) throw roles.error;
      if (files.error) throw files.error;
      const taken = new Set((files.data ?? []).map((f) => f.profile_id));
      const byUser = new Map<string, string[]>();
      for (const r of roles.data ?? []) {
        if (taken.has(r.user_id)) continue;
        byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
      }
      const ids = [...byUser.keys()];
      if (ids.length === 0) return [];
      const { data: people, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      if (error) throw error;
      return (people ?? [])
        .map((p) => ({
          profileId: p.id,
          fullName: p.full_name || null,
          email: p.email,
          roles: byUser.get(p.id) ?? [],
        }))
        .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
    },
  });
}

export interface HrOverviewData {
  activeContracts: { employeeId: string; endDate: string | null }[];
  approvedLeaves: { employeeId: string; startDate: string; endDate: string }[];
  attendanceThisMonth: {
    employeeId: string;
    workDate: string;
    status: string;
    workedMinutes: number | null;
  }[];
}

/** The records behind the HR header: bounded by status, today and the current month. */
export function useHrOverview(today: string) {
  return useQuery({
    queryKey: hrKeys.overview(today),
    queryFn: async (): Promise<HrOverviewData> => {
      const monthStart = `${today.slice(0, 7)}-01`;
      const [contracts, leaves, attendance] = await Promise.all([
        supabase.from("employee_contracts").select("employee_id, end_date").eq("status", "active"),
        supabase
          .from("employee_leaves")
          .select("employee_id, start_date, end_date")
          .eq("status", "approved")
          .lte("start_date", today)
          .gte("end_date", today),
        supabase
          .from("staff_attendance")
          .select("employee_id, work_date, status, worked_minutes")
          .gte("work_date", monthStart)
          .lte("work_date", today),
      ]);
      if (contracts.error) throw contracts.error;
      if (leaves.error) throw leaves.error;
      if (attendance.error) throw attendance.error;
      return {
        activeContracts: (contracts.data ?? []).map((c) => ({
          employeeId: c.employee_id,
          endDate: c.end_date,
        })),
        approvedLeaves: (leaves.data ?? []).map((l) => ({
          employeeId: l.employee_id,
          startDate: l.start_date,
          endDate: l.end_date,
        })),
        attendanceThisMonth: (attendance.data ?? []).map((a) => ({
          employeeId: a.employee_id,
          workDate: a.work_date,
          status: a.status,
          workedMinutes: a.worked_minutes,
        })),
      };
    },
  });
}

/** One HR file with everything that hangs off it (except time records, which are windowed). */
export function useEmployee(id: string) {
  return useQuery({
    queryKey: hrKeys.employee(id),
    queryFn: async (): Promise<EmployeeDetail | null> => {
      const { data, error } = await supabase
        .from("employees")
        .select(
          `*, profile:profiles ( full_name, email, phone, avatar_url ),
           employee_contracts ( id, contract_type, working_time, start_date, end_date, status, notes, created_at ),
           employee_availability ( id, weekday, start_time, end_time, effective_from, effective_until, note ),
           employee_leaves ( id, leave_type, start_date, end_date, status, note, decided_at ),
           employee_documents ( id, category, title, storage_path, file_name, mime_type, size_bytes, contract_id, created_at )`,
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const raw = data as unknown as Omit<RawEmployee, "employee_contracts"> & {
        address: string | null;
        date_of_birth: string | null;
        emergency_contact_name: string | null;
        emergency_contact_phone: string | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
        employee_contracts: {
          id: string;
          contract_type: string;
          working_time: string | null;
          start_date: string;
          end_date: string | null;
          status: string;
          notes: string | null;
          created_at: string;
        }[];
        employee_availability: {
          id: string;
          weekday: number;
          start_time: string;
          end_time: string;
          effective_from: string | null;
          effective_until: string | null;
          note: string | null;
        }[];
        employee_leaves: {
          id: string;
          leave_type: string;
          start_date: string;
          end_date: string;
          status: string;
          note: string | null;
          decided_at: string | null;
        }[];
        employee_documents: {
          id: string;
          category: string;
          title: string;
          storage_path: string;
          file_name: string | null;
          mime_type: string | null;
          size_bytes: number | null;
          contract_id: string | null;
          created_at: string;
        }[];
      };

      const [roles, teacher] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", raw.profile_id),
        supabase.from("teachers").select("status").eq("id", raw.profile_id).maybeSingle(),
      ]);
      if (roles.error) throw roles.error;
      if (teacher.error) throw teacher.error;

      return {
        ...toListRow(raw),
        address: raw.address,
        dateOfBirth: raw.date_of_birth,
        emergencyContactName: raw.emergency_contact_name,
        emergencyContactPhone: raw.emergency_contact_phone,
        notes: raw.notes,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
        roles: (roles.data ?? []).map((r) => r.role),
        teacherStatus: teacher.data?.status ?? null,
        contracts: raw.employee_contracts
          .map((c) => ({
            id: c.id,
            contractType: c.contract_type as ContractType,
            workingTime: (c.working_time as WorkingTime | null) ?? null,
            startDate: c.start_date,
            endDate: c.end_date,
            status: c.status as ContractStatus,
            notes: c.notes,
            createdAt: c.created_at,
          }))
          .sort((a, b) => b.startDate.localeCompare(a.startDate)),
        availability: raw.employee_availability
          .map((a) => ({
            id: a.id,
            weekday: a.weekday,
            startTime: hhmm(a.start_time) as string,
            endTime: hhmm(a.end_time) as string,
            effectiveFrom: a.effective_from,
            effectiveUntil: a.effective_until,
            note: a.note,
          }))
          .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
        leaves: raw.employee_leaves
          .map((l) => ({
            id: l.id,
            leaveType: l.leave_type as LeaveType,
            startDate: l.start_date,
            endDate: l.end_date,
            status: l.status as LeaveStatus,
            note: l.note,
            decidedAt: l.decided_at,
          }))
          .sort((a, b) => b.startDate.localeCompare(a.startDate)),
        documents: raw.employee_documents
          .map((d) => ({
            id: d.id,
            category: d.category as DocumentCategory,
            title: d.title,
            storagePath: d.storage_path,
            fileName: d.file_name,
            mimeType: d.mime_type,
            sizeBytes: d.size_bytes,
            contractId: d.contract_id,
            createdAt: d.created_at,
          }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    },
  });
}

/** Time records of one employee in a date window (both ends in the key). */
export function useStaffAttendance(employeeId: string, from: string, to: string) {
  return useQuery({
    queryKey: hrKeys.attendance(employeeId, from, to),
    queryFn: async (): Promise<StaffAttendanceRow[]> => {
      const { data, error } = await supabase
        .from("staff_attendance")
        .select("id, work_date, check_in, check_out, status, note, worked_minutes")
        .eq("employee_id", employeeId)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        workDate: a.work_date,
        checkIn: hhmm(a.check_in),
        checkOut: hhmm(a.check_out),
        status: a.status as StaffAttendanceStatus,
        note: a.note,
        workedMinutes: a.worked_minutes,
      }));
    },
  });
}

export interface TeachingAssignment {
  groupId: string;
  groupName: string;
  groupStatus: string;
  subjectName: string | null;
  subjectKey: string | null;
  programName: string | null;
  slots: TeachingSlot[];
}

/**
 * What the timetable says this person teaches -- read from groups/group_schedules, never
 * copied into HR. Empty for staff who teach nothing.
 */
export function useTeachingAssignments(profileId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.teaching(profileId ?? "none"),
    enabled: !!profileId,
    queryFn: async (): Promise<TeachingAssignment[]> => {
      const { data, error } = await supabase
        .from("groups")
        .select(
          "id, name, status, subjects(key, name), programs(name), group_schedules(weekday, start_time, end_time)",
        )
        .eq("teacher_id", profileId as string)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((g) => ({
        groupId: g.id,
        groupName: g.name,
        groupStatus: g.status,
        subjectName: g.subjects?.name ?? null,
        subjectKey: g.subjects?.key ?? null,
        programName: g.programs?.name ?? null,
        slots: (g.group_schedules ?? [])
          .map((s) => ({
            groupId: g.id,
            groupName: g.name,
            groupStatus: g.status,
            weekday: s.weekday,
            startTime: s.start_time.slice(0, 5),
            endTime: s.end_time.slice(0, 5),
          }))
          .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
      }));
    },
  });
}

export interface ActivityRow {
  id: string;
  action: string;
  actorEmail: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** The existing audit trail for this person (HR and account events), newest first. */
export function useEmployeeActivity(profileId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.activity(profileId ?? "none"),
    enabled: !!profileId,
    queryFn: async (): Promise<ActivityRow[]> => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, action, actor_email, details, created_at")
        .eq("target_id", profileId as string)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        action: a.action,
        actorEmail: a.actor_email,
        details: (a.details ?? {}) as Record<string, unknown>,
        createdAt: a.created_at,
      }));
    },
  });
}

/* ------------------------------------------------------------------ writes */

function useHrMutation<I, O = void>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.root }),
  });
}

function mustTouch(data: unknown[] | null) {
  if (!data || data.length === 0) throw { code: "PGRST116", message: "Record not found" };
}

function employeeRow(v: EmployeeValues) {
  return {
    staff_type: v.staffType,
    employment_status: v.employmentStatus,
    position: v.position,
    department: v.department,
    employee_code: v.employeeCode,
    start_date: v.startDate,
    end_date: v.endDate,
    address: v.address,
    date_of_birth: v.dateOfBirth,
    emergency_contact_name: v.emergencyContactName,
    emergency_contact_phone: v.emergencyContactPhone,
    notes: v.notes,
  };
}

export function useCreateEmployee() {
  return useHrMutation(async (input: EmployeeValues & { profileId: string }) => {
    const { data, error } = await supabase
      .from("employees")
      .insert({ profile_id: input.profileId, ...employeeRow(input) })
      .select("id");
    if (error) throw error;
    return (data?.[0]?.id as string | undefined) ?? null;
  });
}

export function useUpdateEmployee() {
  return useHrMutation(async (input: EmployeeValues & { id: string }) => {
    const { data, error } = await supabase
      .from("employees")
      .update(employeeRow(input))
      .eq("id", input.id)
      .select("id");
    if (error) throw error;
    mustTouch(data);
  });
}

export function useSaveContract() {
  return useHrMutation(async (input: ContractValues & { employeeId: string; id?: string }) => {
    const row = {
      contract_type: input.contractType,
      working_time: input.workingTime,
      start_date: input.startDate,
      end_date: input.endDate,
      status: input.status,
      notes: input.notes,
    };
    const res = input.id
      ? await supabase.from("employee_contracts").update(row).eq("id", input.id).select("id")
      : await supabase
          .from("employee_contracts")
          .insert({ employee_id: input.employeeId, ...row })
          .select("id");
    if (res.error) throw res.error;
    mustTouch(res.data);
  });
}

export function useSaveAvailability() {
  return useHrMutation(
    async (input: AvailabilitySlot & { employeeId: string; note: string | null }) => {
      const row = {
        weekday: input.weekday,
        start_time: input.startTime,
        end_time: input.endTime,
        effective_from: input.effectiveFrom,
        effective_until: input.effectiveUntil,
        note: input.note,
      };
      const res = input.id
        ? await supabase.from("employee_availability").update(row).eq("id", input.id).select("id")
        : await supabase
            .from("employee_availability")
            .insert({ employee_id: input.employeeId, ...row })
            .select("id");
      if (res.error) throw res.error;
      mustTouch(res.data);
    },
  );
}

export function useDeleteAvailability() {
  return useHrMutation(async (id: string) => {
    const { data, error } = await supabase
      .from("employee_availability")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustTouch(data);
  });
}

export function useSaveStaffAttendance() {
  return useHrMutation(
    async (input: StaffAttendanceValues & { employeeId: string; id?: string }) => {
      const row = {
        work_date: input.workDate,
        status: input.status,
        check_in: input.checkIn,
        check_out: input.checkOut,
        note: input.note,
      };
      const res = input.id
        ? await supabase.from("staff_attendance").update(row).eq("id", input.id).select("id")
        : await supabase
            .from("staff_attendance")
            .insert({ employee_id: input.employeeId, ...row })
            .select("id");
      if (res.error) throw res.error;
      mustTouch(res.data);
    },
  );
}

export function useDeleteStaffAttendance() {
  return useHrMutation(async (id: string) => {
    const { data, error } = await supabase
      .from("staff_attendance")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustTouch(data);
  });
}

export function useCreateLeave() {
  return useHrMutation(async (input: LeaveValues & { employeeId: string }) => {
    const { data, error } = await supabase
      .from("employee_leaves")
      .insert({
        employee_id: input.employeeId,
        leave_type: input.leaveType,
        start_date: input.startDate,
        end_date: input.endDate,
        note: input.note,
      })
      .select("id");
    if (error) throw error;
    mustTouch(data);
  });
}

/** Records a decision (approve / reject / cancel) with who decided and when. */
export function useSetLeaveStatus() {
  return useHrMutation(
    async (input: { id: string; status: LeaveStatus; actorId: string | null }) => {
      const { data, error } = await supabase
        .from("employee_leaves")
        .update({
          status: input.status,
          decided_by: input.actorId,
          decided_at: new Date().toISOString(),
        })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      mustTouch(data);
    },
  );
}

function safeName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .slice(-120) || "document"
  );
}

/**
 * Uploads to the private bucket, then records the metadata. If the record is refused, the
 * uploaded object is removed so no file is left without an entry.
 */
export function useUploadDocument() {
  return useHrMutation(
    async (input: {
      employeeId: string;
      file: File;
      category: DocumentCategory;
      title: string;
      contractId: string | null;
    }) => {
      const path = `${input.employeeId}/${crypto.randomUUID()}-${safeName(input.file.name)}`;
      const up = await supabase.storage
        .from(HR_BUCKET)
        .upload(path, input.file, { contentType: input.file.type, upsert: false });
      if (up.error) throw up.error;
      const { error } = await supabase.from("employee_documents").insert({
        employee_id: input.employeeId,
        category: input.category,
        title: input.title,
        storage_path: path,
        file_name: input.file.name.slice(0, 200),
        mime_type: input.file.type || null,
        size_bytes: input.file.size,
        contract_id: input.contractId,
      });
      if (error) {
        await supabase.storage.from(HR_BUCKET).remove([path]);
        throw error;
      }
    },
  );
}

/** Deletes the record (audited), then the object. */
export function useDeleteDocument() {
  return useHrMutation(async (doc: { id: string; storagePath: string }) => {
    const { data, error } = await supabase
      .from("employee_documents")
      .delete()
      .eq("id", doc.id)
      .select("id");
    if (error) throw error;
    mustTouch(data);
    await supabase.storage.from(HR_BUCKET).remove([doc.storagePath]);
  });
}

/** A 60-second link to a private HR document, minted with the admin's own session. */
export async function signHrDocument(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(HR_BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
