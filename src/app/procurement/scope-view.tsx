// Spec 327 U2 — the ขอบเขต view: server wrapper resolving the selected project
// (U1 cookie) and feeding the WP list + supply overlay. Renders ABOVE the scope
// door grid inside ProcurementHubBody until U6 retires the grids. No selection
// → the one-tap picker prompt (§0.4 — a compact form of the dashboard cards;
// selection is never more than one tap away).
//
// Reads (counts/dates only — no ฿): projects list (picker + selection
// validation), the selected project's WPs (the spec-173 list select shape,
// load-detail.ts), its PR rows (project_id matches OR project_id IS NULL with
// the ADR-0065 anchor landing on a project WP — store-bound rows carry a null
// project_id, so the two-arm .or() is the cheap server-side filter), and the
// project's supply-plan line WP set (lines carry no project_id — join through
// supply_plans, the supply-plan page pattern).
//
// Category codes read via the RLS server client: project_categories' SELECT
// policy carries the procurement arm since migration 075814 (mirrors
// work_packages), so the spec-277 letter/color/icon resolves for this view's
// audience without the former admin-client seam.

import { ProcurementProjectHeader } from "@/components/features/purchasing/procurement-project-header";
import { ScopeWpList, type ScopeWpItem } from "@/components/features/purchasing/scope-wp-list";
import { createClient } from "@/lib/db/server";
import { anchorWorkPackageId } from "@/lib/purchasing/late-risk";
import { resolveSelectedProject } from "@/lib/purchasing/procurement-project";
import { readProcurementProjectCookie } from "@/lib/purchasing/procurement-project.server";
import { buildWpSupplyOverlay } from "@/lib/purchasing/wp-supply-overlay";
import { ProjectPickerPrompt } from "./project-picker-prompt";

/** wpId → reconciled W0x code, via the RLS server client (see module note). */
async function loadCategoryCodeByWp(projectId: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_packages")
    .select("id, project_categories ( work_categories ( code ) )")
    .eq("project_id", projectId);
  const map = new Map<string, string>();
  for (const w of data ?? []) {
    const rel = w.project_categories?.work_categories;
    const code = (Array.isArray(rel) ? rel[0]?.code : rel?.code) ?? null;
    if (code) map.set(w.id, code);
  }
  return map;
}

export async function ScopeView() {
  const supabase = await createClient();
  const { data: projectRows } = await supabase.from("projects").select("id, name").order("name");
  const projects = projectRows ?? [];
  const selected = resolveSelectedProject(
    await readProcurementProjectCookie(),
    projects.map((p) => p.id),
  );
  if (!selected)
    return <ProjectPickerPrompt heading="เลือกโครงการเพื่อดูขอบเขตงาน" projects={projects} />;
  const selectedName = projects.find((p) => p.id === selected)?.name ?? "";

  const [{ data: wpRows }, { data: prRows }, { data: planRows }, categoryCodeByWp] =
    await Promise.all([
      supabase
        .from("work_packages")
        .select("id, code, name, status, planned_start, is_group, parent_id")
        .eq("project_id", selected)
        .order("code", { ascending: true }),
      supabase
        .from("purchase_requests")
        .select("project_id, status, eta, work_package_id, requested_from_work_package_id")
        .or(`project_id.eq.${selected},project_id.is.null`),
      supabase.from("supply_plans").select("id").eq("project_id", selected),
      loadCategoryCodeByWp(selected),
    ]);

  const planIds = (planRows ?? []).map((p) => p.id);
  const { data: lineRows } =
    planIds.length > 0
      ? await supabase
          .from("supply_plan_lines")
          .select("work_package_id")
          .in("supply_plan_id", planIds)
      : { data: null };
  const planWpIds = new Set(
    (lineRows ?? []).map((l) => l.work_package_id).filter((id): id is string => id !== null),
  );

  const wpItems: ScopeWpItem[] = (wpRows ?? []).map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    status: w.status,
    isGroup: w.is_group,
    parentId: w.parent_id,
    plannedStart: w.planned_start,
    categoryCode: categoryCodeByWp.get(w.id) ?? null,
  }));

  // Keep rows belonging to this project: project_id matches, or a store-bound
  // (null-project) row whose ADR-0065 anchor lands on one of its WPs. Null-
  // project rows anchored elsewhere belong to another project's view.
  const wpIdSet = new Set(wpItems.map((w) => w.id));
  const rows = (prRows ?? [])
    .map((r) => ({
      projectId: r.project_id,
      status: r.status,
      eta: r.eta,
      workPackageId: r.work_package_id,
      requestedFromWorkPackageId: r.requested_from_work_package_id,
    }))
    .filter((r) => {
      if (r.projectId === selected) return true;
      const anchor = anchorWorkPackageId(r);
      return anchor !== null && wpIdSet.has(anchor);
    });

  const { byWp, projectBucket } = buildWpSupplyOverlay(
    wpItems.map((w) => ({ id: w.id, plannedStart: w.plannedStart })),
    rows,
    planWpIds,
  );

  return (
    <div className="flex flex-col gap-3">
      <ProcurementProjectHeader
        projectId={selected}
        projectName={selectedName}
        from="/procurement/scope"
      />
      <ScopeWpList
        projectId={selected}
        wps={wpItems}
        overlay={byWp}
        projectBucket={projectBucket}
      />
    </div>
  );
}
