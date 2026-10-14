/**
 * Group rules the forms check before a request is sent. PURE (no runtime imports), so
 * `node --test` can load it.
 *
 * Every rule here is also a database rule (one slot per weekday, stream required for a level
 * that has streams, term window order); the forms use it to point the administrator at the field
 * that needs attention instead of losing a save. Shared by the group dialog and the
 * "formation + first group" form so the two can never disagree.
 */

export interface GroupDraftForValidation {
  name: string;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  streamId?: string | null | undefined;
  schedules: readonly { weekday: number }[];
}

/**
 * The first problem with a group draft, as an i18n key, or `null` when it can be saved.
 * `streamRequired` is whether the group's level offers streams (`levelHasStreams`).
 */
export function validateGroupDraft(
  draft: GroupDraftForValidation,
  { streamRequired }: { streamRequired: boolean },
): string | null {
  if (!draft.name.trim()) return "form.groups.nameRequired";
  if (streamRequired && !draft.streamId) return "form.groups.streamRequired";
  if (!draft.startDate) return "form.groups.startDateRequired";
  if (draft.endDate && draft.endDate < draft.startDate) return "form.groups.endBeforeStart";
  const days = draft.schedules.map((s) => s.weekday);
  if (new Set(days).size !== days.length) return "form.groups.oneSessionPerDay";
  return null;
}

/** Places still open in a group: never negative, even if a group was over-filled by hand. */
export function placesLeft(group: { maxStudents: number; enrolled: number }): number {
  return Math.max(0, (Number(group.maxStudents) || 0) - (Number(group.enrolled) || 0));
}
