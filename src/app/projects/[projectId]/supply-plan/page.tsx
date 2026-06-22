// Spec 176 U2 — the supply-plan planning screen for a project. Planner tier
// (PM/super/director); RLS scopes the project read to members (a non-member PM
// gets notFound). Loads the plan (if any), its lines (joined to catalog item +
// WP), and the pickers (active catalog items + the project's WPs).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { PM_ROLES } from "@/lib/auth/role-home";
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

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "แผนจัดหา" };

export default async function SupplyPlanPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createClient();

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
    lines = (lineRows ?? []).map((r) => ({
      id: r.id,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.catalog_items?.unit ?? "",
      qty: Number(r.qty),
      wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : null,
    }));
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
          planStatus={plan?.status ?? null}
          lines={lines}
          catalogItems={catalogItems}
          workPackages={workPackages}
        />
      </section>
    </PageShell>
  );
}
