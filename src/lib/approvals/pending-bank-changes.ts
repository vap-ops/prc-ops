// Spec 184 U2 — pending contractor bank-change count for the dashboard card.
//
// Bank-change approvals (contractor_bank_change_requests at 'pending') have no
// nav surface; the PM dashboard is where their awareness lives. RLS scopes the
// read to the caller (pm/super/director see all; site_admin sees none — money
// hidden), so the count is honest per role. Best-effort: a read error yields 0
// rather than blocking the dashboard.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export async function getPendingBankChangeCount(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count, error } = await supabase
    .from("contractor_bank_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}
