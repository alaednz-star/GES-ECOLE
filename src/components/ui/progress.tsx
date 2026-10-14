"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  // The indicator is SIZED rather than translated. The upstream shadcn version
  // slides a full-width block out of view with `translateX(-N%)`, which is a
  // physical transform: under RTL it fills from the wrong edge, and the block
  // itself extends far outside the viewport (clipped, but still laid out).
  // Setting the width instead needs no direction handling at all -- the flex
  // start edge already follows `dir`.
  <ProgressPrimitive.Root
    ref={ref}
    // `value` is forwarded as well as used below. Destructuring it out and only
    // applying it to the indicator's width left the root with role="progressbar" and
    // NO aria-valuenow, so the bar was invisible to a screen reader and unreadable to
    // a test -- a silent gap, since the fill still looked right.
    value={value}
    className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full bg-primary transition-all"
      style={{ width: `${Math.min(100, Math.max(0, value || 0))}%` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
