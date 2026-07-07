// Spec 277 — the WP-list identity render: a work package's code shown with its
// category color + icon, the meaningless "WP" swapped for the category letter
// (WP-12 → E-12, via formatWpCode). One home so the shared row and the งาน group
// header render it identically. Uncategorised / unknown code → the plain mono
// code, inheriting the caller's color (graceful degrade). Display-only.

import { formatWpCode } from "@/lib/work-packages/format-code";
import { workCategoryIdentity } from "@/lib/work-categories/identity";

export function WpCategoryCode({
  code,
  categoryCode,
  className,
}: {
  code: string;
  /** Reconciled GLOBAL work-category code (W0x), or null/undefined if uncategorised. */
  categoryCode?: string | null;
  /** Extra utilities (size/weight) from the caller — never a text color. */
  className?: string;
}) {
  const identity = workCategoryIdentity(categoryCode);
  const base = `inline-flex items-center gap-1 font-mono${className ? ` ${className}` : ""}`;
  if (!identity) return <span className={base}>{code}</span>;
  const Icon = identity.icon;
  return (
    <span className={`${base} ${identity.accentClass} font-semibold`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {formatWpCode(code, identity.letter)}
    </span>
  );
}
