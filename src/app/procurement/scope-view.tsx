// Spec 327 U2 — the ขอบเขต view: server wrapper resolving the selected project
// (U1 cookie) and feeding the WP list + supply overlay. Renders ABOVE the scope
// door grid inside ProcurementHubBody until U6 retires the grids. No selection
// → the one-tap picker prompt (§0.4 — a compact form of the dashboard cards;
// selection is never more than one tap away).
//
// Reads (all RLS, counts/dates only — no ฿): projects list (picker + selection
// validation), the selected project's detail (spec-173 read path via
// loadProjectDetail — WPs, category codes), all visible PR rows (filtered to
// this project by ADR-0065 anchor OR project_id), and the project's
// supply-plan line WP set (lines carry no project_id — join through
// supply_plans, the supply-plan page pattern).

import Link from "next/link";

import { ScopeWpList, type ScopeWpItem } from "@/components/features/purchasing/scope-wp-list";
import { createClient } from "@/lib/db/server";
import { loadProjectDetail } from "@/lib/projects/load-detail";
import { anchorWorkPackageId } from "@/lib/purchasing/late-risk";
import { resolveSelectedProject } from "@/lib/purchasing/procurement-project";
import { readProcurementProjectCookie } from "@/lib/purchasing/procurement-project.server";
import { buildWpSupplyOverlay } from "@/lib/purchasing/wp-supply-overlay";
import { setProcurementProject } from "./actions";

function ScopePickerPrompt({
  projects,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-body text-ink-secondary font-semibold">เลือกโครงการเพื่อดูขอบเขตงาน</h2>
      <div className="flex flex-col gap-2">
        {projects.map((p) => (
          <form key={p.id} action={setProcurementProject.bind(null, p.id)}>
            <button
              type="submit"
              className="rounded-card shadow-card border-edge bg-card text-ink hover:bg-sunk flex min-h-11 w-full items-center gap-3 border px-4 py-3 text-left"
            >
              <span className="text-body min-w-0 flex-1 truncate font-semibold">{p.name}</span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}

export async function ScopeView() {
  const supabase = await createClient();
  const { data: projectRows } = await supabase.from("projects").select("id, name").order("name");
  const projects = projectRows ?? [];
  const selected = resolveSelectedProject(
    await readProcurementProjectCookie(),
    projects.map((p) => p.id),
  );
  if (!selected) return <ScopePickerPrompt projects={projects} />;
  const selectedName = projects.find((p) => p.id === selected)?.name ?? "";

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_id, project_lead_id, project_type")
    .eq("id", selected)
    .maybeSingle();
  if (!project) return <ScopePickerPrompt projects={projects} />;

  const [detail, { data: prRows }, { data: planRows }] = await Promise.all([
    loadProjectDetail(supabase, project, false),
    supabase
      .from("purchase_requests")
      .select("project_id, status, eta, work_package_id, requested_from_work_package_id"),
    supabase.from("supply_plans").select("id").eq("project_id", selected),
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

  const wpItems: ScopeWpItem[] = detail.workPackages.map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    status: w.status,
    isGroup: w.is_group,
    parentId: w.parent_id,
    plannedStart: w.planned_start,
    categoryCode: w.category_id ? (detail.categoryCodeById.get(w.category_id) ?? null) : null,
  }));

  // This project's PR rows: project_id matches, OR the ADR-0065 anchor lands on
  // one of its WPs (store-bound rows have project_id NULL). Rows matching by
  // project_id whose anchor is unknown fall into the overlay's project bucket.
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
      <div className="flex items-center gap-3">
        <h2 className="text-body text-ink min-w-0 flex-1 truncate font-semibold">{selectedName}</h2>
        <Link href="/procurement" className="text-action text-meta shrink-0 underline">
          เปลี่ยนโครงการ
        </Link>
      </div>
      <ScopeWpList
        projectId={selected}
        wps={wpItems}
        overlay={byWp}
        projectBucket={projectBucket}
      />
    </div>
  );
}
