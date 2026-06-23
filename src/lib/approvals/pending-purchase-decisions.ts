// Spec 185 U1 — pending purchase-request count for the dashboard inbox + the
// ภาพรวม total badge. RLS scopes the read to the caller (pm/super/director see
// all 'requested' rows). Best-effort: a read error yields 0.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export async function getPendingPurchaseDecisionCount(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count, error } = await supabase
    .from("purchase_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "requested");
  if (error) return 0;
  return count ?? 0;
}
