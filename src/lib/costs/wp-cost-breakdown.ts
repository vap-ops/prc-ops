// Spec 325 Phase 1 — WP cost composition (actuals only). Composes the EXISTING
// spend atoms into per-WP material + labour rows and the project family totals
// (ค่าวัสดุ vs ค่าดำเนินการ = labour + equipment), per the locked §2 model:
// - material per WP = dashboard wpLevel formula scoped to one WP (spend-status
//   PRs minus store-routed + เบิก non-reversed − WP→store returns, spec 209 trap)
// - labour per WP = aggregateLaborCost at COST basis (day_rate_snapshot)
// - equipment = PROJECT grain ONLY (settlement net via allocations; the WP tie
//   was retired with zero usage, spec 323 D6 — never reintroduced here)
// Pure — no I/O; round2 = money SSOT. No budgets beyond the existing
// labor_budget (Phase 3 parked), no rework line (Phase 2).

import type { Database } from "@/lib/db/database.types";
import { round2 } from "@/lib/format";
import {
  sumMaterials,
  sumStoreIssues,
  sumStoreReturns,
  SPEND_STATUSES,
} from "@/lib/dashboard/spend";
import { aggregateLaborCost, type CostInputRow } from "@/lib/labor/cost";
import { compareWpCodes } from "@/lib/work-packages/group-roster";
import { currentSettlements } from "@/lib/equipment/rental-settlement-view";

export interface WpCostWp {
  id: string;
  code: string;
  name: string | null;
}

export interface WpCostPrRow {
  id: string;
  status: string;
  amount: number | null;
  work_package_id: string;
}

export interface WpCostIssueRow {
  id: string;
  total_cost: number | null;
  work_package_id: string;
}

export interface WpCostReturnRow {
  total_cost: number | null;
  work_package_id: string;
}

export type WpLaborRow = CostInputRow & { work_package_id: string };

export interface WpMaterialBreakdown {
  purchases: number;
  storeIssues: number;
  storeReturns: number;
  /** purchases + storeIssues − storeReturns. */
  net: number;
  /** Spend-status PRs with no recorded price — disclosed, never silently 0. */
  awaitingPriceCount: number;
}

export interface WpCostRow {
  wpId: string;
  code: string;
  name: string | null;
  material: WpMaterialBreakdown;
  labour: number;
  /** wp_economics.labor_budget — the one budget line that exists today. */
  laborBudget: number | null;
  /** material.net + labour. */
  total: number;
}

export interface WpCostInput {
  wps: ReadonlyArray<WpCostWp>;
  prs: ReadonlyArray<WpCostPrRow>;
  /** PR ids whose goods entered the store (counted at เบิก instead). */
  storedPrIds: ReadonlySet<string>;
  issues: ReadonlyArray<WpCostIssueRow>;
  reversedIssueIds: ReadonlySet<string>;
  returns: ReadonlyArray<WpCostReturnRow>;
  laborRows: ReadonlyArray<WpLaborRow>;
  laborBudgetByWp: ReadonlyMap<string, number | null>;
}

function groupBy<T extends { work_package_id: string }>(rows: ReadonlyArray<T>): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.work_package_id);
    if (list) list.push(r);
    else out.set(r.work_package_id, [r]);
  }
  return out;
}

/** Per-WP material + labour rows over the existing spend atoms, sorted by code.
 *  Atoms bound to a WP not in `wps` are dropped (project-scope mismatch guard). */
export function buildWpCostRows(input: WpCostInput): WpCostRow[] {
  const prsByWp = groupBy(input.prs);
  const issuesByWp = groupBy(input.issues);
  const returnsByWp = groupBy(input.returns);
  // Supersede anti-join over ALL labor rows BEFORE grouping: a correction can
  // re-snapshot work_package_id, so the superseding row may live in a DIFFERENT
  // WP's group than the row it points at — a per-group anti-join would leave the
  // stale row alive and double-count the day (same ordering as aggregatePayroll,
  // spec 309). aggregateLaborCost re-runs its own filter per group; after this
  // global pass that is a no-op, kept for its tombstone handling.
  const supersededLaborIds = new Set(
    input.laborRows.map((r) => r.superseded_by).filter((id): id is string => id !== null),
  );
  const laborByWp = groupBy(input.laborRows.filter((r) => !supersededLaborIds.has(r.id)));

  const rows = input.wps.map((wp) => {
    const prs = prsByWp.get(wp.id) ?? [];
    const purchases = round2(sumMaterials(prs, input.storedPrIds));
    // The disclosure counter mirrors sumMaterials' basis: spend-status, not
    // store-routed, price never recorded.
    let awaitingPriceCount = 0;
    for (const pr of prs) {
      if (!input.storedPrIds.has(pr.id) && SPEND_STATUSES.has(pr.status) && pr.amount == null) {
        awaitingPriceCount += 1;
      }
    }
    const storeIssues = round2(
      sumStoreIssues(
        (issuesByWp.get(wp.id) ?? []).filter((i) => !input.reversedIssueIds.has(i.id)),
      ),
    );
    const storeReturns = round2(sumStoreReturns(returnsByWp.get(wp.id) ?? []));
    const net = round2(purchases + storeIssues - storeReturns);
    const labour = round2(aggregateLaborCost(laborByWp.get(wp.id) ?? []).total);
    return {
      wpId: wp.id,
      code: wp.code,
      name: wp.name,
      material: { purchases, storeIssues, storeReturns, net, awaitingPriceCount },
      labour,
      laborBudget: input.laborBudgetByWp.get(wp.id) ?? null,
      total: round2(net + labour),
    };
  });
  return rows.sort(compareWpCodes);
}

export interface RentalCostInput {
  /** All settlement rows for the candidate batches (supersede anti-join applied here). */
  settlements: ReadonlyArray<{
    id: string;
    agreementId: string;
    net: number;
    supersededBy: string | null;
  }>;
  /** Rental agreements; a cancelled (voided) batch's settlements never count.
   *  Status pinned to the enum so a renamed/added void-state is a type error
   *  here, not a silently-counted reversed batch. */
  batches: ReadonlyArray<{
    id: string;
    status: Database["public"]["Enums"]["rental_agreement_status"];
  }>;
  allocations: ReadonlyArray<{ batchId: string; projectId: string }>;
  projectId: string;
}

export interface RentalCostAttribution {
  /** Settlement net of batches allocated to THIS project only. */
  attributed: number;
  /** Settlement net of batches this project SHARES with others — disclosed,
   *  deliberately unsplit (no invented proration; the rental-GL project
   *  attribution question is its own deferred unit). */
  multiProjectNet: number;
}

/** Equipment at PROJECT grain: current settlement net per §2 (net = base +
 *  overtime + fees, ex-deposit, ADR 0078), routed via equipment_project_allocations.
 *  A batch with NO allocation rows belongs to no project's view by construction
 *  (the loader derives its candidate batches FROM this project's allocations);
 *  its settlements stay on the cross-project /equipment/rentals surface. */
export function attributeRentalCost(input: RentalCostInput): RentalCostAttribution {
  const cancelled = new Set(input.batches.filter((b) => b.status === "cancelled").map((b) => b.id));
  const projectsByBatch = new Map<string, Set<string>>();
  for (const a of input.allocations) {
    const set = projectsByBatch.get(a.batchId);
    if (set) set.add(a.projectId);
    else projectsByBatch.set(a.batchId, new Set([a.projectId]));
  }

  let attributed = 0;
  let multiProjectNet = 0;
  for (const s of currentSettlements(input.settlements)) {
    if (cancelled.has(s.agreementId)) continue;
    const projects = projectsByBatch.get(s.agreementId);
    if (!projects || !projects.has(input.projectId)) continue;
    if (projects.size === 1) attributed += s.net;
    else multiProjectNet += s.net;
  }
  return { attributed: round2(attributed), multiProjectNet: round2(multiProjectNet) };
}

export interface ProjectCostFamilies {
  material: { wpBound: number; storePool: number; total: number };
  execution: { labour: number; equipment: number; total: number };
  grand: number;
}

/** The §2 two-family glance: ค่าวัสดุ (WP-bound net + paid stock still in the
 *  store) vs ค่าดำเนินการ (labour + equipment). Disjoint by the dashboard's
 *  no-double-count discipline, so `grand` is a true total. */
export function projectCostFamilies(input: {
  materialWpNet: number;
  storePool: number;
  labourTotal: number;
  equipmentAttributed: number;
}): ProjectCostFamilies {
  const wpBound = round2(input.materialWpNet);
  const storePool = round2(input.storePool);
  const labour = round2(input.labourTotal);
  const equipment = round2(input.equipmentAttributed);
  const materialTotal = round2(wpBound + storePool);
  const executionTotal = round2(labour + equipment);
  return {
    material: { wpBound, storePool, total: materialTotal },
    execution: { labour, equipment, total: executionTotal },
    grand: round2(materialTotal + executionTotal),
  };
}
