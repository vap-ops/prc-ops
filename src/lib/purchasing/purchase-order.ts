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

// Spec 259 — client-side mirror of void_purchase_order's own guard: a PO is
// revertible only while nothing has shipped, i.e. EVERY member is still
// exactly 'purchased' (record_shipment / receive not yet run on any of
// them). Kept separate from derivePurchaseOrderStatus's roll-up (which
// deliberately EXCLUDES rejected/cancelled members) — void must refuse a PO
// with a rejected/cancelled member too, since that isn't the clean
// all-purchased shape create_purchase_order produced.
export function canVoidPurchaseOrder(memberStatuses: PurchaseRequestStatus[]): boolean {
  return memberStatuses.length > 0 && memberStatuses.every((s) => s === "purchased");
}

// Spec 269 — honest Thai errors for void_purchase_order. The RPC raises
// distinct errcodes per refusal site (PO404 not-found, PO409 shipped-line;
// 42501 role gate) so this mapping can say what actually went wrong. Any
// OTHER code — including a P0001 bubbled from GL internals or an append-only
// trigger — gets the generic message, never a guessed cause (the pre-269
// blanket "มีรายการที่จัดส่งหรือรับของแล้ว หรือไม่พบใบสั่งซื้อนี้" misled on
// every unrelated P0001).
export function voidPurchaseOrderErrorMessage(code: string | undefined): string {
  switch (code) {
    case "42501":
      return "ไม่มีสิทธิ์ยกเลิกใบสั่งซื้อ";
    case "PO404":
      return "ไม่พบใบสั่งซื้อนี้ อาจถูกยกเลิกไปแล้ว";
    case "PO409":
      return "ยกเลิกไม่ได้: มีรายการที่จัดส่งหรือรับของแล้ว";
    default:
      return "ยกเลิกใบสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

export function purchaseOrderTotal(lineAmounts: Array<number | null>): number {
  return lineAmounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
}

// Spec 260 — the PO-level charge types (ค่าขนส่ง / ส่วนลด / ค่าใช้จ่ายอื่น).
// Mirrors the `po_charge_type` DB enum; kept as a local union so the pure
// helpers below don't depend on a regenerated database.types.
export type PoChargeType = "transport" | "discount" | "other";

export interface PoChargeAmount {
  charge_type: PoChargeType;
  amount: number;
}

// Spec 260 — the charges-aware PO total, beside the pure line-sum
// (purchaseOrderTotal, which carries NO PO id and knows nothing of charges).
// grand total = Σ line amounts + Σ transport + Σ other − Σ discount. Charge
// `amount` is ALWAYS positive (a discount subtracts by TYPE, never by sign),
// so the direction lives here, not in the data. The sign passes straight
// through: a discount larger than the rest yields a negative total, surfaced
// as-is (a data-entry error the UI shows, never floors). The composition layer
// (buildPoDetailView, the worklist PO rows) switches to this; the create sheet
// keeps the pure line-sum (no charge rows exist yet at that point in the form).
export function purchaseOrderGrandTotal(
  lineAmounts: Array<number | null>,
  charges: ReadonlyArray<PoChargeAmount>,
): number {
  let total = purchaseOrderTotal(lineAmounts);
  for (const c of charges) {
    total += c.charge_type === "discount" ? -c.amount : c.amount;
  }
  return total;
}
