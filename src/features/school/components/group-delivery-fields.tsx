/**
 * How ONE group delivers its formation: teacher, stream, status, places, term and weekly slots
 * (with their room).
 *
 * Shared by the group dialog and the "new formation + first group" form, so both offer the same
 * fields with the same rules. Identity (name, formation, subject, level) is decided by the
 * caller and passed in: the teacher list depends on the subject, and the stream on the level.
 *
 * Every rule mirrors a database rule: teacher qualification (`validate_teacher_qualification`),
 * a stream for a level that has streams, one slot per weekday (`group_schedules_one_per_day`).
 */

import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTeachers, type GroupInput } from "@/features/school/queries";
import { useRooms } from "@/features/operations/queries";
import { weekdayLabel } from "@/features/school/schedule";
import { streamName, useStreamOptions } from "@/features/school/streams";
import { type EntityStatus } from "@/features/school/types";
import { useI18n } from "@/hooks/use-i18n";

const UNASSIGNED = "none";

export type GroupDeliveryDraft = Pick<
  GroupInput,
  "teacherId" | "streamId" | "status" | "maxStudents" | "startDate" | "endDate" | "schedules"
>;

export interface GroupDeliveryFieldsProps {
  draft: GroupDeliveryDraft;
  patch: (values: Partial<GroupDeliveryDraft>) => void;
  /** The group's subject: with one, only qualified teachers are offered. */
  subjectId: string | null;
  /** The group's level: decides whether a stream is asked for. */
  levelId: string | null;
  /** The status select is hidden when a new group simply starts active. */
  showStatus?: boolean;
}

export function GroupDeliveryFields({
  draft,
  patch,
  subjectId,
  levelId,
  showStatus = true,
}: GroupDeliveryFieldsProps) {
  const { t, locale } = useI18n();
  // Managed rooms (ADR-007); a slot keeps a legacy free-text room until one is chosen.
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];
  const { data: teachers = [] } = useTeachers();
  const { levelHasStreams, forLevel } = useStreamOptions();

  // With a subject, only qualified teachers (the database enforces it). Without one -- a
  // professional formation or workshop -- no qualification applies, so any active teacher
  // may run the group, exactly as `validate_teacher_qualification` already allows.
  const qualifiedTeachers = useMemo(
    () =>
      subjectId
        ? teachers.filter((tc) => tc.subjectIds.includes(subjectId))
        : teachers.filter((tc) => tc.status === "active" || tc.id === draft.teacherId),
    [teachers, subjectId, draft.teacherId],
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="group-teacher">{t("form.groups.teacher")}</Label>
          <Select
            value={draft.teacherId ?? UNASSIGNED}
            onValueChange={(v) => patch({ teacherId: v === UNASSIGNED ? null : v })}
          >
            <SelectTrigger id="group-teacher" className="h-11 rounded-xl">
              <SelectValue placeholder={t("form.common.unassigned")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>{t("form.common.unassigned")}</SelectItem>
              {qualifiedTeachers.map((tc) => (
                <SelectItem key={tc.id} value={tc.id}>
                  {tc.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {!subjectId
              ? t("form.groups.anyTeacherWithoutSubject")
              : qualifiedTeachers.length === 0
                ? t("form.groups.noQualifiedTeacher")
                : t("form.groups.qualifiedOnly")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="group-max">{t("form.groups.maxStudents")}</Label>
          <Input
            id="group-max"
            type="number"
            min={1}
            className="h-11 rounded-xl"
            value={draft.maxStudents ?? 20}
            onChange={(e) => patch({ maxStudents: Number(e.target.value) || 0 })}
          />
        </div>

        {/* Rendered only when the level actually offers streams. `levelHasStreams` is the
            single source of truth for that question; no stream logic is restated here. */}
        {levelHasStreams(levelId) && (
          <div className="space-y-2">
            <Label htmlFor="group-stream">{t("form.groups.stream")}</Label>
            <Select value={draft.streamId ?? ""} onValueChange={(v) => patch({ streamId: v })}>
              <SelectTrigger id="group-stream" className="h-11 rounded-xl">
                <SelectValue placeholder={t("form.groups.streamPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {forLevel(levelId).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {streamName(s, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("form.groups.streamHint")}</p>
          </div>
        )}

        {showStatus && (
          <div className="space-y-2">
            <Label htmlFor="group-status">{t("form.groups.status")}</Label>
            <Select
              value={draft.status ?? "active"}
              onValueChange={(v) => patch({ status: v as EntityStatus })}
            >
              <SelectTrigger id="group-status" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("form.common.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("form.common.statusInactive")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/*
          MONTHLY TARIFF -- HIDDEN, NOT REMOVED.

          `priceDzd` is still seeded in the create draft, read out of the group when the
          dialog opens for an edit, and sent in the save payload. Dropping it from the payload
          would silently reset every existing group's tariff on the next edit. It is legacy
          (ADR-004 section 9) until the finance model replaces it.
        */}

        {/* Term window. The weekly slots below repeat between these two dates -- occurrences
            are derived from the pair, never stored. */}
        <div className="space-y-2">
          <Label htmlFor="group-start-date">{t("form.groups.startDate")}</Label>
          <Input
            id="group-start-date"
            type="date"
            className="h-11 rounded-xl"
            value={draft.startDate ?? ""}
            onChange={(e) => patch({ startDate: e.target.value || null })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="group-end-date">
            {t("form.groups.endDate")}{" "}
            <span className="font-normal text-muted-foreground">{t("onboarding.optional")}</span>
          </Label>
          <Input
            id="group-end-date"
            type="date"
            className="h-11 rounded-xl"
            min={draft.startDate ?? undefined}
            value={draft.endDate ?? ""}
            onChange={(e) => patch({ endDate: e.target.value || null })}
          />
          <p className="text-xs text-muted-foreground">{t("form.groups.datesHint")}</p>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <Label>{t("form.groups.schedule")}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            // Every weekday taken means no valid slot can be added: one group meets at most
            // once a day.
            disabled={draft.schedules.length >= 7}
            onClick={() => {
              const used = new Set(draft.schedules.map((s) => s.weekday));
              const free = [0, 1, 2, 3, 4, 5, 6].find((d) => !used.has(d));
              if (free === undefined) return;
              patch({
                schedules: [
                  ...draft.schedules,
                  { weekday: free, startTime: "16:00", endTime: "17:30", room: null, roomId: null },
                ],
              });
            }}
          >
            <Plus className="size-3.5" aria-hidden /> {t("form.groups.addSlot")}
          </Button>
        </div>

        {draft.schedules.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("form.groups.noSlot")}</p>
        ) : (
          <ul className="space-y-2">
            {draft.schedules.map((slot, index) => (
              <li
                key={index}
                className="grid gap-2 rounded-lg bg-muted/50 p-2 sm:grid-cols-[1fr_auto_auto_1fr_auto] sm:items-center"
              >
                <Select
                  value={String(slot.weekday)}
                  onValueChange={(v) =>
                    patch({
                      schedules: draft.schedules.map((s, i) =>
                        i === index ? { ...s, weekday: Number(v) } : s,
                      ),
                    })
                  }
                >
                  <SelectTrigger className="h-9 rounded-lg" aria-label={t("form.groups.schedule")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* A group meets at most once a day, so a weekday already used by another
                        slot is not selectable. The database enforces this too. */}
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <SelectItem
                        key={d}
                        value={String(d)}
                        disabled={draft.schedules.some((s, i) => i !== index && s.weekday === d)}
                      >
                        {weekdayLabel(d, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="time"
                  className="h-9 rounded-lg"
                  aria-label={t("form.groups.start")}
                  value={slot.startTime}
                  onChange={(e) =>
                    patch({
                      schedules: draft.schedules.map((s, i) =>
                        i === index ? { ...s, startTime: e.target.value } : s,
                      ),
                    })
                  }
                />
                <Input
                  type="time"
                  className="h-9 rounded-lg"
                  aria-label={t("form.groups.end")}
                  value={slot.endTime}
                  onChange={(e) =>
                    patch({
                      schedules: draft.schedules.map((s, i) =>
                        i === index ? { ...s, endTime: e.target.value } : s,
                      ),
                    })
                  }
                />
                <Select
                  value={slot.roomId ?? (slot.room ? "legacy" : "none")}
                  onValueChange={(v) => {
                    if (!v || v === "legacy") return;
                    const room = rooms.find((r) => r.id === v) ?? null;
                    patch({
                      schedules: draft.schedules.map((s, i) =>
                        i === index
                          ? { ...s, roomId: room?.id ?? null, room: room?.name ?? null }
                          : s,
                      ),
                    });
                  }}
                >
                  <SelectTrigger
                    className="h-9 rounded-lg"
                    aria-label={t("form.groups.room")}
                    data-testid="slot-room"
                  >
                    <SelectValue placeholder={t("form.groups.room")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("rooms.none")}</SelectItem>
                    {!slot.roomId && slot.room && (
                      <SelectItem value="legacy">
                        {t("rooms.legacy", { name: slot.room })}
                      </SelectItem>
                    )}
                    {rooms
                      .filter((r) => r.active || r.id === slot.roomId)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.capacity
                            ? `${r.name} · ${t("rooms.places", { count: r.capacity })}`
                            : r.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-lg text-destructive"
                  aria-label={t("form.groups.removeSlot")}
                  onClick={() =>
                    patch({ schedules: draft.schedules.filter((_, i) => i !== index) })
                  }
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
