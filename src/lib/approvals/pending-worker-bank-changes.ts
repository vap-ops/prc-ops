// Spec 170 U4c-2 — pending WORKER bank-change count for the dashboard inbox + the
// ภาพรวม total badge. The worker analogue of getPendingBankChangeCount. RLS scopes
// the read to the caller (pm/super/director see all; site_admin sees none — money
// hidden), so the count is honest per role. Best-effort: a read error yields 0.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export async function getPendingWorkerBankChangeCount(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count, error } = await supabase
    .from("worker_bank_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}
