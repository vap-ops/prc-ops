import { cn } from "@/lib/utils";

// The status pill every list row and header renders (spec 17). Palette
// classes come from the typed helpers in src/lib/status-colors.ts (or
// a label-specific map); this component owns the shared geometry.

interface StatusPillProps {
  /** Palette classes from status-colors.ts (border/bg/text trio). */
  pillClasses: string;
  className?: string;
  children: React.ReactNode;
}

export function StatusPill({ pillClasses, className, children }: StatusPillProps) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        pillClasses,
        className,
      )}
    >
      {children}
    </span>
  );
}
