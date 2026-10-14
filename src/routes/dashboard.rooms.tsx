/**
 * Salles: the institution's rooms, their capacity and their weekly use (ADR-007).
 *
 * Rooms are assigned to groups' weekly slots (group form). The database refuses two active
 * groups in the same room at overlapping times; this page shows each room's load and links to its
 * timetable. Deleting a room unlinks its slots; making it inactive keeps it in the history.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarRange, DoorOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RequireAuth } from "@/features/auth/require-auth";
import { useGroups } from "@/features/school/queries";
import { useDeleteRoom, useRooms, useSaveRoom, type Room } from "@/features/operations/queries";
import { roomWeeklyHours } from "@/features/operations/timetable-model";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/rooms")({
  head: () => ({ meta: [{ title: "Salles — Gestion École" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <RoomsPage />
    </RequireAuth>
  ),
});

function RoomsPage() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const rooms = useRooms();
  const groups = useGroups();
  const remove = useDeleteRoom();
  const [editing, setEditing] = useState<Room | "new" | null>(null);

  const load = useMemo(() => roomWeeklyHours(groups.data ?? []), [groups.data]);

  const columns: Column<Room>[] = [
    {
      key: "name",
      header: t("rooms.col.room"),
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0" data-testid="room-row" data-room={r.id}>
          <p className="truncate font-medium">{r.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[r.location, r.equipment].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "capacity",
      header: t("rooms.col.capacity"),
      className: "hidden text-end md:table-cell",
      sortValue: (r) => r.capacity ?? 0,
      cell: (r) => <span className="tabular-nums">{r.capacity ?? "—"}</span>,
    },
    {
      key: "usage",
      header: t("rooms.col.usage"),
      sortValue: (r) => load.get(r.id)?.hours ?? 0,
      cell: (r) => {
        const v = load.get(r.id);
        return (
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="room-usage">
            {v
              ? t("rooms.usage", { hours: Math.round(v.hours * 10) / 10, slots: v.slots })
              : t("rooms.unused")}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "",
      className: "hidden md:table-cell",
      cell: (r) => <StatusBadge status={r.active ? "active" : "inactive"} />,
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t("rooms.viewTimetable")}
          >
            <Link to="/dashboard/timetables" search={{ view: "room", id: r.id }}>
              <CalendarRange className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t("rooms.editTitle")}
            data-testid="room-edit"
            onClick={() => setEditing(r)}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <ConfirmDialog
            title={t("rooms.deleteTitle")}
            description={t("rooms.deleteBody", { name: r.name })}
            confirmLabel={t("rooms.delete")}
            onConfirm={async () => {
              try {
                await remove.mutateAsync(r.id);
                notifySuccess("rooms.deleted");
              } catch (e) {
                notifyError(e);
              }
            }}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-destructive"
                aria-label={t("rooms.delete")}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            }
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("rooms.title")}
        description={t("rooms.subtitle")}
        actions={
          <Button className="rounded-xl" onClick={() => setEditing("new")} data-testid="room-add">
            <Plus className="size-4" aria-hidden /> {t("rooms.add")}
          </Button>
        }
      />
      <DataTable
        rows={rooms.data ?? []}
        columns={columns}
        isLoading={rooms.isLoading || groups.isLoading}
        error={rooms.error ?? groups.error}
        onRetry={() => void rooms.refetch()}
        isRetrying={rooms.isFetching}
        rowKey={(r) => r.id}
        pageSize={50}
        searchable={(r) => [r.name, r.location, r.equipment].filter(Boolean).join(" ")}
        emptyState={
          <EmptyState
            icon={DoorOpen}
            title={t("rooms.emptyTitle")}
            description={t("rooms.emptyBody")}
          />
        }
      />
      {editing && (
        <RoomDialog room={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function RoomDialog({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveRoom();
  const [form, setForm] = useState({
    name: room?.name ?? "",
    capacity: room?.capacity ? String(room.capacity) : "",
    location: room?.location ?? "",
    equipment: room?.equipment ?? "",
    active: room?.active ?? true,
  });
  const [submitted, setSubmitted] = useState(false);
  const name = form.name.trim();
  const capacity = form.capacity.trim() === "" ? null : Number(form.capacity.trim());
  const nameError = name.length < 1 || name.length > 60 ? "rooms.error.name" : null;
  const capacityError =
    capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000)
      ? "rooms.error.capacity"
      : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(room ? "rooms.editTitle" : "rooms.addTitle")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (nameError || capacityError) return;
            save.mutate(
              {
                ...(room ? { id: room.id } : {}),
                name,
                capacity,
                location: form.location.trim() || null,
                equipment: form.equipment.trim() || null,
                active: form.active,
              },
              {
                onSuccess: () => {
                  notifySuccess("rooms.saved");
                  onClose();
                },
                onError: notifyError,
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="room-name">{t("rooms.name")}</Label>
            <Input
              id="room-name"
              className="h-11 rounded-xl"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {submitted && nameError && <p className="text-xs text-destructive">{t(nameError)}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-capacity">{t("rooms.capacity")}</Label>
            <Input
              id="room-capacity"
              inputMode="numeric"
              dir="ltr"
              className="h-11 rounded-xl"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
            {submitted && capacityError && (
              <p className="text-xs text-destructive">{t(capacityError)}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-location">{t("rooms.location")}</Label>
            <Input
              id="room-location"
              className="h-11 rounded-xl"
              maxLength={120}
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-equipment">{t("rooms.equipment")}</Label>
            <Input
              id="room-equipment"
              className="h-11 rounded-xl"
              maxLength={300}
              value={form.equipment}
              onChange={(e) => setForm({ ...form, equipment: e.target.value })}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
            {t("rooms.active")}
            <Switch
              checked={form.active}
              onCheckedChange={(v) => setForm({ ...form, active: v })}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("ui.cancel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("fees.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
