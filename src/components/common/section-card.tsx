import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
  /**
   * `quiet` drops the card border, the header rule and the shadow, leaving the
   * heading to do the separating. Opt-in rather than the default: the admin
   * tables rely on the bordered look, and changing it globally is outside a
   * teacher-workspace task.
   */
  variant?: "default" | "quiet";
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  variant = "default",
}: SectionCardProps) {
  const quiet = variant === "quiet";

  return (
    <section
      className={cn(
        quiet ? "surface-panel px-4 py-4 sm:px-5" : "surface-card overflow-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3",
          quiet ? "pb-3" : "border-b border-border px-5 py-4 sm:px-6",
        )}
      >
        <div className={quiet ? undefined : "space-y-1"}>
          <h2
            className={cn(
              quiet
                ? "text-[13px] font-semibold uppercase tracking-wider text-muted-foreground"
                : "text-base font-semibold tracking-tight",
            )}
          >
            {title}
          </h2>
          {description && !quiet && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children && <div className={quiet ? undefined : "px-5 py-5 sm:px-6"}>{children}</div>}
    </section>
  );
}
