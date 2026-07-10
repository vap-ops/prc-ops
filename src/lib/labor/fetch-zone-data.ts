// Spec 46 P1 — one fetch path for the labor zone (SA + PM WP pages).
// Explicit column lists ONLY: workers.day_rate and
// labor_logs.day_rate_snapshot have no authenticated grant — a stray
// select("*") here would 42501 the whole page (pinned by the column
// lists below; the pgTAP posture test pins the grant side).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { LaborDisplayRow } from "@/lib/labor/types";
import { currentLaborLogs } from "./current-logs";
import { groupRoster, type GroupedRoster } from "./group-workers";

const RECENT_DATES_SHOWN = 7;

export async function fetchLaborZoneData(
  supabase: SupabaseClient<Database>,
  workPackageId: string,
  // Spec 158 U2: the WP's project, to surface its assigned crew first. The
  // picker still lists everyone (prioritize, don't hide), so this only orders.
  projectId: string,
  // Spec 289 U2: the WP-detail loader already reads a superset of contractors
  // (id, name, phone, status, contractor_category) in the same batch — sharing
  // that promise here removes a duplicate read. Callers without one (the
  // /review WP page) keep the original self-read.
  sharedContractors?: PromiseLike<{ id: string; name: string }[]>,
): Promise<{
  roster: GroupedRoster;
  projectWorkerIds: string[];
  /** Spec 289 U2: the project's active crew ({id, name}, read order) — the
   *  WP-detail เบิก receiver picker reads this instead of its own workers query. */
  projectWorkers: { id: string; name: string }[];
  rows: LaborDisplayRow[];
}> {
  const [{ data: workers }, contractors, { data: logs }] = await Promise.all([
    supabase
      .from("workers")
      // project_id is not money (spec 160 U1) — covered by the column grant.
      .select("id, name, pay_type, contractor_id, active, project_id")
      .order("name", { ascending: true }),
    sharedContractors ??
      supabase
        .from("contractors")
        .select("id, name")
        .then((r) => r.data ?? []),
    supabase
      .from("labor_logs")
      .select(
        "id, work_package_id, worker_id, work_date, day_fraction, worker_name_snapshot, pay_type_snapshot, entered_by, self_logged, superseded_by, correction_reason, created_at, note",
      )
      .eq("work_package_id", workPackageId)
      .order("created_at", { ascending: true }),
  ]);

  const current = currentLaborLogs(logs ?? []);
  const recentDates = new Set(
    [...new Set(current.map((r) => r.work_date))].sort().reverse().slice(0, RECENT_DATES_SHOWN),
  );

  const rows: LaborDisplayRow[] = current
    .filter((r) => recentDates.has(r.work_date))
    .map((r) => ({
      id: r.id,
      workDate: r.work_date,
      workerName: r.worker_name_snapshot,
      // currentLaborLogs filters tombstones, so day_fraction is non-null.
      fraction: r.day_fraction!,
      selfLogged: r.self_logged,
      note: r.note,
    }));

  const roster = groupRoster(
    (workers ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      pay_type: w.pay_type,
      contractor_id: w.contractor_id,
      active: w.active,
    })),
    contractors,
  );
  // Spec 158 U2: the active crew assigned to this WP's project (ids for the
  // labor zone, {id,name} for the เบิก receiver picker — spec 289 U2).
  const projectWorkers = (workers ?? [])
    .filter((w) => w.active && w.project_id === projectId)
    .map((w) => ({ id: w.id, name: w.name }));
  const projectWorkerIds = projectWorkers.map((w) => w.id);
  return { roster, projectWorkerIds, projectWorkers, rows };
}
