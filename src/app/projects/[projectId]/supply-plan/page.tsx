// Spec 176 U2 — the supply-plan planning screen for a project. Planner tier
// (PM/super/director); RLS scopes the project read to members (a non-member PM
// gets notFound). Loads the plan (if any), its lines (joined to catalog item +
// WP), and the pickers (active catalog items + the project's WPs).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { SUPPLY_PLAN_ROLES } from "@/lib/auth/role-home";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { projectHref } from "@/lib/nav/project-paths";
import {
  SupplyPlanManager,
  type CatalogPick,
  type PlanLine,
} from "@/components/features/supply-plan/supply-plan-manager";
import {
  SupplyPlanAccuracy,
  type AccuracyRow,
} from "@/components/features/supply-plan/supply-plan-accuracy";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "แผนจัดหา" };

export default async function SupplyPlanPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(SUPPLY_PLAN_ROLES);
  const supabase = await createClient();
  // Spec 181: procurement plans in the PM's stead (add/submit), but the
  // accuracy measure is the PM's — and supply_plan_accuracy stays PM-gated — so
  // the accuracy card is planner-only.
  const isPlanner = ctx.role !== "procurement";

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const { data: plan } = await supabase
    .from("supply_plans")
    .select("id, status")
    .eq("project_id", project.id)
    .maybeSingle();

  let lines: PlanLine[] = [];
  if (plan) {
    const { data: lineRows } = await supabase
      .from("supply_plan_lines")
      .select(
        "id, qty, catalog_items ( base_item, spec_attrs, unit ), work_packages ( code, name )",
      )
      .eq("supply_plan_id", plan.id)
      .order("created_at", { ascending: true });
    const baseLines = (lineRows ?? []).map((r) => ({
      id: r.id,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.catalog_items?.unit ?? "",
      qty: Number(r.qty),
      wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : null,
    }));
    // Spec 181 U4: a line already converted to a PR shows "สร้าง PR แล้ว" and is
    // excluded from selection (idempotent). Procurement/PM read PRs via the
    // privileged purchase_requests SELECT.
    const lineIds = baseLines.map((l) => l.id);
    let convertedSet = new Set<string>();
    if (lineIds.length > 0) {
      const { data: prRows } = await supabase
        .from("purchase_requests")
        .select("supply_plan_line_id")
        .in("supply_plan_line_id", lineIds);
      convertedSet = new Set(
        (prRows ?? []).map((r) => r.supply_plan_line_id).filter((id): id is string => id !== null),
      );
    }
    lines = baseLines.map((l) => ({ ...l, converted: convertedSet.has(l.id) }));
  }

  const { data: catRows } = await supabase
    .from("catalog_items")
    .select("id, category, base_item, spec_attrs, unit")
    .eq("is_active", true)
    .order("base_item", { ascending: true });
  const catalogItems: CatalogPick[] = (catRows ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    baseItem: r.base_item,
    specAttrs: r.spec_attrs,
    unit: r.unit,
  }));

  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name")
    .eq("project_id", project.id)
    .order("code", { ascending: true });
  const workPackages = (wpRows ?? []).map((w) => ({ id: w.id, code: w.code, name: w.name }));

  // Spec 176 U5 — the PM-accuracy measure (planned vs reactive, per WP). The RPC
  // re-enforces planner tier + membership; a non-member never reaches here (the
  // project read above already notFound'd them). Spec 181: planner-only — the RPC
  // is PM-gated and the measure is the PM's, so procurement skips it.
  let accuracy: AccuracyRow[] = [];
  if (isPlanner) {
    const { data: accRows } = await supabase.rpc("supply_plan_accuracy", {
      p_project_id: project.id,
    });
    accuracy = (accRows ?? []).map((r) => ({
      workPackageId: r.work_package_id,
      wpCode: r.wp_code,
      wpName: r.wp_name,
      plannedLines: r.planned_lines,
      plannedQty: Number(r.planned_qty),
      unplannedMiss: r.unplanned_miss,
      fairReactive: r.fair_reactive,
      untagged: r.untagged,
    }));
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปโครงการ">
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            แผนจัดหา — {project.name}
          </h1>
        </div>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <SupplyPlanManager
          projectId={project.id}
          planId={plan?.id ?? null}
          planStatus={plan?.status ?? null}
          // Approver tier: PD/super (separation of duties — the PM submits, the
          // PD approves). The submit/approve RPCs re-enforce this.
          canApprove={ctx.role === "project_director" || ctx.role === "super_admin"}
          lines={lines}
          catalogItems={catalogItems}
          workPackages={workPackages}
        />
      </section>

      {isPlanner ? (
        <section className={`mx-auto ${PAGE_MAX_W} px-5 pb-8`}>
          <SupplyPlanAccuracy rows={accuracy} />
        </section>
      ) : null}
    </PageShell>
  );
}
