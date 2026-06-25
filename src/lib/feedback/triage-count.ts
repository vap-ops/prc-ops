// Spec 201 (awareness arc A1) — open-feedback count for the operator's dashboard
// triage card.
//
// New bug reports / feature requests (feedback at 'open') have no nav surface; the
// operator (super_admin) only learns of them by opening /feedback/review or running
// /triage-feedback. Like the bank-change card (spec 188), their awareness lives in
// the dashboard inbox. RLS scopes the read to the caller — super_admin reads all
// feedback (mig 20260813000000), so the count is honest; any other role reads only
// their own and never sees the card. Best-effort: a read error yields 0 rather than
// blocking the dashboard.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export async function getOpenFeedbackCount(supabase: SupabaseClient<Database>): Promise<number> {
  const { count, error } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) return 0;
  return count ?? 0;
}
