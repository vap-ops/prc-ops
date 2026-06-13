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
): Promise<{ roster: GroupedRoster; rows: LaborDisplayRow[] }> {
  const [{ data: workers }, { data: contractors }, { data: logs }] = await Promise.all([
    supabase
      .from("workers")
      .select("id, name, worker_type, contractor_id, active")
      .order("name", { ascending: true }),
    supabase.from("contractors").select("id, name"),
    supabase
      .from("labor_logs")
      .select(
        "id, work_package_id, worker_id, work_date, day_fraction, worker_name_snapshot, worker_type_snapshot, contractor_id_snapshot, entered_by, self_logged, superseded_by, correction_reason, created_at, note",
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
    (workers ?? []).map((w) => ({ ...w, active: w.active })),
    contractors ?? [],
  );
  return { roster, rows };
}
