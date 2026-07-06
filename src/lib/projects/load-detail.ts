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
import { bangkokDateOf } from "@/lib/dates";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { criticalWorkPackageIds } from "@/lib/work-packages/critical-path";
import {
  deriveActuals,
  type ActualsApprovalRow,
  type ActualsLaborRow,
  type ActualsPhotoRow,
} from "@/lib/work-packages/actuals";
import { groupVariancePill, type GroupVariancePill } from "@/lib/work-packages/variance";

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
  | "is_group"
  | "parent_id"
>;
type DeliverableRow = Pick<Tbl["deliverables"]["Row"], "id" | "code" | "name" | "sort_order">;
// Spec 207 U3 — the project's work-category taxonomy (หมวดงาน) for the manager.
type ProjectCategoryRow = Pick<
  Tbl["project_categories"]["Row"],
  "id" | "code" | "name" | "sort_order" | "is_active"
>;
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
  categories: ProjectCategoryRow[];
  criticalIds: Set<string>;
  onboarding: OnboardingStatusRow | null;
  sourceProjects: SourceProjectRow[];
  /** Spec 271 U2a: per-งาน plan-vs-actual pill, derived from evidence rows. */
  variancePillByGroup: Record<string, GroupVariancePill>;
}

export async function loadProjectDetail(
  supabase: Db,
  project: ProjectInput,
  isPmRole: boolean,
): Promise<ProjectDetailData> {
  // The fan: every read depends only on the project, never on a sibling read.
  // PM-only reads (onboarding / copy-from sources) join the same batch so PMs
  // pay no extra serial round-trips.
  const [
    clientRes,
    { data: memberRows },
    { data: workPackages },
    { data: deliverables },
    { data: categories },
    onbRes,
    srcRes,
  ] = await Promise.all([
    project.client_id
      ? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("project_members").select("user_id").eq("project_id", project.id),
    supabase
      .from("work_packages")
      .select(
        "id, code, name, status, deliverable_id, contractor_id, priority, planned_start, planned_end, is_group, parent_id",
      )
      .eq("project_id", project.id)
      .order("code", { ascending: true }),
    supabase
      .from("deliverables")
      .select("id, code, name, sort_order")
      .eq("project_id", project.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("project_categories")
      .select("id, code, name, sort_order, is_active")
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
  // Spec 271 U2a: the three evidence feeds join the same dependent batch (they
  // need the wp ids, like the deps read). Supersede/tombstone filtering + the
  // labor entry-lag rule live in the pure libs, not the queries.
  const [names, depRes, photoRes, laborRes, approvalRes] = await Promise.all([
    nameIds.length
      ? fetchDisplayNames(nameIds, "[project-page]")
      : Promise.resolve(new Map<string, string>()),
    wpIds.length
      ? supabase
          .from("work_package_dependencies")
          .select("predecessor_id, successor_id")
          .in("predecessor_id", wpIds)
      : Promise.resolve({ data: [] as { predecessor_id: string; successor_id: string }[] }),
    wpIds.length
      ? supabase
          .from("photo_logs")
          .select(
            "id, work_package_id, storage_path, superseded_by, captured_at_client, created_at, phase",
          )
          .in("work_package_id", wpIds)
      : Promise.resolve({ data: [] as ActualsPhotoRow[] }),
    wpIds.length
      ? supabase
          .from("labor_logs")
          .select("work_package_id, work_date, created_at")
          .in("work_package_id", wpIds)
      : Promise.resolve({ data: [] as ActualsLaborRow[] }),
    wpIds.length
      ? supabase
          .from("approvals")
          .select("work_package_id, decision, decided_at")
          .in("work_package_id", wpIds)
      : Promise.resolve({ data: [] as ActualsApprovalRow[] }),
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

  // Spec 271 U2a: derive per-leaf actuals once, then one pill per งาน over its
  // children. Current-plan lens (baseline lens = U2b); Bangkok "today".
  const actuals = deriveActuals({
    photos: (photoRes.data ?? []) as ActualsPhotoRow[],
    labor: (laborRes.data ?? []) as ActualsLaborRow[],
    approvals: (approvalRes.data ?? []) as ActualsApprovalRow[],
  });
  const todayIso = bangkokDateOf(new Date().toISOString());
  const variancePillByGroup: Record<string, GroupVariancePill> = {};
  for (const g of wpRows.filter((w) => w.is_group)) {
    const children = wpRows.filter((w) => !w.is_group && w.parent_id === g.id);
    if (children.length === 0) continue;
    variancePillByGroup[g.id] = groupVariancePill(
      children.map((c) => {
        const a = actuals.get(c.id);
        return {
          plannedStart: c.planned_start,
          plannedEnd: c.planned_end,
          status: c.status,
          actualStart: a?.actualStart ?? null,
          actualEnd: a?.actualEnd ?? null,
          hasEvidence: a?.hasEvidence ?? false,
        };
      }),
      todayIso,
    );
  }

  return {
    clientName,
    leadName,
    memberNames,
    workPackages: wpRows,
    deliverables: deliverables ?? [],
    categories: categories ?? [],
    criticalIds,
    onboarding: onbRes.data?.[0] ?? null,
    sourceProjects: srcRes.data ?? [],
    variancePillByGroup,
  };
}
