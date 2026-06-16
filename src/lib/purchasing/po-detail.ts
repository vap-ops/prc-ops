// Spec 134 U1 — PO detail view-model. The detail page reads a PO's member tickets
// and needs three derived facts: the rolled-up status (spec-115
// derivePurchaseOrderStatus), the money total, and how many lines are active.
//
// The status helper already excludes rejected/cancelled members (ADR 0044 §5).
// purchaseOrderTotal does NOT — so this composes the two and applies the SAME
// exclusion to the total and the count: a refused or withdrawn line is neither PO
// spend nor a delivered/awaited line. Pure (no DB / no React) → unit-tested.

import type { PurchaseRequestStatus } from "@/lib/db/enums";
import {
  derivePurchaseOrderStatus,
  purchaseOrderTotal,
  type PurchaseOrderStatus,
} from "@/lib/purchasing/purchase-order";

export interface PoDetailLine {
  status: PurchaseRequestStatus;
  amount: number | null;
}

export interface PoDetailView {
  status: PurchaseOrderStatus;
  total: number;
  activeLineCount: number;
}

// rejected/cancelled mirror the roll-up's exclusion (ADR 0044 §5).
function isActiveLine(status: PurchaseRequestStatus): boolean {
  return status !== "rejected" && status !== "cancelled";
}

export function buildPoDetailView(lines: ReadonlyArray<PoDetailLine>): PoDetailView {
  const active = lines.filter((line) => isActiveLine(line.status));
  return {
    // derivePurchaseOrderStatus applies its own §5 exclusion, so pass every status.
    status: derivePurchaseOrderStatus(lines.map((line) => line.status)),
    total: purchaseOrderTotal(active.map((line) => line.amount)),
    activeLineCount: active.length,
  };
}
