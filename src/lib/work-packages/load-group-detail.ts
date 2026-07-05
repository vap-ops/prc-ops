// Spec 270 U4 — data loader for the งาน (group WP) oversight page. Children
// read under the caller's RLS session; the money aggregates read via the ADMIN
// client STRICTLY behind the planner gate (same posture as /dashboard — the
// money columns carry no grants for session roles). The math itself is the
// pure groupSpendSummary (returns netted per the spec-209 trap).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { aggregateLaborCost, type CostInputRow } from "@/lib/labor/cost";
import { compareWpCodes } from "@/lib/work-packages/group-roster";
import { groupSpendSummary, type GroupSpendSummary } from "@/lib/work-packages/group-detail";

type Db = SupabaseClient<Database>;

export interface GroupChildRow {
  id: string;
  code: string;
  name: string;
  status: Database["public"]["Enums"]["work_package_status"];
  contractor_id: string | null;
  priority: Database["public"]["Enums"]["work_package_priority"];
}

export async function loadGroupChildren(supabase: Db, groupId: string): Promise<GroupChildRow[]> {
  const { data } = await supabase
    .from("work_packages")
    .select("id, code, name, status, contractor_id, priority")
    .eq("parent_id", groupId);
  return (data ?? []).sort(compareWpCodes);
}

/**
 * Leaf-bound money over the child set — dashboard wpLevel formula scoped to
 * one งาน: labor + materials (spend-status PRs minus store-routed) + เบิก
 * (non-reversed) − WP→store returns. Admin client: call ONLY behind the
 * planner gate.
 */
export async function loadGroupMoney(
  admin: Db,
  projectId: string,
  childIds: ReadonlyArray<string>,
): Promise<GroupSpendSummary> {
  if (childIds.length === 0) {
    return groupSpendSummary({
      prs: [],
      storedPrIds: new Set(),
      issues: [],
      returns: [],
      laborTotal: 0,
    });
  }
  const ids = [...childIds];
  const [laborRes, prRes, issuesRes, reversalsRes, receiptsRes, returnsRes] = await Promise.all([
    admin
      .from("labor_logs")
      .select(
        "id, worker_id, work_date, day_fraction, day_rate_snapshot, pay_type_snapshot, worker_name_snapshot, self_logged, superseded_by",
      )
      .in("work_package_id", ids),
    admin.from("purchase_requests").select("id, status, amount").in("work_package_id", ids),
    admin.from("stock_issues").select("id, total_cost").in("work_package_id", ids),
    // Reversed issues never charged a WP — same exclusion as the dashboard.
    admin.from("stock_reversals").select("issue_id").not("issue_id", "is", null),
    // Store-routed PRs are counted at เบิก, not at purchase (store-first U4).
    admin
      .from("stock_receipts")
      .select("purchase_request_id")
      .eq("project_id", projectId)
      .not("purchase_request_id", "is", null),
    admin.from("stock_returns").select("total_cost").in("work_package_id", ids),
  ]);

  const reversedIssueIds = new Set(
    (reversalsRes.data ?? []).map((r) => r.issue_id).filter((id): id is string => id != null),
  );
  const storedPrIds = new Set(
    (receiptsRes.data ?? [])
      .map((r) => r.purchase_request_id)
      .filter((id): id is string => id != null),
  );

  return groupSpendSummary({
    prs: prRes.data ?? [],
    storedPrIds,
    issues: (issuesRes.data ?? []).filter((i) => !reversedIssueIds.has(i.id)),
    returns: returnsRes.data ?? [],
    laborTotal: aggregateLaborCost((laborRes.data ?? []) as CostInputRow[]).total,
  });
}
