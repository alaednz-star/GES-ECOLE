/**
 * The pedagogical role, as a badge.
 *
 * Sits beside the file-type badge rather than replacing it: [COURS] [PDF] answers
 * two different questions, and the pedagogical one comes first because that is what
 * a student scanning a chapter is actually looking for.
 */

import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { roleFace } from "./resource-role";
import type { ResourceRole } from "./types";

export function RoleBadge({
  role,
  className,
  full = false,
}: {
  role: ResourceRole;
  className?: string | undefined;
  /** Long label, for wide contexts like a table cell. */
  full?: boolean | undefined;
}) {
  const { t } = useI18n();
  const face = roleFace(role);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        face.className,
        className,
      )}
    >
      {t(full ? face.labelKey : face.shortKey)}
    </span>
  );
}
