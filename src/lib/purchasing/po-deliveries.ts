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

function isActive(status: PurchaseRequestStatus): boolean {
  return status !== "rejected" && status !== "cancelled";
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
