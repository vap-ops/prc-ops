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
// Spec 211 U7 — ONE label per worklist band, shared by the pipeline band headers,
// the status-chip filter (worklist-status-chips.ts), and the KPI tiles
// (worklist-kpis.ts), so a band never reads two ways on one screen (to_order was
// "อนุมัติแล้ว" on the chip but "รอสั่งซื้อ" on the header + tile). "all" and "overdue"
// are chip/tile pseudo-bands (a filter view, not a row band) but share this home.
export const PROCUREMENT_BAND_LABEL = {
  all: "ทั้งหมด",
  awaiting_approval: "รออนุมัติ",
  to_order: "รอสั่งซื้อ",
  in_transit: "กำลังจัดส่ง",
  overdue: "เกินกำหนด",
  received: "ได้รับแล้ว",
} as const;

// Display order: the buyer's action first, history last.
export const PROCUREMENT_BANDS: ReadonlyArray<ProcurementBandMeta> = [
  { band: "to_order", label: PROCUREMENT_BAND_LABEL.to_order, hot: true },
  { band: "in_transit", label: PROCUREMENT_BAND_LABEL.in_transit, hot: false },
  { band: "received", label: PROCUREMENT_BAND_LABEL.received, hot: false },
  // Waiting on the PM's decision — procurement can't act yet (visibility only).
  { band: "awaiting_approval", label: PROCUREMENT_BAND_LABEL.awaiting_approval, hot: false },
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

// Spec 106: outstanding = money committed but not yet received. The caller
// passes the in-transit rows' amounts (read via the admin client — amount is
// money); this just sums the non-null ones.
export function sumOutstanding(rows: ReadonlyArray<{ amount: number | null }>): number {
  let total = 0;
  for (const r of rows) if (r.amount != null) total += r.amount;
  return total;
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
