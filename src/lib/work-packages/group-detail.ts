// Spec 270 U4 — pure งาน-level money summary over one group's งานย่อย set.
// The dashboard wpLevel formula scoped to a leaf set: materials (spend-status
// PRs minus store-routed ids) + เบิก (non-reversed stock_issues at cost) −
// WP→store returns (the spec-209 double-count trap: a return restores on-hand
// value while its issue stays non-reversed, so its cost must be netted out —
// mirrors wp_profit / the dashboard fix in #180). Labor rides as its own
// figure (aggregateLaborCost upstream). Pure — no I/O; round2 = money SSOT.

import { round2 } from "@/lib/format";
import { sumMaterials, sumStoreIssues, sumStoreReturns } from "@/lib/dashboard/spend";

export interface GroupSpendInput {
  /** The leaf set's purchase requests (id + status + amount). */
  prs: ReadonlyArray<{ id: string; status: string; amount: number | null }>;
  /** PR ids whose goods entered the store (counted at เบิก instead). */
  storedPrIds: ReadonlySet<string>;
  /** Non-reversed stock issues bound to the leaf set, at cost. */
  issues: ReadonlyArray<{ total_cost: number | null }>;
  /** WP→store returns bound to the leaf set, at cost. */
  returns: ReadonlyArray<{ total_cost: number | null }>;
  /** aggregateLaborCost(leaf labor rows).total. */
  laborTotal: number;
}

export interface GroupSpendSummary {
  materials: number;
  storeIssues: number;
  storeReturns: number;
  /** materials + storeIssues − storeReturns — the net material figure. */
  materialNet: number;
  laborTotal: number;
  /** materialNet + laborTotal — the group's leaf-bound spend. */
  total: number;
}

export function groupSpendSummary(input: GroupSpendInput): GroupSpendSummary {
  const materials = round2(sumMaterials(input.prs, input.storedPrIds));
  const storeIssues = round2(sumStoreIssues(input.issues));
  const storeReturns = round2(sumStoreReturns(input.returns));
  const materialNet = round2(materials + storeIssues - storeReturns);
  const laborTotal = round2(input.laborTotal);
  return {
    materials,
    storeIssues,
    storeReturns,
    materialNet,
    laborTotal,
    total: round2(materialNet + laborTotal),
  };
}
