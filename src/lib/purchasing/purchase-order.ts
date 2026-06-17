// Spec 115 / ADR 0044 — purchase-order pure helpers. A purchase_order groups
// N approved purchase_requests into one supplier order. Two facts about a PO are
// DERIVED from its member tickets, never stored (no drift, §5/§3):
//   - status: rolls up the member lifecycle (open → ordered → partially_received
//     → received), excluding rejected/cancelled members.
//   - total: the sum of the per-ticket amounts (the PO carries no money column;
//     per-WP material spend keeps reading purchase_requests.amount per ticket).

import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// Spec 134 U6 (amends ADR 0044 §5 roll-up): in_transit surfaces the delivering
// stage — at least one member shipped (on_route), none delivered yet — so the PO no
// longer jumps ordered → received with the shipment invisible.
export type PurchaseOrderStatus =
  | "open"
  | "ordered"
  | "in_transit"
  | "partially_received"
  | "received";

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

  // Nothing delivered yet. A shipped member (on_route) surfaces the delivering
  // stage (spec 134 U6) — the PO is on the way, not merely "ordered".
  if (active.some((s) => s === "on_route")) return "in_transit";

  // Otherwise ordered only if every active member is on order (all purchased).
  const ordered = active.filter(isOrdered).length;
  if (ordered === active.length) return "ordered";
  return "open";
}

// Spec 134 U6 — the PO progress stepper: สั่งซื้อ (ordered) → จัดส่ง (in_transit) →
// รับของ (received). Maps the derived status to per-stage state; the "current" step
// is the live milestone, partially_received marks รับของ partial. Pure → unit-tested.
export type PurchaseOrderStage = "ordered" | "in_transit" | "received";

export interface PurchaseOrderStageStep {
  stage: PurchaseOrderStage;
  state: "done" | "current" | "pending";
  partial?: boolean;
}

export function purchaseOrderStageStates(status: PurchaseOrderStatus): PurchaseOrderStageStep[] {
  let ordered: PurchaseOrderStageStep["state"];
  let inTransit: PurchaseOrderStageStep["state"];
  let received: PurchaseOrderStageStep["state"];
  let partial = false;
  switch (status) {
    case "open":
      ordered = "current";
      inTransit = "pending";
      received = "pending";
      break;
    case "ordered":
      ordered = "done";
      inTransit = "current";
      received = "pending";
      break;
    case "in_transit":
      ordered = "done";
      inTransit = "done";
      received = "current";
      break;
    case "partially_received":
      ordered = "done";
      inTransit = "done";
      received = "current";
      partial = true;
      break;
    case "received":
      ordered = "done";
      inTransit = "done";
      received = "done";
      break;
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      ordered = "current";
      inTransit = "pending";
      received = "pending";
    }
  }
  return [
    { stage: "ordered", state: ordered },
    { stage: "in_transit", state: inTransit },
    { stage: "received", state: received, ...(partial ? { partial: true } : {}) },
  ];
}

export function purchaseOrderTotal(lineAmounts: Array<number | null>): number {
  return lineAmounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
}
