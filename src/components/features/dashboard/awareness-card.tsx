// Spec 185 U1 — the generic dashboard awareness card. Presentational (no fetch):
// renders ONLY when count>0 (exception-driven — occasional approval types don't
// clutter the home with zero-state rows, unlike the always-on รอตรวจ hero), shows
// the count + label in the attention palette, and links to the decision surface.
// One component for the purchase-request + bank-change cards (and future types).

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export function AwarenessCard({
  count,
  label,
  href,
  icon: Icon,
}: {
  count: number;
  label: string;
  href: string;
  icon: LucideIcon;
}) {
  if (count <= 0) return null;
  return (
    <Link
      href={href}
      aria-label={`${count} ${label}`}
      className="border-attn-edge bg-attn-soft shadow-card rounded-card hover:border-attn focus-visible:ring-action flex items-center justify-between gap-3 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <span className="flex items-center gap-2">
        <Icon aria-hidden className="text-attn-ink size-5 shrink-0" />
        <span className="text-attn-ink text-body">
          <span className="font-bold">{count}</span> {label}
        </span>
      </span>
      <ArrowRight aria-hidden className="text-attn-ink size-5 shrink-0" />
    </Link>
  );
}
