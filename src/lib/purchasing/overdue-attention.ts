// Spec 138 U1 — the "ต้องติดตามด่วน" urgent-follow-up panel. Surfaces the actual
// overdue in-transit deliveries (the items behind the เกินกำหนด count), most-
// overdue first, capped for a phone panel. Pure (no UI); the /requests page
// renders from it for procurement only.

import { procurementBand } from "@/lib/purchasing/procurement-pipeline";

// One purchase-request row, narrowed to the facts the panel needs. amount is
// money (the procurement page reads it via the admin client).
export interface OverdueAttentionRow {
  id: string;
  pr_number: number;
  item_description: string;
  status: string;
  eta: string | null;
  supplier: string | null;
  amount: number | null;
}

export interface OverdueAttentionItem {
  id: string;
  prNumber: number;
  itemDescription: string;
  supplier: string | null;
  /** ISO date "YYYY-MM-DD" — non-null (the overdue filter guarantees it). */
  eta: string;
  amount: number | null;
  /** Whole days the ETA is past today (≥ 1 by the filter). */
  overdueDays: number;
}

// Whole days between two Bangkok civil dates ("YYYY-MM-DD"). Parsed as UTC so
// the subtraction is DST-free; both inputs are already the same civil calendar.
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// todayIso = Bangkok civil date "YYYY-MM-DD". An item is overdue when it is in
// the in_transit band (purchased / on_route) and its ETA is strictly before
// today — exactly the spec-105 `procurementSummary.overdue` set. String compare
// is correct for zero-padded ISO dates. Returned most-overdue first (earliest
// ETA), ties broken by PR number, capped at `limit`.
export function selectOverdueFollowUp(
  rows: ReadonlyArray<OverdueAttentionRow>,
  todayIso: string,
  limit = 4,
): OverdueAttentionItem[] {
  return rows
    .filter((r) => procurementBand(r.status) === "in_transit" && r.eta !== null && r.eta < todayIso)
    .sort((a, b) => (a.eta! < b.eta! ? -1 : a.eta! > b.eta! ? 1 : a.pr_number - b.pr_number))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      prNumber: r.pr_number,
      itemDescription: r.item_description,
      supplier: r.supplier,
      eta: r.eta!,
      amount: r.amount,
      overdueDays: daysBetween(r.eta!, todayIso),
    }));
}
