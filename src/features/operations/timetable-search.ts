/**
 * The timetable's URL state (?view=room&id=...), shared by the page and its printable version.
 */

import type { TimetableView } from "./timetable-model";

export interface TimetableSearch {
  view?: TimetableView;
  id?: string;
}

const VIEWS: readonly TimetableView[] = ["all", "group", "teacher", "room", "level"];

export function parseTimetableSearch(raw: Record<string, unknown>): TimetableSearch {
  const out: TimetableSearch = {};
  const view = raw["view"];
  if (typeof view === "string" && (VIEWS as readonly string[]).includes(view))
    out.view = view as TimetableView;
  const id = raw["id"];
  if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) out.id = id;
  return out;
}
