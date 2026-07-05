// Spec 69 / spec 170 U3 — shared server read backing both the PM payroll page
// and the CSV export route, so the two never diverge. Admin client (the rate
// snapshot has zero authenticated grant); callers MUST gate on
// requireRole(PM_ROLES) before invoking. Fetches ALL pay types in the window
// — daily ช่าง are filtered in aggregatePayroll AFTER the current-state pass (a supersede
// correction re-snapshots pay_type; a DB-level type filter could miscount).
// ADR 0062: payroll rolls up per worker, so no contractor name lookup is needed.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { aggregatePayroll, type PayrollRange, type PayrollReport } from "./payroll";

export async function fetchPayrollReport(
  admin: SupabaseClient<Database>,
  range: PayrollRange,
): Promise<PayrollReport> {
  const { data: rows, error } = await admin
    .from("labor_logs")
    .select(
      "id, worker_id, worker_name_snapshot, pay_type_snapshot, day_fraction, day_rate_snapshot, superseded_by, work_date",
    )
    .gte("work_date", range.from)
    .lte("work_date", range.to);
  if (error) throw new Error(`fetch labor_logs: ${error.message}`);

  return aggregatePayroll(rows ?? []);
}
