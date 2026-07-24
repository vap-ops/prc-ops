// Spec 350 U2 — pure view-model for the /technician "งานที่ได้รับมอบหมาย" card.
// Maps get_my_assigned_work() rows (U1) to display rows, reusing the ONE progress
// SSOT (deriveDeliverableProgress). No I/O, no React — unit-tested in isolation.

import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";
import type { Database } from "@/lib/db/database.types";
import type { WorkPackageStatus } from "@/lib/db/enums";

type RpcRow = Database["public"]["Functions"]["get_my_assigned_work"]["Returns"][number];
// db:types marks RETURNS TABLE columns non-null, but the RPC's parent_* are NULL
// for a group row (its own parent) and an ungrouped leaf — model the real shape.
export type AssignedWorkRpcRow = Omit<RpcRow, "parent_id" | "parent_code" | "parent_name"> & {
  parent_id: string | null;
  parent_code: string | null;
  parent_name: string | null;
};

export interface AssignedWorkRow {
  wpId: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  /** Progress of the relevant งาน (the row's own children if it is a group, else
   *  its parent's). null when there is no group context (no children → totalCount 0). */
  groupProgress: { percent: number; completeCount: number; totalCount: number } | null;
  /** The parent งาน's name for a leaf row; null for a group or ungrouped row. */
  parentName: string | null;
}

export interface AssignedWorkView {
  /** The team's work_date (today, else the last mustered day); null when empty. */
  workDate: string | null;
  rows: AssignedWorkRow[];
}

export function buildAssignedWorkView(
  rpcRows: ReadonlyArray<AssignedWorkRpcRow>,
): AssignedWorkView {
  const rows: AssignedWorkRow[] = rpcRows.map((r) => {
    const p = deriveDeliverableProgress(r.group_child_statuses);
    return {
      wpId: r.wp_id,
      code: r.code,
      name: r.name,
      status: r.status,
      groupProgress:
        p.totalCount > 0
          ? { percent: p.percent, completeCount: p.completeCount, totalCount: p.totalCount }
          : null,
      parentName: r.is_group ? null : r.parent_name,
    };
  });
  return { workDate: rpcRows[0]?.work_date ?? null, rows };
}
