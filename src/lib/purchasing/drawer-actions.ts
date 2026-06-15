// Spec 114 — which procurement (buyer) actions apply at each status in the
// review drawer. Mirrors the detail page's back-office gating (isBackOffice
// arms), procurement-scoped: decisions (approve/reject/cancel) are PM-only and
// never appear here. Pure (no UI) so the gating is unit-tested.

import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export interface ProcurementDrawerActions {
  /** record_purchase — status approved (place the order). */
  record: boolean;
  /** record_shipment — status purchased (mark shipped). */
  ship: boolean;
  /** attach invoice/receipt — goods exist (purchased onward). */
  invoice: boolean;
  /** attach delivery-confirmation photo — in transit / delivered. */
  deliveryPhoto: boolean;
}

export function procurementDrawerActions(status: PurchaseRequestStatus): ProcurementDrawerActions {
  return {
    record: status === "approved",
    ship: status === "purchased",
    invoice:
      status === "purchased" ||
      status === "on_route" ||
      status === "delivered" ||
      status === "site_purchased",
    deliveryPhoto: status === "on_route" || status === "delivered",
  };
}
