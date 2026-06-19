// Spec 148 U3 — project-schedule data loader. The page ran project →
// work_packages → deliverables → dependency rows in series; the first three are
// all projectId-keyed and independent. Collapsed to one Promise.all fan (3) →
// dependent tail (dependency rows need the wp ids; critical path derives from
// both). Behavior-preserving. Mirrors the spec-147 loaders.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { criticalWorkPackageIds } from "@/lib/work-packages/critical-path";

type Db = SupabaseClient<Database>;

export async function loadProjectSchedule(supabase: Db, projectId: string) {
  // The fan: project, work packages, and deliverables are all projectId-keyed.
  const [{ data: project }, { data: workPackages }, { data: deliverables }] = await Promise.all([
    supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle(),
    supabase
      .from("work_packages")
      .select("id, code, name, status, deliverable_id, priority, planned_start, planned_end")
      .eq("project_id", projectId)
      .order("code", { ascending: true }),
    supabase
      .from("deliverables")
      .select("id, code, name, sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true }),
  ]);

  const wpRows = workPackages ?? [];
  const wpIds = wpRows.map((w) => w.id);

  // Dependent tail: finish-to-start dependencies feed the critical path (spec 92).
  const { data: depRows } = wpIds.length
    ? await supabase
        .from("work_package_dependencies")
        .select("predecessor_id, successor_id")
        .in("predecessor_id", wpIds)
    : { data: [] as { predecessor_id: string; successor_id: string }[] };

  const criticalIds = criticalWorkPackageIds(
    wpRows.map((w) => ({ id: w.id, plannedStart: w.planned_start, plannedEnd: w.planned_end })),
    (depRows ?? []).map((d) => ({ predecessorId: d.predecessor_id, successorId: d.successor_id })),
  );

  return {
    project,
    workPackages: wpRows,
    deliverables: deliverables ?? [],
    depRows: depRows ?? [],
    criticalIds,
  };
}
