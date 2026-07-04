// Spec 262 U4 — ค้างรับเข้า: delivered, store-bound (WP-less) purchase
// requests with no stock_receipts row yet (store-first doctrine, specs
// 195/209 — a store-bound PR's goods enter the store via a receipt before
// any withdrawal). Mirrors the dashboard's storedPrIds query exactly
// (stock_receipts.purchase_request_id), scoped company-wide for this home tile.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { countPendingStoreReceipt } from "@/lib/purchasing/procurement-home-tiles";

type Admin = SupabaseClient<Database>;

export async function loadPendingStoreReceiptCount(admin: Admin): Promise<number> {
  const { data: deliveredRows } = await admin
    .from("purchase_requests")
    .select("id")
    .eq("status", "delivered")
    .is("work_package_id", null);
  const deliveredIds = (deliveredRows ?? []).map((r) => r.id);
  if (deliveredIds.length === 0) return 0;

  const { data: receiptRows } = await admin
    .from("stock_receipts")
    .select("purchase_request_id")
    .in("purchase_request_id", deliveredIds);
  const storedPrIds = new Set(
    (receiptRows ?? []).map((r) => r.purchase_request_id).filter((id): id is string => id !== null),
  );
  return countPendingStoreReceipt(deliveredIds, storedPrIds);
}
