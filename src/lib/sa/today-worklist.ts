import "server-only";

// Perf (RUM-aimed TTFB, 2026-07-10). /sa is the worst mobile route (RES75) and its
// แผนวันนี้ worklist is the SA home's default surface, so its serial read chain sets
// the P75 floor. The assembly used to run five sequential reads
// (plan_items → crew → labels → workers → labor); labels, worker names, and today's
// labor are mutually INDEPENDENT (each keys only off the plan-item / crew id-lists), so
// they now load in ONE Promise.all wave. Only plan_items → crew stays serial (crew is
// keyed by plan-item id). Same tables/columns/filters as the former inline code, so the
// assembled WorklistItem[] is byte-identical (pinned by today-worklist.test).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { currentLaborLogs } from "@/lib/labor/current-logs";
import type { WorklistItem } from "@/components/features/sa/daily-plan-worklist";

export interface TodayWorklistDeps {
  supabase: SupabaseClient<Database>;
  /** Today's board(s) for the SA's projects. */
  plans: ReadonlyArray<{ id: string; project_id: string }>;
  /** plan id → project id. */
  planProject: ReadonlyMap<string, string>;
  /** project id → { code, name }. */
  projectsById: ReadonlyMap<string, { code: string; name: string }>;
  /** project_category id → reconciled global work-category code (W0x). */
  categoryCodeById: ReadonlyMap<string, string>;
  /** True when the SA spans >1 project — adds a per-item project label. */
  multiProject: boolean;
  /** Bangkok civil date "YYYY-MM-DD". */
  today: string;
}

/**
 * Assemble today's แผนวันนี้ worklist: each plan item with its WP label, crew, and
 * today's present-set. The three leaf reads (labels / workers / labor) run concurrently.
 */
export async function buildTodayWorklist(deps: TodayWorklistDeps): Promise<WorklistItem[]> {
  const { supabase, plans, planProject, projectsById, categoryCodeById, multiProject, today } =
    deps;
  if (plans.length === 0) return [];

  const { data: planItemRows } = await supabase
    .from("daily_work_plan_items")
    .select("id, plan_id, work_package_id, sort_order")
    .in(
      "plan_id",
      plans.map((p) => p.id),
    )
    .order("sort_order");
  const planItems = planItemRows ?? [];

  const { data: crewRows } = planItems.length
    ? await supabase
        .from("daily_work_plan_crew")
        .select("item_id, worker_id, is_lead")
        .in(
          "item_id",
          planItems.map((i) => i.id),
        )
    : { data: [] };
  const crew = crewRows ?? [];

  const planWpIds = Array.from(new Set(planItems.map((i) => i.work_package_id)));
  const crewWorkerIds = Array.from(new Set(crew.map((c) => c.worker_id)));

  // labels / worker names / today's labor are independent — one concurrent wave.
  const [labelRes, workerRes, laborRes] = await Promise.all([
    planWpIds.length
      ? supabase.from("work_packages").select("id, code, name, category_id").in("id", planWpIds)
      : Promise.resolve({ data: [] }),
    crewWorkerIds.length
      ? supabase.from("workers").select("id, name").in("id", crewWorkerIds)
      : Promise.resolve({ data: [] }),
    planWpIds.length && crewWorkerIds.length
      ? supabase
          .from("labor_logs")
          .select(
            "id, work_package_id, worker_id, work_date, day_fraction, worker_name_snapshot, pay_type_snapshot, entered_by, self_logged, superseded_by, correction_reason, created_at, note",
          )
          .eq("work_date", today)
          .in("work_package_id", planWpIds)
          .in("worker_id", crewWorkerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const labelById = new Map(
    (labelRes.data ?? []).map((w) => [
      w.id,
      { code: w.code, name: w.name, categoryId: w.category_id },
    ]),
  );
  const workerNameById = new Map((workerRes.data ?? []).map((w) => [w.id, w.name]));
  const present = new Set(
    currentLaborLogs(laborRes.data ?? []).map((l) => `${l.work_package_id}:${l.worker_id}`),
  );

  return planItems.map((i) => {
    const label = labelById.get(i.work_package_id);
    const projectCode = projectsById.get(planProject.get(i.plan_id) ?? "")?.code;
    const categoryId = label?.categoryId ?? null;
    return {
      id: i.id,
      workPackageId: i.work_package_id,
      code: label?.code ?? "",
      name: label?.name ?? "",
      categoryCode: (categoryId && categoryCodeById.get(categoryId)) || null,
      ...(multiProject && projectCode ? { projectLabel: projectCode } : {}),
      crew: crew
        .filter((c) => c.item_id === i.id)
        .map((c) => ({
          workerId: c.worker_id,
          name: workerNameById.get(c.worker_id) ?? "",
          present: present.has(`${i.work_package_id}:${c.worker_id}`),
        })),
    };
  });
}
