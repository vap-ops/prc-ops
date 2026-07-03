// Spec 249 U2 — pure receipt rollups. Receipts are append-only + supersede
// (ADR 0004/0009 shape): current state is the anti-join (rows no newer row
// points at), tombstones (null amount) are never current. Coverage is ALWAYS
// computed from receipts — the billing's paid status is a convenience flip,
// not the source of truth.

export interface ReceiptRow {
  id: string;
  billingId: string | null;
  amount: number | null;
  receivedDate: string | null;
  supersededBy: string | null;
}

export interface BillingForSummary {
  id: string;
  netReceivable: number | null;
  status: string;
}

export function currentReceipts(rows: ReceiptRow[]): ReceiptRow[] {
  const supersededIds = new Set(rows.map((x) => x.supersededBy).filter(Boolean));
  return rows.filter((x) => x.amount !== null && !supersededIds.has(x.id));
}

export interface BillingCoverage {
  received: number;
  outstanding: number | null;
  covered: boolean;
}

export function billingCoverage(
  netReceivable: number | null,
  receiptsForBilling: ReceiptRow[],
): BillingCoverage {
  const received = currentReceipts(receiptsForBilling).reduce((acc, x) => acc + (x.amount ?? 0), 0);
  if (netReceivable === null) return { received, outstanding: null, covered: false };
  const outstanding = Math.max(0, netReceivable - received);
  return { received, outstanding, covered: received >= netReceivable };
}

export interface ProjectReceiptSummary {
  billed: number;
  received: number;
  advances: number;
  outstanding: number;
}

// billed = Σ net_receivable of billings past certify (net is snapshotted there);
// received = Σ all current receipts; advances = the unallocated slice;
// outstanding = Σ per-billing shortfalls (over-payments never net others out).
export function projectReceiptSummary(
  billings: BillingForSummary[],
  receipts: ReceiptRow[],
): ProjectReceiptSummary {
  const live = currentReceipts(receipts);
  const billed = billings.reduce((acc, b) => acc + (b.netReceivable ?? 0), 0);
  const received = live.reduce((acc, x) => acc + (x.amount ?? 0), 0);
  const advances = live
    .filter((x) => x.billingId === null)
    .reduce((acc, x) => acc + (x.amount ?? 0), 0);
  const outstanding = billings.reduce((acc, b) => {
    if (b.netReceivable === null) return acc;
    const cov = live.filter((x) => x.billingId === b.id).reduce((s, x) => s + (x.amount ?? 0), 0);
    return acc + Math.max(0, b.netReceivable - cov);
  }, 0);
  return { billed, received, advances, outstanding };
}
