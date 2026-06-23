// Spec 107 — per-supplier buyer intelligence. spend = ฿ committed/received from
// a supplier (in-transit + received PRs); open = in-transit PO count (ordered,
// not yet received). amount is money → the caller reads it via the admin client;
// this is pure. Site purchases carry no supplier_id, so they never count here.

import type { RecordBadge } from "@/components/features/purchasing/record-manager";
import { procurementBand } from "./procurement-pipeline";

export interface SupplierStat {
  spend: number;
  open: number;
}

export function aggregateSupplierSpend(
  prs: ReadonlyArray<{ supplier_id: string | null; amount: number | null; status: string }>,
): Map<string, SupplierStat> {
  const bySupplier = new Map<string, SupplierStat>();
  for (const pr of prs) {
    if (!pr.supplier_id) continue;
    const band = procurementBand(pr.status);
    // Only committed money: in-transit (open PO) or received.
    if (band !== "in_transit" && band !== "received") continue;
    const cur = bySupplier.get(pr.supplier_id) ?? { spend: 0, open: 0 };
    if (pr.amount != null) cur.spend += pr.amount;
    if (band === "in_transit") cur.open += 1;
    bySupplier.set(pr.supplier_id, cur);
  }
  return bySupplier;
}

const baht = (n: number) =>
  `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Build the per-supplier spend chips as a SERIALIZABLE map (supplier id → badge),
// so a Server Component can pass it across the RSC boundary to the client
// ContactsTabs. A function prop throws there (spec 109 lesson); the client makes
// its rowBadge closure from this map. Suppliers with no committed spend AND no
// open POs get no entry (→ no chip), matching the original page behaviour.
export function buildSupplierSpendBadges(
  stats: Map<string, SupplierStat>,
): Record<string, RecordBadge> {
  const badges: Record<string, RecordBadge> = {};
  for (const [id, s] of stats) {
    if (s.spend === 0 && s.open === 0) continue;
    const parts = [baht(s.spend)];
    if (s.open > 0) parts.push(`${s.open} ค้างส่ง`);
    badges[id] = { label: parts.join(" · "), tone: "neutral" };
  }
  return badges;
}
