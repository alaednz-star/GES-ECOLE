/**
 * Starting points for the group form (`components/group-form-dialog.tsx`): a blank group, or an
 * existing one opened for editing. Kept out of the component file so it exports components only.
 */

import type { GroupInput } from "./queries";
import type { GroupRow } from "./types";
import { todayIso } from "@/lib/format";

export function emptyGroupDraft(): GroupInput {
  return {
    name: "",
    subjectId: null,
    teacherId: null,
    levelId: null,
    streamId: null,
    programId: null,
    // New groups start today; the admin narrows it if needed.
    startDate: todayIso(),
    endDate: null,
    maxStudents: 20,
    priceDzd: 0,
    status: "active",
    schedules: [],
  };
}

export function groupToDraft(group: GroupRow): GroupInput {
  return {
    id: group.id,
    name: group.name,
    subjectId: group.subjectId,
    teacherId: group.teacherId,
    levelId: group.levelId,
    streamId: group.streamId,
    // Carried through: the save sends program_id explicitly, so dropping it here would
    // silently detach the group from its programme on every edit.
    programId: group.programId,
    startDate: group.startDate,
    endDate: group.endDate,
    maxStudents: group.maxStudents,
    priceDzd: group.priceDzd,
    status: group.status,
    schedules: group.schedules.map((s) => ({
      weekday: s.weekday,
      startTime: s.startTime,
      endTime: s.endTime,
      room: s.room,
      roomId: s.roomId ?? null,
    })),
  };
}
