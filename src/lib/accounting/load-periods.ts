// Spec 196 Tier 4 — loader for the month-end close surface. Reads the zero-grant
// accounting_periods via the admin client behind requireRole(ACCOUNTING_ROLES)
// (the register pattern). The lifecycle WRITES go through the definer RPCs on the
// authed session (see actions.ts) — this is read-only.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export interface PeriodRow {
  month: string;
  status: string;
  closedAt: string | null;
}

export async function loadPeriods(admin: SupabaseClient<Database>): Promise<PeriodRow[]> {
  const { data, error } = await admin
    .from("accounting_periods")
    .select("period_month, status, closed_at")
    .order("period_month", { ascending: false });
  if (error) throw new Error(`accounting_periods: ${error.message}`);
  return (data ?? []).map((p) => ({
    month: p.period_month,
    status: p.status,
    closedAt: p.closed_at,
  }));
}
