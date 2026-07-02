// Spec 176 U2 + spec 189 — the supply-plan planning screen for a project. A
// project may have MANY plans (spec 189): this page lists them (auto-labeled by
// creation order), lets the planner create a new one, and opens the selected
// plan (?plan=<id>) in the SupplyPlanManager. Planner tier (PM/super/director) +
// procurement (spec 181); RLS scopes the project read to members.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SUPPLY_PLAN_ROLES } from "@/lib/auth/role-home";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { CATALOG_IMAGES_BUCKET } from "@/lib/storage/buckets";
import {
  loadCatalogCategories,
  categoryNameById,
  loadCatalogItemMemberships,
} from "@/lib/catalog/categories";
import { resolveScopedCategories } from "@/lib/catalog/scoped-categories";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { projectHref, supplyPlanHref } from "@/lib/nav/project-paths";
import {
  SupplyPlanManager,
  PLAN_STATUS_LABEL,
  type CatalogPick,
  type PlanLine,
} from "@/components/features/supply-plan/supply-plan-manager";
import { NewPlanButton } from "@/components/features/supply-plan/new-plan-button";
import {
  CloneTemplateButton,
  type TemplatePick,
} from "@/components/features/supply-plan/clone-template-button";
import { DeletePlanButton } from "@/components/features/supply-plan/delete-plan-button";
import { buildPlanList, type SupplyPlanRow } from "@/lib/supply-plan/plan-list";
import {
  SupplyPlanAccuracy,
  type AccuracyRow,
} from "@/components/features/supply-plan/supply-plan-accuracy";

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ plan?: string }>;
}

export const metadata = { title: "แผนจัดหา" };

const PLAN_DATE_FMT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

export default async function SupplyPlanPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const { plan: planParam } = await searchParams;
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

  // Spec 189: all of the project's plans, oldest first (so the #N labels are
  // stable). Line counts come from a single grouped read.
  const { data: planRows } = await supabase
    .from("supply_plans")
    .select("id, status, created_at, overridden_by")
    .eq("project_id", project.id)
    .order("created_at", { ascending: true });
  const plans: SupplyPlanRow[] = (planRows ?? []).map((p) => ({
    id: p.id,
    status: p.status,
    createdAt: p.created_at,
  }));

  // Spec 245 U2 — the 2 global templates (is_template=true, project_id=null),
  // readable by the same write-tier per the spec 245 U1 RLS branch.
  const { data: templateRows } = await supabase
    .from("supply_plans")
    .select("id, name")
    .eq("is_template", true)
    .order("name", { ascending: true });
  const templates: TemplatePick[] = (templateRows ?? []).map((t) => ({
    id: t.id,
    name: t.name ?? "เทมเพลต",
  }));

  const planIds = plans.map((p) => p.id);
  const lineCounts: Record<string, number> = {};
  if (planIds.length > 0) {
    const { data: countRows } = await supabase
      .from("supply_plan_lines")
      .select("supply_plan_id")
      .in("supply_plan_id", planIds);
    for (const r of countRows ?? []) {
      lineCounts[r.supply_plan_id] = (lineCounts[r.supply_plan_id] ?? 0) + 1;
    }
  }

  // The selected plan must belong to this project; an unknown/absent param
  // selects nothing (the list is shown, prompting a pick).
  const selectedId = planParam && planIds.includes(planParam) ? planParam : null;
  const selectedPlan = selectedId ? plans.find((p) => p.id === selectedId)! : null;
  const planItems = buildPlanList(plans, lineCounts, selectedId);

  // Spec 194: if the selected plan was force-reopened by a super_admin, resolve the
  // overrider's name for the "ปรับแก้โดย …" marker (users.full_name needs the admin
  // client — public.users is read-self, ADR 0011).
  let overriddenByName: string | null = null;
  const selectedOverriddenBy = (planRows ?? []).find((p) => p.id === selectedId)?.overridden_by;
  if (selectedOverriddenBy) {
    const { data: overrider } = await createAdminClient()
      .from("users")
      .select("full_name")
      .eq("id", selectedOverriddenBy)
      .maybeSingle();
    overriddenByName = overrider?.full_name ?? "ผู้ดูแลระบบ";
  }

  let lines: PlanLine[] = [];
  if (selectedPlan) {
    const { data: lineRows } = await supabase
      .from("supply_plan_lines")
      .select(
        "id, qty, catalog_items ( category_id, base_item, spec_attrs, unit ), work_packages ( code, name )",
      )
      .eq("supply_plan_id", selectedPlan.id)
      .order("created_at", { ascending: true });
    const baseLines = (lineRows ?? []).map((r) => ({
      id: r.id,
      // Spec 245 U3: the item's managed category, used to group the line list.
      categoryId: r.catalog_items?.category_id ?? null,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.catalog_items?.unit ?? "",
      qty: Number(r.qty),
      wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : null,
    }));
    // Spec 181 U4: a line already converted to a PR shows "สร้าง PR แล้ว" and is
    // excluded from selection (idempotent).
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

  // Spec 189 follow-up: the supply-plan item picker is the SAME catalog picker as
  // the purchase request, so it needs image_path + signed thumbnail URLs.
  // Spec 221 cleanup: read category_id (the managed FK) + the managed category
  // name, not the vestigial item_category enum.
  const { data: catRows } = await supabase
    .from("catalog_items")
    .select("id, category_id, base_item, spec_attrs, unit, image_path, product_code")
    .eq("is_active", true)
    .order("base_item", { ascending: true });
  const catalogCategories = await loadCatalogCategories(supabase);
  const categoryName = categoryNameById(catalogCategories);
  const catalogCategoryList = catalogCategories.map((c) => ({ id: c.id, name: c.name }));
  const catalogThumbs = await mintSignedUrls(
    CATALOG_IMAGES_BUCKET,
    (catRows ?? []).map((r) => ({ id: r.id, storage_path: r.image_path })),
  );
  const catalogItems: CatalogPick[] = (catRows ?? []).map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_id ? (categoryName.get(r.category_id) ?? "") : "",
    baseItem: r.base_item,
    specAttrs: r.spec_attrs,
    unit: r.unit,
    thumbnailUrl: catalogThumbs.get(r.id) ?? null,
    productCode: r.product_code,
  }));

  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name, project_categories ( work_category_id )")
    .eq("project_id", project.id)
    .order("code", { ascending: true });
  const workPackages = (wpRows ?? []).map((w) => ({ id: w.id, code: w.code, name: w.name }));

  // Spec 228 (ADR 0066 / S7) — scope each WP's item picker to the material
  // categories its work-category buys (Relation R). A WP carries a project
  // category (spec 226 reconcile) whose work_category_id resolves, via the S6
  // resolver, to a set of material category ids. Resolve once per DISTINCT
  // work-category (not per WP — avoids an N+1), then fan onto every WP. WPs with
  // no work-category resolve to nothing → their picker shows the full catalog.
  const wpWorkCategory = new Map<string, string>();
  for (const w of wpRows ?? []) {
    const workCatId = w.project_categories?.work_category_id;
    if (workCatId) wpWorkCategory.set(w.id, workCatId);
  }
  const scopeByWorkCat = new Map<string, string[]>();
  for (const workCatId of new Set(wpWorkCategory.values())) {
    const rels = await resolveScopedCategories(supabase, workCatId);
    const catIds = [...new Set(rels.map((r) => r.categoryId))];
    if (catIds.length > 0) scopeByWorkCat.set(workCatId, catIds);
  }
  const wpScopedCategories: Record<string, string[]> = {};
  for (const [wpId, workCatId] of wpWorkCategory) {
    const catIds = scopeByWorkCat.get(workCatId);
    if (catIds) wpScopedCategories[wpId] = catIds;
  }

  // Spec 228 — the item membership union (canonical + secondary, S4) the scoped
  // picker reads to decide which items fall in a WP's material scope.
  const itemMemberships = await loadCatalogItemMemberships(supabase);

  // Spec 176 U5 — the PM-accuracy measure (planned vs reactive, per WP). It
  // aggregates ALL of a project's plan lines (plan-agnostic), so it is unchanged
  // by multi-plan. Planner-only (the RPC is PM-gated).
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

      {/* Spec 189: the project's plans + create-new. */}
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-3 px-5 py-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-ink text-body font-semibold">แผนทั้งหมด ({planItems.length})</h2>
          <div className="flex flex-wrap items-center gap-3">
            <CloneTemplateButton projectId={project.id} templates={templates} />
            <NewPlanButton projectId={project.id} />
          </div>
        </div>

        {planItems.length === 0 ? (
          <p className="text-ink-secondary text-body">
            ยังไม่มีแผนจัดหา — กด “สร้างแผนใหม่” เพื่อเริ่ม
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {planItems.map((p) => (
              <li key={p.id} className="flex items-stretch gap-2">
                <Link
                  href={`${supplyPlanHref(project.id)}?plan=${p.id}`}
                  aria-current={p.selected ? "true" : undefined}
                  className={`rounded-control flex min-w-0 flex-1 items-center justify-between gap-3 border px-4 py-3 ${
                    p.selected
                      ? "border-action bg-sunk"
                      : "border-edge bg-card hover:border-edge-strong"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-ink text-body block font-semibold">{p.label}</span>
                    <span className="text-ink-secondary text-meta block">
                      {PLAN_DATE_FMT.format(new Date(p.createdAt))} · {p.lineCount} รายการ
                    </span>
                  </span>
                  <span className="bg-page text-ink-secondary text-meta rounded-control shrink-0 px-2 py-1 font-medium">
                    {PLAN_STATUS_LABEL[p.status]}
                  </span>
                </Link>
                {/* Spec 189: a draft/rejected plan can be deleted (submitted/approved are locked). */}
                {p.status === "draft" || p.status === "rejected" ? (
                  <div className="flex items-center">
                    <DeletePlanButton projectId={project.id} planId={p.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The selected plan opens in the manager; otherwise prompt to pick one. */}
      {selectedPlan ? (
        <section className={`mx-auto ${PAGE_MAX_W} px-5 pb-6`}>
          <SupplyPlanManager
            projectId={project.id}
            planId={selectedPlan.id}
            planStatus={selectedPlan.status}
            // Approver tier: PD/super (separation of duties — the PM submits, the
            // PD approves). The submit/approve RPCs re-enforce this.
            canApprove={ctx.role === "project_director" || ctx.role === "super_admin"}
            // Spec 194: super_admin can reopen a frozen plan to edit it.
            canOverride={ctx.role === "super_admin"}
            overriddenByName={overriddenByName}
            lines={lines}
            catalogItems={catalogItems}
            categories={catalogCategoryList}
            workPackages={workPackages}
            itemMemberships={itemMemberships}
            wpScopedCategories={wpScopedCategories}
          />
        </section>
      ) : planItems.length > 0 ? (
        <section className={`mx-auto ${PAGE_MAX_W} px-5 pb-6`}>
          <p className="text-ink-secondary text-body">เลือกแผนด้านบนเพื่อดูหรือแก้ไขรายการ</p>
        </section>
      ) : null}

      {isPlanner ? (
        <section className={`mx-auto ${PAGE_MAX_W} px-5 pb-8`}>
          <SupplyPlanAccuracy rows={accuracy} />
        </section>
      ) : null}
    </PageShell>
  );
}
