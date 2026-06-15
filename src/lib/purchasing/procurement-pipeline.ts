// Spec 104 — the procurement worklist as a buyer's PIPELINE. Procurement moves
// each request approved → order → track → receive; this groups the request rows
// into those action bands so "what to buy now" is the top of the screen.
// Pure (no UI) — the /requests page renders from it for procurement only.

export type ProcurementBand = "to_order" | "in_transit" | "received" | "awaiting_approval";

export interface ProcurementBandMeta {
  band: ProcurementBand;
  label: string;
  /** The actionable "buy now" band — rendered hot (amber). */
  hot: boolean;
}

// Display order: the buyer's action first, history last.
export const PROCUREMENT_BANDS: ReadonlyArray<ProcurementBandMeta> = [
  { band: "to_order", label: "รอสั่งซื้อ", hot: true },
  { band: "in_transit", label: "กำลังจัดส่ง", hot: false },
  { band: "received", label: "ได้รับแล้ว", hot: false },
  // Waiting on the PM's decision — procurement can't act yet (visibility only).
  { band: "awaiting_approval", label: "รออนุมัติ", hot: false },
];

// Map a purchase-request status to a procurement band. rejected/cancelled are
// not the buyer's work → null (excluded from the pipeline).
export function procurementBand(status: string): ProcurementBand | null {
  switch (status) {
    case "approved":
      return "to_order";
    case "purchased":
    case "on_route":
      return "in_transit";
    case "delivered":
    case "site_purchased":
      return "received";
    case "requested":
      return "awaiting_approval";
    default:
      return null;
  }
}

// Spec 105: the buyer's at-a-glance summary — workload + what's slipping.
export interface ProcurementSummary {
  /** approved, awaiting purchase (the actionable count). */
  toOrder: number;
  /** purchased / on_route, awaiting delivery. */
  inTransit: number;
  /** in-transit rows whose ETA is past today (late deliveries to chase). */
  overdue: number;
}

// todayIso = Bangkok civil date "YYYY-MM-DD"; eta is a date string or null.
// String compare is correct for zero-padded ISO dates.
export function procurementSummary(
  rows: ReadonlyArray<{ status: string; eta: string | null }>,
  todayIso: string,
): ProcurementSummary {
  let toOrder = 0;
  let inTransit = 0;
  let overdue = 0;
  for (const r of rows) {
    const band = procurementBand(r.status);
    if (band === "to_order") {
      toOrder += 1;
    } else if (band === "in_transit") {
      inTransit += 1;
      if (r.eta !== null && r.eta < todayIso) overdue += 1;
    }
  }
  return { toOrder, inTransit, overdue };
}

// Group rows into bands, in PROCUREMENT_BANDS order, dropping empty bands and
// rows with no band. Within-band order is preserved from the input.
export function groupByProcurementBand<T extends { status: string }>(
  rows: ReadonlyArray<T>,
): Array<{ meta: ProcurementBandMeta; items: T[] }> {
  const byBand = new Map<ProcurementBand, T[]>();
  for (const r of rows) {
    const b = procurementBand(r.status);
    if (!b) continue;
    const arr = byBand.get(b) ?? [];
    arr.push(r);
    byBand.set(b, arr);
  }
  return PROCUREMENT_BANDS.map((meta) => ({ meta, items: byBand.get(meta.band) ?? [] })).filter(
    (g) => g.items.length > 0,
  );
}
