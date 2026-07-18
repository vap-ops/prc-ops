// Spec 327 U5 — the ทรัพยากร view host: resolve the U1 selection, load the
// coverage + equipment data, render the body ABOVE the resources door grid
// (grid retires in U6). No selection → the shared picker prompt.
//
// Reads (counts/qty/dates only — no ฿ column anywhere):
// - RLS: projects list (+ the selected project's planned_completion_date),
//   WPs, APPROVED supply_plans → their lines (catalog_items embed names the
//   items — §0.2), project stock (qty only — total_value NEVER selected),
//   PR rows (status + catalog_item_id; the U2/U3 two-arm project filter).
// - ⚠ ADMIN CLIENT behind the page's requireRole(PROCUREMENT_HOME_ROLES) gate
//   (flagged for review): equipment_project_allocations +
//   equipment_rental_batches are zero-grant money tables (RLS on, zero
//   policies — live pg_policies 2026-07-18); the rentals-page precedent
//   (rentals/page.tsx admin reads). Selected columns are PERIOD/STATUS ONLY —
//   starts_on / ends_on / status; monthly_rate is never selected.

import Link from "next/link";

import { createClient as createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { flagRentalPeriodGaps } from "@/lib/equipment/rental-period-check";
import { anchorWorkPackageId } from "@/lib/purchasing/late-risk";
import { resolveSelectedProject } from "@/lib/purchasing/procurement-project";
import { readProcurementProjectCookie } from "@/lib/purchasing/procurement-project.server";
import {
  buildMaterialCoverage,
  type CoveragePlanLine,
} from "@/lib/purchasing/wp-material-coverage";
import {
  ResourcesBody,
  type CoverageRow,
  type RentalRow,
} from "@/components/features/purchasing/resources-view";
import { ProjectPickerPrompt } from "./project-picker-prompt";

export async function ResourcesView() {
  const supabase = await createClient();
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, name, planned_completion_date")
    .order("name");
  const projects = projectRows ?? [];
  const selected = resolveSelectedProject(
    await readProcurementProjectCookie(),
    projects.map((p) => p.id),
  );
  if (!selected)
    return (
      <ProjectPickerPrompt heading="เลือกโครงการเพื่อดูความพร้อมทรัพยากร" projects={projects} />
    );
  const project = projects.find((p) => p.id === selected);
  const projectEnd = project?.planned_completion_date ?? null;

  const admin = createAdminClient();
  const [{ data: wpRows }, { data: planRows }, { data: stockRows }, { data: prRows }, alloc] =
    await Promise.all([
      supabase
        .from("work_packages")
        .select("id, code, name, is_group")
        .eq("project_id", selected)
        .order("code", { ascending: true }),
      // Approved plans only — the multi-plan draft/rejected double-count trap
      // (U5 decision; the UI captions it).
      supabase
        .from("supply_plans")
        .select("id")
        .eq("project_id", selected)
        .eq("status", "approved"),
      supabase
        .from("stock_on_hand")
        .select("catalog_item_id, qty_on_hand")
        .eq("project_id", selected),
      supabase
        .from("purchase_requests")
        .select(
          "project_id, status, catalog_item_id, work_package_id, requested_from_work_package_id",
        )
        .or(`project_id.eq.${selected},project_id.is.null`),
      admin
        .from("equipment_project_allocations")
        .select("id, batch_id, starts_on, ends_on")
        .eq("project_id", selected),
    ]);

  const planIds = (planRows ?? []).map((p) => p.id);
  const { data: lineRows } =
    planIds.length > 0
      ? await supabase
          .from("supply_plan_lines")
          .select(
            "supply_plan_id, work_package_id, qty, catalog_item_id, catalog_items ( base_item, spec_attrs, unit )",
          )
          .in("supply_plan_id", planIds)
      : { data: null };

  const batchIds = (alloc.data ?? []).map((a) => a.batch_id);
  const { data: batchRows } =
    batchIds.length > 0
      ? await admin
          .from("equipment_rental_batches")
          .select("id, starts_on, ends_on, status")
          .in("id", batchIds)
      : { data: null };

  const wps = wpRows ?? [];
  const wpIdSet = new Set(wps.map((w) => w.id));

  const lines: CoveragePlanLine[] = (lineRows ?? []).flatMap((l) => {
    if (!l.catalog_item_id || !l.catalog_items) return [];
    return [
      {
        workPackageId: l.work_package_id,
        catalogItemId: l.catalog_item_id,
        qty: l.qty,
        baseItem: l.catalog_items.base_item,
        specAttrs: l.catalog_items.spec_attrs,
        unit: l.catalog_items.unit,
      },
    ];
  });

  const coveragePrs = (prRows ?? [])
    .filter((r) => {
      if (r.project_id === selected) return true;
      const anchor = anchorWorkPackageId({
        workPackageId: r.work_package_id,
        requestedFromWorkPackageId: r.requested_from_work_package_id,
      });
      return anchor !== null && wpIdSet.has(anchor);
    })
    .map((r) => ({ status: r.status, catalogItemId: r.catalog_item_id }));

  const { byWp, projectBucket } = buildMaterialCoverage(
    lines,
    (stockRows ?? []).map((s) => ({ catalogItemId: s.catalog_item_id, qtyOnHand: s.qty_on_hand })),
    coveragePrs,
  );

  const coverageRows: CoverageRow[] = wps
    .filter((w) => byWp.has(w.id))
    .map((w) => ({ wp: { id: w.id, code: w.code, name: w.name }, coverage: byWp.get(w.id)! }));
  // Zero-plan-line LEAVES render as ยังไม่มีแผนจัดหา rows (§0.1); งาน group
  // headers aren't plannable units, so they stay out of the no-plan list.
  const noPlanWps = wps
    .filter((w) => !w.is_group && !byWp.has(w.id))
    .map((w) => ({ id: w.id, code: w.code, name: w.name }));

  const batchById = new Map((batchRows ?? []).map((b) => [b.id, b]));
  const rentals: RentalRow[] = flagRentalPeriodGaps(
    (alloc.data ?? []).map((a) => {
      const batch = batchById.get(a.batch_id);
      return {
        id: a.id,
        startsOn: a.starts_on ?? batch?.starts_on ?? null,
        endsOn: a.ends_on ?? batch?.ends_on ?? null,
        status: batch?.status ?? "unknown",
      };
    }),
    projectEnd,
  ).map((r) => ({ id: r.id, startsOn: r.startsOn, endsOn: r.endsOn, gap: r.gap }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-body text-ink min-w-0 flex-1 truncate font-semibold">
          {project?.name ?? ""}
        </h2>
        <Link
          href="/procurement"
          className="text-action text-meta inline-flex min-h-11 shrink-0 items-center underline"
        >
          เปลี่ยนโครงการ
        </Link>
      </div>
      <ResourcesBody
        projectId={selected}
        coverageRows={coverageRows}
        projectBucket={projectBucket}
        noPlanWps={noPlanWps}
        rentals={rentals}
        projectEnd={projectEnd}
      />
    </div>
  );
}
