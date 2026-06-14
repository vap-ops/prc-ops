// StatusPill (spec 20): the app's status semantics carrier. The colour
// TRIO (hue) comes from status-colors.ts and is FROZEN — it encodes
// meaning. Field-First changes only the GEOMETRY (the pixels): bolder
// 1.5px border, a touch more weight, so the fill reads at arm's length
// in glare. Semantics untouched; this is a pure re-skin of the wrapper.

interface StatusPillProps {
  /** Frozen colour trio from status-colors.ts (bg/border/text). */
  pillClasses: string;
  className?: string;
  children: React.ReactNode;
}

export function StatusPill({ pillClasses, className, children }: StatusPillProps) {
  return (
    <span
      className={`text-meta inline-flex shrink-0 items-center rounded-full border-[1.5px] px-2.5 py-1 leading-none font-bold whitespace-nowrap ${pillClasses}${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </span>
  );
}
