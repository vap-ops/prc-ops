// Spec 189 U2 — multi-supply-plan list view models. A project may have many
// plans; they are auto-labeled by creation order (no title — operator chose
// numbered/dated). `plans` MUST already be ordered by created_at ascending so
// the #N labels are stable. Date formatting is left to the (server) caller.

import type { Database } from "@/lib/db/database.types";

export type PlanStatus = Database["public"]["Enums"]["supply_plan_status"];

export type SupplyPlanRow = {
  id: string;
  status: PlanStatus;
  createdAt: string;
};

export type SupplyPlanListItem = {
  id: string;
  label: string;
  status: PlanStatus;
  createdAt: string;
  lineCount: number;
  selected: boolean;
};

export function buildPlanList(
  plans: SupplyPlanRow[],
  lineCounts: Record<string, number>,
  selectedId: string | null,
): SupplyPlanListItem[] {
  return plans.map((p, i) => ({
    id: p.id,
    label: `แผน #${i + 1}`,
    status: p.status,
    createdAt: p.createdAt,
    lineCount: lineCounts[p.id] ?? 0,
    selected: p.id === selectedId,
  }));
}
