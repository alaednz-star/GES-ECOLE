import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  KeyRound,
  MoreHorizontal,
  Pencil,
  PauseCircle,
  PlayCircle,
  Trash2,
  UserSquare2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/hooks/use-i18n";
import type { TeacherRow } from "@/features/school/types";

export type TeacherAction =
  "view" | "edit" | "resetPassword" | "suspend" | "reactivate" | "archive" | "restore" | "delete";

/**
 * Contextual actions for one teacher.
 *
 * Only transitions that are legal from the current state are rendered -- a
 * suspended teacher has no "Suspend", an archived one has no "Edit". Offering an
 * action the database would refuse is worse than hiding it: the admin learns the
 * rule by being told no, instead of by the interface being honest up front.
 *
 * The table exposes quick actions; detailed management lives on the profile.
 */
export function TeacherActionsMenu({
  teacher,
  onAction,
}: {
  teacher: TeacherRow;
  onAction: (action: TeacherAction, teacher: TeacherRow) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const status = teacher.status as string;
  const isActive = status === "active";
  const isSuspended = status === "suspended";
  const isArchived = status === "archived";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          aria-label={t("entity.teachers.actionsFor", { name: teacher.fullName })}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56 rounded-xl">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {teacher.fullName}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() =>
            void navigate({
              to: "/dashboard/teachers/$teacherId",
              params: { teacherId: teacher.id },
            })
          }
        >
          <UserSquare2 className="size-4" aria-hidden />
          {t("actions.viewProfile")}
        </DropdownMenuItem>

        {/* Editing an archived record would imply it is still in service. */}
        {!isArchived && (
          <DropdownMenuItem onSelect={() => onAction("edit", teacher)}>
            <Pencil className="size-4" aria-hidden />
            {t("actions.edit")}
          </DropdownMenuItem>
        )}

        {/* A banned account cannot sign in, so a new password is meaningless. */}
        {isActive && (
          <DropdownMenuItem onSelect={() => onAction("resetPassword", teacher)}>
            <KeyRound className="size-4" aria-hidden />
            {t("actions.resetPassword")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {isActive && (
          <DropdownMenuItem onSelect={() => onAction("suspend", teacher)}>
            <PauseCircle className="size-4" aria-hidden />
            {t("actions.suspend")}
          </DropdownMenuItem>
        )}

        {isSuspended && (
          <DropdownMenuItem onSelect={() => onAction("reactivate", teacher)}>
            <PlayCircle className="size-4" aria-hidden />
            {t("actions.reactivate")}
          </DropdownMenuItem>
        )}

        {!isArchived && (
          <DropdownMenuItem onSelect={() => onAction("archive", teacher)}>
            <Archive className="size-4" aria-hidden />
            {t("actions.archive")}
          </DropdownMenuItem>
        )}

        {isArchived && (
          <DropdownMenuItem onSelect={() => onAction("restore", teacher)}>
            <ArchiveRestore className="size-4" aria-hidden />
            {t("actions.restore")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Danger zone. The dialog re-checks dependencies and usually refuses --
            archive is the real removal for anyone who has taught. */}
        <DropdownMenuItem
          onSelect={() => onAction("delete", teacher)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
          {t("actions.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
