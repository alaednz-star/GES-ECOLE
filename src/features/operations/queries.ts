/**
 * School operations data (ADR-007): rooms, official documents, attendance statistics.
 * Fetches and writes only; layouts and figures come from the pure models next to this file.
 *
 * SECURITY is the database's: rooms are readable by every signed-in user and written by
 * administrators (RLS); official documents are admin-read (students their own) and written only
 * through audited SECURITY DEFINER functions; the statistics view is security_invoker.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const opsKeys = {
  rooms: () => ["ops", "rooms"] as const,
  documents: () => ["ops", "documents"] as const,
  document: (id: string) => ["ops", "document", id] as const,
  attendance: () => ["ops", "attendance-monthly"] as const,
};

/* ------------------------------------------------------------------ rooms */

export interface Room {
  id: string;
  name: string;
  capacity: number | null;
  location: string | null;
  equipment: string | null;
  active: boolean;
}

export function useRooms() {
  return useQuery({
    queryKey: opsKeys.rooms(),
    queryFn: async (): Promise<Room[]> => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, name, capacity, location, equipment, status")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        capacity: r.capacity,
        location: r.location,
        equipment: r.equipment,
        active: r.status === "active",
      }));
    },
  });
}

export interface RoomValues {
  name: string;
  capacity: number | null;
  location: string | null;
  equipment: string | null;
  active: boolean;
}

export function useSaveRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RoomValues & { id?: string }) => {
      const row = {
        name: input.name,
        capacity: input.capacity,
        location: input.location,
        equipment: input.equipment,
        status: input.active ? "active" : "inactive",
      };
      const { data, error } = input.id
        ? await supabase.from("rooms").update(row).eq("id", input.id).select("id")
        : await supabase.from("rooms").insert(row).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "42501", message: "Not allowed" };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: opsKeys.rooms() });
      // A rename shows on every slot of the room.
      void qc.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("rooms").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "PGRST116", message: "Room not found" };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: opsKeys.rooms() });
      void qc.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

/* ------------------------------------------------------------------ official documents */

export type DocumentKind = "enrollment" | "attendance" | "payment";

export interface OfficialDocument {
  id: string;
  number: string;
  kind: DocumentKind;
  registrationId: string | null;
  studentId: string | null;
  studentName: string | null;
  snapshot: Record<string, unknown>;
  issuer: Record<string, string | null | undefined>;
  status: "issued" | "voided";
  issuedAt: string;
  voidReason: string | null;
}

const DOC_SELECT =
  "id, number, kind, registration_id, student_id, student_name, snapshot, issuer, status, issued_at, void_reason";

type RawDoc = {
  id: string;
  number: string;
  kind: string;
  registration_id: string | null;
  student_id: string | null;
  student_name: string | null;
  snapshot: unknown;
  issuer: unknown;
  status: string;
  issued_at: string;
  void_reason: string | null;
};

function toDoc(d: RawDoc): OfficialDocument {
  return {
    id: d.id,
    number: d.number,
    kind: d.kind as DocumentKind,
    registrationId: d.registration_id,
    studentId: d.student_id,
    studentName: d.student_name,
    snapshot: (d.snapshot ?? {}) as Record<string, unknown>,
    issuer: (d.issuer ?? {}) as Record<string, string | null | undefined>,
    status: d.status as OfficialDocument["status"],
    issuedAt: d.issued_at,
    voidReason: d.void_reason,
  };
}

export function useOfficialDocuments() {
  return useQuery({
    queryKey: opsKeys.documents(),
    queryFn: async (): Promise<OfficialDocument[]> => {
      const out: OfficialDocument[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("official_documents")
          .select(DOC_SELECT)
          .order("issued_at", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        out.push(...((data ?? []) as RawDoc[]).map(toDoc));
        if ((data ?? []).length < 1000) return out;
      }
    },
  });
}

export function useOfficialDocument(id: string) {
  return useQuery({
    queryKey: opsKeys.document(id),
    queryFn: async (): Promise<OfficialDocument | null> => {
      const { data, error } = await supabase
        .from("official_documents")
        .select(DOC_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toDoc(data as RawDoc) : null;
    },
  });
}

export function useIssueOfficialDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: DocumentKind; registrationId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("issue_official_document", {
        p_kind: input.kind,
        p_registration: input.registrationId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: opsKeys.documents() }),
  });
}

export function useVoidOfficialDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("void_official_document", {
        p_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: opsKeys.documents() }),
  });
}

/* ------------------------------------------------------------------ statistics */

export interface AttendanceMonth {
  month: string;
  groupId: string;
  present: number;
  late: number;
  excused: number;
  absent: number;
  total: number;
}

export function useAttendanceMonthly() {
  return useQuery({
    queryKey: opsKeys.attendance(),
    queryFn: async (): Promise<AttendanceMonth[]> => {
      const out: AttendanceMonth[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("attendance_monthly_stats")
          .select("*")
          .order("month")
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data ?? []) {
          if (!r.month || !r.group_id) continue;
          out.push({
            month: r.month,
            groupId: r.group_id,
            present: r.present ?? 0,
            late: r.late ?? 0,
            excused: r.excused ?? 0,
            absent: r.absent ?? 0,
            total: r.total ?? 0,
          });
        }
        if ((data ?? []).length < 1000) return out;
      }
    },
  });
}
