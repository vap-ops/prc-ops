// Spec 325 Phase 1 U2 — data loader for the per-project cost view. Same read
// shapes as the accounting drill + dashboard money block (spec 100/253), scoped
// to ONE project but kept at PER-WP grain. Admin client: money columns
// (day_rate_snapshot, wp_economics.labor_budget, rental settlements) carry no
// authenticated grant — call ONLY behind requireRole(PURCHASE_REPORT_ROLES).
// Reads are project-scoped (.eq project / .in wpIds|batchIds of the project),
// except the stock_reversals id-list — global, non-money, the accounting-drill
// precedent. Registered PROJECT_SCOPED in money-read-policy.ts (wp_economics).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { CostInputRow } from "@/lib/labor/cost";
import {
  attributeRentalCost,
  buildWpCostRows,
  projectCostFamilies,
  type ProjectCostFamilies,
  type RentalCostAttribution,
  type WpCostRow,
  type WpLaborRow,
} from "@/lib/costs/wp-cost-breakdown";
import { sumStorePool } from "@/lib/dashboard/spend";
import { round2 } from "@/lib/format";

type Db = SupabaseClient<Database>;

export interface ProjectCostsData {
  rows: WpCostRow[];
  families: ProjectCostFamilies;
  rental: RentalCostAttribution;
}

export async function loadProjectCosts(admin: Db, projectId: string): Promise<ProjectCostsData> {
  const { data: wpRows } = await admin
    .from("work_packages")
    .select("id, code, name")
    .eq("project_id", projectId);
  const wps = wpRows ?? [];
  const wpIds = wps.map((w) => w.id);

  // This project's rental agreements: allocations bound to it name the batches;
  // a second allocation read fetches those batches' FULL project sets so a
  // shared batch is disclosed, not silently attributed (spec 325 §2 grain note).
  const { data: myAllocations } = await admin
    .from("equipment_project_allocations")
    .select("batch_id")
    .eq("project_id", projectId);
  const batchIds = [...new Set((myAllocations ?? []).map((a) => a.batch_id))];

  const [
    laborRes,
    prRes,
    issuesRes,
    reversalsRes,
    storeReceiptsRes,
    poolRes,
    returnsRes,
    econRes,
    allAllocRes,
    batchRes,
    settlementRes,
  ] = await Promise.all([
    wpIds.length
      ? admin
          .from("labor_logs")
          .select(
            "id, worker_id, work_date, day_fraction, day_rate_snapshot, pay_type_snapshot, worker_name_snapshot, self_logged, superseded_by, work_package_id",
          )
          .in("work_package_id", wpIds)
      : Promise.resolve({ data: [] as (CostInputRow & { work_package_id: string })[] }),
    wpIds.length
      ? admin
          .from("purchase_requests")
          .select("id, status, amount, work_package_id")
          .in("work_package_id", wpIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            status: string;
            amount: number | null;
            work_package_id: string | null;
          }[],
        }),
    admin
      .from("stock_issues")
      .select("id, total_cost, work_package_id")
      .eq("project_id", projectId),
    admin.from("stock_reversals").select("issue_id").not("issue_id", "is", null),
    admin
      .from("stock_receipts")
      .select("purchase_request_id")
      .eq("project_id", projectId)
      .not("purchase_request_id", "is", null),
    admin.from("stock_on_hand").select("total_value").eq("project_id", projectId),
    admin.from("stock_returns").select("total_cost, work_package_id").eq("project_id", projectId),
    wpIds.length
      ? admin
          .from("wp_economics")
          .select("work_package_id, labor_budget")
          .in("work_package_id", wpIds)
      : Promise.resolve({ data: [] as { work_package_id: string; labor_budget: number | null }[] }),
    batchIds.length
      ? admin
          .from("equipment_project_allocations")
          .select("batch_id, project_id")
          .in("batch_id", batchIds)
      : Promise.resolve({ data: [] as { batch_id: string; project_id: string }[] }),
    batchIds.length
      ? admin.from("equipment_rental_batches").select("id, status").in("id", batchIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            status: Database["public"]["Enums"]["rental_agreement_status"];
          }[],
        }),
    batchIds.length
      ? admin
          .from("rental_settlements")
          .select("id, agreement_id, net_amount, superseded_by")
          .in("agreement_id", batchIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            agreement_id: string;
            net_amount: number;
            superseded_by: string | null;
          }[],
        }),
  ]);

  const reversedIssueIds = new Set(
    (reversalsRes.data ?? []).map((r) => r.issue_id).filter((id): id is string => id != null),
  );
  const storedPrIds = new Set(
    (storeReceiptsRes.data ?? [])
      .map((r) => r.purchase_request_id)
      .filter((id): id is string => id != null),
  );

  const rows = buildWpCostRows({
    wps,
    prs: (prRes.data ?? []).filter(
      (p): p is typeof p & { work_package_id: string } => p.work_package_id != null,
    ),
    storedPrIds,
    issues: issuesRes.data ?? [],
    reversedIssueIds,
    returns: returnsRes.data ?? [],
    laborRows: (laborRes.data ?? []) as WpLaborRow[],
    laborBudgetByWp: new Map((econRes.data ?? []).map((e) => [e.work_package_id, e.labor_budget])),
  });

  const rental = attributeRentalCost({
    settlements: (settlementRes.data ?? []).map((s) => ({
      id: s.id,
      agreementId: s.agreement_id,
      net: s.net_amount,
      supersededBy: s.superseded_by,
    })),
    batches: batchRes.data ?? [],
    allocations: (allAllocRes.data ?? []).map((a) => ({
      batchId: a.batch_id,
      projectId: a.project_id,
    })),
    projectId,
  });

  const families = projectCostFamilies({
    materialWpNet: rows.reduce((s, r) => round2(s + r.material.net), 0),
    storePool: sumStorePool(poolRes.data ?? []),
    labourTotal: rows.reduce((s, r) => round2(s + r.labour), 0),
    equipmentAttributed: rental.attributed,
  });

  return { rows, families, rental };
}
