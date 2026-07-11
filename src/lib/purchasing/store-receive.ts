import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// Spec 300 U2 / spec 195 P3 (ADR 0063) — a WP-less (store-bound) purchase request reaching
// `delivered` has its stock_receipt auto-booked by the purchase_requests_stock_in_on_receive
// trigger (goods enter the store, Dr Inventory / Cr AP). This mirrors that trigger's exact
// condition so the receive card can tell the SA the goods landed in the store
// ("✓ รับเข้าคลังแล้ว"). A WP-bound delivered PR is expensed to WP-WIP instead, so it is NOT
// a store receipt.
export function isReceivedIntoStore(
  status: PurchaseRequestStatus,
  workPackageId: string | null,
): boolean {
  return status === "delivered" && workPackageId == null;
}
