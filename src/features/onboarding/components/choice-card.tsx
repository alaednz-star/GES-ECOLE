import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChoiceCardProps {
  selected: boolean;
  onSelect: () => void;
  label: string;
  description?: string | undefined;
  icon?: LucideIcon | undefined;
  className?: string | undefined;
}

/**
 * A large, tappable option card.
 *
 * Used for cycle, year and stream so all three read as the same kind of
 * decision. It is a real `<button>` rather than a styled div, which gives
 * keyboard focus, Enter/Space activation and screen-reader semantics for free;
 * `aria-pressed` communicates the selected state.
 *
 * Minimum height is set for comfortable thumb targets -- most students arrive
 * from a phone ad.
 */
export function ChoiceCard({
  selected,
  onSelect,
  label,
  description,
  icon: Icon,
  className,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "focus-ring group relative flex min-h-18 w-full items-center gap-3 rounded-2xl border p-4 text-start transition-all",
        "hover:border-primary/50 hover:bg-muted/40 active:scale-[0.99]",
        selected
          ? "border-primary bg-primary-soft shadow-sm ring-1 ring-primary/20"
          : "border-border bg-card",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl transition-colors",
            selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium sm:text-base",
            selected && "text-primary",
          )}
        >
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        )}
      </span>

      {/* Reserve the slot always so selecting a card never shifts the layout. */}
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full border transition-all",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-transparent text-transparent",
        )}
        aria-hidden
      >
        <Check className="size-3" />
      </span>
    </button>
  );
}
