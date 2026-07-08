import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { SPEND_STATUSES } from "@/lib/dashboard/spend";
import {
  rankVendorsByCategory,
  type VendorCategoryEvent,
} from "@/lib/purchasing/vendor-suggestion";

type Db = SupabaseClient<Database>;
type PrStatus = Database["public"]["Enums"]["purchase_request_status"];

// Spec 280 U1 — derive `categoryId → ranked vendors` from committed purchase
// history. A vendor's material categories are NOT declared anywhere; they are the
// catalog categories it has actually supplied on committed PRs
// (purchase_request.supplier_id + catalog_item → category). Best-effort: an empty
// map just means "no suggestions" and the picker falls back to the full list.
export async function loadCategoryVendors(supabase: Db): Promise<Record<string, string[]>> {
  const { data: prRows } = await supabase
    .from("purchase_requests")
    .select("supplier_id, catalog_item_id, purchased_at, status")
    .in("status", [...SPEND_STATUSES] as PrStatus[])
    .not("supplier_id", "is", null)
    .not("catalog_item_id", "is", null);

  const rows = prRows ?? [];
  if (rows.length === 0) return {};

  const itemIds = [
    ...new Set(rows.map((r) => r.catalog_item_id).filter((x): x is string => x != null)),
  ];
  const itemCategory = new Map<string, string | null>();
  if (itemIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("catalog_items")
      .select("id, category_id")
      .in("id", itemIds);
    for (const it of itemRows ?? []) itemCategory.set(it.id, it.category_id);
  }

  const events: VendorCategoryEvent[] = rows
    .filter((r): r is typeof r & { supplier_id: string } => r.supplier_id != null)
    .map((r) => ({
      supplierId: r.supplier_id,
      categoryId: r.catalog_item_id ? (itemCategory.get(r.catalog_item_id) ?? null) : null,
      purchasedAt: r.purchased_at,
    }));

  return rankVendorsByCategory(events);
}
