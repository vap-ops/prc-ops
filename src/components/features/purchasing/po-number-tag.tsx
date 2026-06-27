import { Package } from "lucide-react";
import { formatPoNumber } from "@/lib/purchasing/format-id";

// Spec 211 U2 — the typed PO identifier chip. A PO number must read VISIBLY
// different from a PR number (they previously differed only by the 2-letter
// prefix in identical mono text — the operator's "can't tell the PO from its
// items" pain). The bordered chip + Package icon marks "this is an order"; PR
// numbers stay plain mono (formatPrNumber). Server-safe (no 'use client', no
// handlers) so it drops into both server pages and the client grid.
export function PoNumberTag({
  poNumber,
  className = "",
}: {
  poNumber: number | null;
  className?: string;
}) {
  return (
    <span
      className={`border-edge bg-sunk text-ink-secondary inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs ${className}`}
    >
      <Package aria-hidden className="size-3 shrink-0" />
      {formatPoNumber(poNumber)}
    </span>
  );
}
