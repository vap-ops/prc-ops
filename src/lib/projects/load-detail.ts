// Spec 147 U2 — project-detail data loader. The page formerly ran its reads in a
// serial waterfall (project → client+members → names → work_packages →
// deliverables → deps → onboarding+sources → templates). The child reads depend
// only on the project, so they batch into one Promise.all (root already fetched
// by the page) → dependent tail (names need the member ids; deps need the wp ids).
// Behavior-preserving: same queries, same column lists, same results — only the
// scheduling changes. Mirrors loadWorkPackageDetail (U1). Concurrency is locked
// by tests/unit/load-project-detail.test.ts.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { criticalWorkPackageIds } from "@/lib/work-packages/critical-path";

type Tbl = Database["public"]["Tables"];
type Db = SupabaseClient<Database>;

type WpListRow = Pick<
  Tbl["work_packages"]["Row"],
  | "id"
  | "code"
  | "name"
  | "status"
  | "deliverable_id"
  | "contractor_id"
  | "priority"
  | "planned_start"
  | "planned_end"
>;
type DeliverableRow = Pick<Tbl["deliverables"]["Row"], "id" | "code" | "name" | "sort_order">;
type SourceProjectRow = Pick<Tbl["projects"]["Row"], "id" | "code" | "name">;
type OnboardingStatusRow =
  Database["public"]["Functions"]["project_onboarding_status"]["Returns"][number];

// The fields the loader reads off the already-fetched project row.
type ProjectInput = Pick<
  Tbl["projects"]["Row"],
  "id" | "client_id" | "project_lead_id" | "project_type"
>;

export interface ProjectDetailData {
  clientName: string | null;
  leadName: string | null;
  memberNames: string[];
  workPackages: WpListRow[];
  deliverables: DeliverableRow[];
  criticalIds: Set<string>;
  onboarding: OnboardingStatusRow | null;
  sourceProjects: SourceProjectRow[];
  templateAvailable: boolean;
}

export async function loadProjectDetail(
  supabase: Db,
  project: ProjectInput,
  isPmRole: boolean,
): Promise<ProjectDetailData> {
  // The fan: every read depends only on the project, never on a sibling read.
  // PM-only reads (onboarding / copy-from sources / template availability) join
  // the same batch so PMs pay no extra serial round-trips.
  const [
    clientRes,
    { data: memberRows },
    { data: workPackages },
    { data: deliverables },
    onbRes,
    srcRes,
    templateRes,
  ] = await Promise.all([
    project.client_id
      ? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("project_members").select("user_id").eq("project_id", project.id),
    supabase
      .from("work_packages")
      .select(
        "id, code, name, status, deliverable_id, contractor_id, priority, planned_start, planned_end",
      )
      .eq("project_id", project.id)
      .order("code", { ascending: true }),
    supabase
      .from("deliverables")
      .select("id, code, name, sort_order")
      .eq("project_id", project.id)
      .order("sort_order", { ascending: true }),
    isPmRole
      ? supabase.rpc("project_onboarding_status", { p_project_id: project.id })
      : Promise.resolve({ data: null }),
    isPmRole
      ? supabase
          .from("projects")
          .select("id, code, name")
          .neq("id", project.id)
          .order("code", { ascending: true })
      : Promise.resolve({ data: [] as SourceProjectRow[] }),
    isPmRole && project.project_type
      ? supabase
          .from("wp_templates")
          .select("id", { count: "exact", head: true })
          .eq("project_type", project.project_type)
      : Promise.resolve({ count: 0 }),
  ]);

  const clientName = clientRes.data?.name ?? null;
  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  const wpRows = workPackages ?? [];
  const wpIds = wpRows.map((wp) => wp.id);

  // Dependent tail: display names need the lead + member ids; the critical-path
  // dependency rows need the wp ids. Independent of each other → batch.
  const nameIds = [
    ...new Set([...(project.project_lead_id ? [project.project_lead_id] : []), ...memberIds]),
  ];
  const [names, depRes] = await Promise.all([
    nameIds.length
      ? fetchDisplayNames(nameIds, "[project-page]")
      : Promise.resolve(new Map<string, string>()),
    wpIds.length
      ? supabase
          .from("work_package_dependencies")
          .select("predecessor_id, successor_id")
          .in("predecessor_id", wpIds)
      : Promise.resolve({ data: [] as { predecessor_id: string; successor_id: string }[] }),
  ]);

  const leadName = project.project_lead_id ? (names.get(project.project_lead_id) ?? null) : null;
  const memberNames = memberIds
    .map((id) => names.get(id) ?? null)
    .filter((n): n is string => n !== null);

  const criticalIds = criticalWorkPackageIds(
    wpRows.map((wp) => ({ id: wp.id, plannedStart: wp.planned_start, plannedEnd: wp.planned_end })),
    (depRes.data ?? []).map((d) => ({
      predecessorId: d.predecessor_id,
      successorId: d.successor_id,
    })),
  );

  return {
    clientName,
    leadName,
    memberNames,
    workPackages: wpRows,
    deliverables: deliverables ?? [],
    criticalIds,
    onboarding: onbRes.data?.[0] ?? null,
    sourceProjects: srcRes.data ?? [],
    templateAvailable: (templateRes.count ?? 0) > 0,
  };
}
