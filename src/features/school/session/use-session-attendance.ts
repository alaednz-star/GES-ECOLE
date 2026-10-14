/**
 * Roster + save for ONE session. Loaded only when the drawer opens.
 *
 * The calendar itself never touches this: it reads counts from
 * `session_attendance_summary`. Student rows are fetched for a single
 * (group, date) pair, which is what keeps a month view cheap.
 *
 * SAVE STRATEGY -- deliberately unchanged.
 *
 * This uses the same write as `useSaveAttendance` (`saveAttendanceEntries`),
 * and the drawer sends only the entries the user actually CHANGED. That is not an optimisation; it is the fix for audit
 * finding P1-3. Two people with the same register open merge their edits instead
 * of the second save stamping the whole roster over the first. The drawer shows
 * the complete state of the session, and Save persists the user's changes -- the
 * "complete state" contract lives in the UI, not in the payload.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { saveAttendanceEntries, schoolKeys } from "../queries";
import { OFFLINE_MUTATIONS } from "@/features/desktop/offline-model";
import type { AttendanceStatus } from "../types";
import { sessionKeys } from "./keys";
import { sessionKey } from "./session-key";
import type { AttendanceRollup } from "./types";

export interface RosterEntry {
  studentId: string;
  fullName: string;
  avatarUrl: string | null;
  /** Saved status, or null when this student has not been marked. */
  status: AttendanceStatus | null;
}

/**
 * The enrolled students of a group plus any attendance already recorded for the
 * date. Mirrors the existing `useAttendance` query so both pages agree, and
 * reuses its cache key so the drawer and the legacy page share one entry.
 */
export function useSessionRoster(groupId: string | null, date: string | null) {
  return useQuery({
    queryKey: schoolKeys.attendance(groupId ?? "none", date ?? "none"),
    enabled: !!groupId && !!date,
    queryFn: async (): Promise<RosterEntry[]> => {
      const [roster, marks] = await Promise.all([
        supabase
          .from("registrations")
          .select("student_id, profiles:students(id, profiles(full_name, avatar_url))")
          .eq("group_id", groupId as string)
          .eq("status", "approved"),
        supabase
          .from("attendance")
          .select("student_id, status")
          .eq("group_id", groupId as string)
          .eq("session_date", date as string),
      ]);
      if (roster.error) throw new Error(roster.error.message);
      if (marks.error) throw new Error(marks.error.message);

      const marked = new Map(marks.data.map((m) => [m.student_id, m.status as AttendanceStatus]));
      return (roster.data ?? []).map((r) => ({
        studentId: r.student_id,
        fullName: r.profiles?.profiles?.full_name ?? "—",
        avatarUrl: r.profiles?.profiles?.avatar_url ?? null,
        status: marked.get(r.student_id) ?? null,
      }));
    },
  });
}

export interface SaveSessionInput {
  groupId: string;
  date: string;
  markedBy: string;
  /** Only the students whose status the user changed. */
  entries: { studentId: string; status: AttendanceStatus }[];
  /** Window whose summary cache should be patched, so the card updates in place. */
  window: { from: string; to: string };
  /** Roster size, for recomputing the rollup optimistically. */
  enrolled: number;
  /** The full intended state, used to derive the optimistic per-status counts. */
  finalMarks: Record<string, AttendanceStatus>;
}

/**
 * Saves a register and patches the calendar's summary cache in place.
 *
 * The optimistic update is what makes a card's status change the moment Save is
 * pressed, without a refetch or a reload. On failure the previous cache snapshot
 * is restored -- the audit noted that no optimistic update existed before, so
 * introducing one means introducing its rollback in the same change.
 */
export function useSaveSessionAttendance() {
  const qc = useQueryClient();

  return useMutation({
    // Keyed so the desktop app can queue it offline and replay it after a restart (ADR-010).
    mutationKey: OFFLINE_MUTATIONS.sessionAttendance,
    // The same diff-based upsert `useSaveAttendance` performs (`saveAttendanceEntries`), called
    // directly rather than through a nested mutation, which would pause twice offline. The
    // invalidation lives in onSettled below.
    mutationFn: (input: SaveSessionInput) =>
      saveAttendanceEntries({
        groupId: input.groupId,
        date: input.date,
        markedBy: input.markedBy,
        entries: input.entries,
      }),

    onMutate: async (input) => {
      const key = sessionKeys.summaries(input.window.from, input.window.to);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Map<string, AttendanceRollup>>(key);

      // Recompute the rollup from the intended final state rather than nudging
      // counters by a delta: the user may have changed several students at once,
      // including clearing some, and a delta would drift.
      const counts = { present: 0, absent: 0, late: 0, excused: 0 };
      let marked = 0;
      for (const status of Object.values(input.finalMarks)) {
        counts[status] += 1;
        marked += 1;
      }

      if (previous) {
        const next = new Map(previous);
        next.set(sessionKey(input.groupId, input.date), {
          marked,
          ...counts,
          lastMarkedAt: new Date().toISOString(),
        });
        qc.setQueryData(key, next);
      }

      return { key, previous };
    },

    onError: (_err, _input, context) => {
      // Put the pre-save numbers back so the card stops advertising a state the
      // database refused.
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },

    onSettled: () => {
      // Reconcile with the server either way. Invalidating the ROOT also
      // refreshes the teacher workspace, the student portal and the dashboard,
      // per the note on `attendanceRoot`.
      void qc.invalidateQueries({ queryKey: schoolKeys.attendanceRoot });
    },
  });
}
