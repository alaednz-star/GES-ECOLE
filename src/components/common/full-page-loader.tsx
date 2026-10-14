import { Loader2 } from "lucide-react";

export function FullPageLoader({ label }: { label?: string | undefined }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-muted-foreground"
    >
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <span className="text-sm">{label ?? "…"}</span>
    </div>
  );
}
