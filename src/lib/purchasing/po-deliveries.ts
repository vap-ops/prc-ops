// Spec 135 U2 / ADR 0054 — the การจัดส่ง deliveries view. A PO ships in deliveries
// procurement arranges; this turns the deliveries + their member lines into the list
// the PO detail renders. Each delivery's status is DERIVED from its own lines (reuse
// the PO roll-up — no stored status, ADR 0054 §5). Pure → unit-tested. Replaces the
// U7 receipt-batch grouping (groupDeliveryBatches).

import type { PurchaseRequestStatus } from "@/lib/db/enums";
import {
  derivePurchaseOrderStatus,
  type PurchaseOrderStatus,
} from "@/lib/purchasing/purchase-order";

export interface DeliveryRow {
  id: string;
  eta: string | null;
  created_at: string;
}

export interface DeliveryLine {
  delivery_id: string | null;
  status: PurchaseRequestStatus;
  delivered_at: string | null;
}

export interface DeliveryView {
  id: string;
  /** งวดที่ N — 1-based, in created_at order. */
  ordinal: number;
  eta: string | null;
  /** Derived from the delivery's own lines. */
  status: PurchaseOrderStatus;
  /** Active (non rejected/cancelled) line count. */
  lineCount: number;
  /** Latest delivered_at among the delivery's delivered lines, or null. */
  receivedAt: string | null;
}

// Spec 211 U10 — one home for the delivery-installment label. A bare "งวดที่ N"
// collides with งวดงาน (the billing/work milestone, e.g. deliverables + schedule
// gantt); qualify the PO shipment installment as "งวดจัดส่งที่ N" everywhere.
export function deliveryOrdinalLabel(ordinal: number): string {
  return `งวดจัดส่งที่ ${ordinal}`;
}

function isActive(status: PurchaseRequestStatus): boolean {
  return status !== "rejected" && status !== "cancelled";
}

// Spec 135 U4 — a proof-of-delivery doc as the PO detail consumes it (the current
// view's row, minus created_at). delivery_id is the งวด it documents.
export interface ProofDeliveryDoc {
  id: string | null;
  kind: string | null;
  storage_path: string | null;
  delivery_id: string | null;
}

// Spec 135 U4 — group a PO's proof-of-delivery docs by the delivery they document.
// New uploads carry a delivery_id; legacy proof (uploaded before U4, delivery_id NULL
// — the table is append-only so it was never backfilled) falls under the PO's DEFAULT
// delivery (the earliest, งวดที่ 1). A doc with no delivery and no default is dropped
// (can't happen post-U1: every PO has >= 1 delivery). Pure → unit-tested.
export function groupProofByDelivery<T extends { delivery_id: string | null }>(
  proofDocs: ReadonlyArray<T>,
  defaultDeliveryId: string | null,
): Map<string, T[]> {
  const byDelivery = new Map<string, T[]>();
  for (const doc of proofDocs) {
    const key = doc.delivery_id ?? defaultDeliveryId;
    if (key == null) continue;
    const arr = byDelivery.get(key);
    if (arr) arr.push(doc);
    else byDelivery.set(key, [doc]);
  }
  return byDelivery;
}

// Spec 135 U3 — the non-empty guard for a delivery split. A delivery must keep >= 1
// active line, so a split may not move every active line out of any source delivery.
// `activeCountByDelivery` is the active (non rejected/cancelled) line count per
// delivery; the selection groups by source delivery. The RPC re-enforces this
// server-side — this is the sheet's testable seam for a clear inline message.
export function deliverySplitWouldEmptySource(
  selected: ReadonlyArray<{ delivery_id: string | null }>,
  activeCountByDelivery: Readonly<Record<string, number>>,
): boolean {
  const movedByDelivery = new Map<string, number>();
  for (const line of selected) {
    if (line.delivery_id == null) continue;
    movedByDelivery.set(line.delivery_id, (movedByDelivery.get(line.delivery_id) ?? 0) + 1);
  }
  for (const [deliveryId, moved] of movedByDelivery) {
    if (moved >= (activeCountByDelivery[deliveryId] ?? 0)) return true;
  }
  return false;
}

export function buildDeliveriesView(
  deliveries: ReadonlyArray<DeliveryRow>,
  lines: ReadonlyArray<DeliveryLine>,
): DeliveryView[] {
  const sorted = [...deliveries].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return sorted.map((d, i) => {
    const own = lines.filter((l) => l.delivery_id === d.id);
    const deliveredDates = own
      .filter((l) => l.status === "delivered" && l.delivered_at !== null)
      .map((l) => l.delivered_at as string)
      .sort((a, b) => a.localeCompare(b));
    return {
      id: d.id,
      ordinal: i + 1,
      eta: d.eta,
      status: derivePurchaseOrderStatus(own.map((l) => l.status)),
      lineCount: own.filter((l) => isActive(l.status)).length,
      receivedAt: deliveredDates.length
        ? (deliveredDates[deliveredDates.length - 1] ?? null)
        : null,
    };
  });
}
