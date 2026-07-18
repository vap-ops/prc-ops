// Spec 327 U3 — the เวลา view's server loader: the selected project's WP rows
// (the load-detail select shape, project-scoped) + its PR rows via
// PR_LIST_COLUMNS (already carries eta / needed_by / BOTH ADR-0065 anchors —
// and no ฿ column). Same two-arm project filter as the U2 scope view:
// project_id matches OR a store-bound null-project row whose anchor lands on a
// project WP. U4's timeline reuses this loader's return unchanged.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { anchorWorkPackageId } from "./late-risk";
import { PR_LIST_COLUMNS } from "./columns";
import type { TimePrRow, TimeWpRow } from "./time-view";

export interface TimeViewWp extends TimeWpRow {
  code: string;
  isGroup: boolean;
}

export interface LoadTimeViewData {
  wps: TimeViewWp[];
  prRows: TimePrRow[];
}

export async function loadTimeViewData(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<LoadTimeViewData> {
  const [{ data: wpRows }, { data: prRows }] = await Promise.all([
    supabase
      .from("work_packages")
      .select("id, code, name, planned_start, planned_end, is_group")
      .eq("project_id", projectId)
      .order("code", { ascending: true }),
    supabase
      .from("purchase_requests")
      .select(PR_LIST_COLUMNS)
      .or(`project_id.eq.${projectId},project_id.is.null`),
  ]);

  const wps: TimeViewWp[] = (wpRows ?? []).map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    plannedStart: w.planned_start,
    plannedEnd: w.planned_end,
    isGroup: w.is_group,
  }));

  const wpIdSet = new Set(wps.map((w) => w.id));
  const rows: TimePrRow[] = (prRows ?? [])
    .map((r) => ({
      id: r.id,
      prNumber: r.pr_number,
      itemDescription: r.item_description,
      status: r.status,
      eta: r.eta,
      workPackageId: r.work_package_id,
      requestedFromWorkPackageId: r.requested_from_work_package_id,
      projectId: r.project_id,
    }))
    .filter((r) => {
      if (r.projectId === projectId) return true;
      const anchor = anchorWorkPackageId(r);
      return anchor !== null && wpIdSet.has(anchor);
    });

  return { wps, prRows: rows };
}
