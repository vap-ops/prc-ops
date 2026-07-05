import "server-only";

// Spec 205 U3 — the labor budget vs actual for a WP, for the MONEY audience only.
// labor_budget and day_rate_snapshot carry NO authenticated grant, so this reads
// via the admin client — the same authorized escalation the PM review page makes.
// Callers MUST gate on isManagerRole (PM/PD/super) before calling; never reach
// this from a site_admin/procurement code path. Mirrors the inline reads on
// /review/work-packages/[id]; extracted so the WP detail จัดการ tab can reuse it.

import { createClient as createAdminClient } from "@/lib/db/admin";
import { aggregateLaborCost, type CostInputRow } from "./cost";
import { laborBudgetSummary, type LaborBudgetSummary } from "./budget";

export async function fetchWpLaborBudgetSummary(
  workPackageId: string,
): Promise<LaborBudgetSummary> {
  const admin = createAdminClient();

  const { data: costRows } = await admin
    .from("labor_logs")
    .select(
      "id, worker_id, work_date, day_fraction, day_rate_snapshot, pay_type_snapshot, worker_name_snapshot, self_logged, superseded_by",
    )
    .eq("work_package_id", workPackageId);
  const total = aggregateLaborCost((costRows ?? []) as CostInputRow[]).total;

  const { data: econRow } = await admin
    .from("wp_economics")
    .select("labor_budget")
    .eq("work_package_id", workPackageId)
    .maybeSingle();

  return laborBudgetSummary(econRow?.labor_budget ?? null, total);
}
