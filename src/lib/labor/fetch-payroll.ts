// Spec 69 — shared server read backing both the PM payroll page and the CSV
// export route, so the two never diverge. Admin client (the rate snapshot
// has zero authenticated grant); callers MUST gate on requireRole(PM_ROLES)
// before invoking. Fetches ALL worker types in the window — DC is filtered
// in aggregatePayroll AFTER the current-state pass (a supersede correction
// re-snapshots worker_type; a DB-level type filter could miscount).

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
      "id, worker_id, worker_name_snapshot, worker_type_snapshot, day_fraction, day_rate_snapshot, contractor_id_snapshot, superseded_by, work_date",
    )
    .gte("work_date", range.from)
    .lte("work_date", range.to);
  if (error) throw new Error(`fetch labor_logs: ${error.message}`);
  const labor = rows ?? [];

  const contractorIds = Array.from(
    new Set(labor.map((r) => r.contractor_id_snapshot).filter((id): id is string => id !== null)),
  );
  const names = new Map<string, string>();
  if (contractorIds.length > 0) {
    const { data: cs, error: cErr } = await admin
      .from("contractors")
      .select("id, name")
      .in("id", contractorIds);
    if (cErr) throw new Error(`fetch contractors: ${cErr.message}`);
    for (const c of cs ?? []) names.set(c.id, c.name);
  }

  return aggregatePayroll(labor, names);
}
