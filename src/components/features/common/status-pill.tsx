// StatusPill (spec 20): the app's status semantics carrier. The colour
// TRIO (hue) comes from status-colors.ts and is FROZEN — it encodes
// meaning. Field-First changes only the GEOMETRY (the pixels): bolder
// 1.5px border, a touch more weight, so the fill reads at arm's length
// in glare. Semantics untouched; this is a pure re-skin of the wrapper.

import type { LucideIcon } from "lucide-react";

interface StatusPillProps {
  /** Frozen colour trio from status-colors.ts (bg/border/text). */
  pillClasses: string;
  /**
   * Spec 211 U4: the status glyph from status-icons.ts — a colour-independent
   * cue (sun glare / colour-blind) rendered before the label. Optional so a
   * non-status pill can omit it.
   */
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}

export function StatusPill({ pillClasses, icon: Icon, className, children }: StatusPillProps) {
  return (
    <span
      className={`text-meta inline-flex shrink-0 items-center gap-1 rounded-full border-[1.5px] px-2.5 py-1 leading-none font-bold whitespace-nowrap ${pillClasses}${
        className ? ` ${className}` : ""
      }`}
    >
      {Icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null}
      {children}
    </span>
  );
}
