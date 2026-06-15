// Spec 115 / ADR 0044 — purchase-order pure helpers. A purchase_order groups
// N approved purchase_requests into one supplier order. Two facts about a PO are
// DERIVED from its member tickets, never stored (no drift, §5/§3):
//   - status: rolls up the member lifecycle (open → ordered → partially_received
//     → received), excluding rejected/cancelled members.
//   - total: the sum of the per-ticket amounts (the PO carries no money column;
//     per-WP material spend keeps reading purchase_requests.amount per ticket).

import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export type PurchaseOrderStatus = "open" | "ordered" | "partially_received" | "received";

// A member is delivered (received) only at status 'delivered'. It counts as
// "ordered" once the buy is placed and while in transit (purchased / on_route /
// delivered). rejected and cancelled members are excluded from the roll-up (§5).
function isDelivered(status: PurchaseRequestStatus): boolean {
  return status === "delivered";
}

function isOrdered(status: PurchaseRequestStatus): boolean {
  return status === "purchased" || status === "on_route" || status === "delivered";
}

export function derivePurchaseOrderStatus(
  memberStatuses: PurchaseRequestStatus[],
): PurchaseOrderStatus {
  const active = memberStatuses.filter((s) => s !== "rejected" && s !== "cancelled");

  // No active members (none, or all rejected/cancelled): nothing is on order.
  if (active.length === 0) return "open";

  const delivered = active.filter(isDelivered).length;
  if (delivered === active.length) return "received";
  if (delivered > 0) return "partially_received";

  // Nothing delivered yet: ordered only if every active member is on order.
  const ordered = active.filter(isOrdered).length;
  if (ordered === active.length) return "ordered";
  return "open";
}

export function purchaseOrderTotal(lineAmounts: Array<number | null>): number {
  return lineAmounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
}
