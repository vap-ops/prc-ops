// Spec 107 — per-supplier buyer intelligence. spend = ฿ committed/received from
// a supplier (in-transit + received PRs); open = in-transit PO count (ordered,
// not yet received). amount is money → the caller reads it via the admin client;
// this is pure. Site purchases carry no supplier_id, so they never count here.

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
