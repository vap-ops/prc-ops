// Spec 197 U1 — คลัง as a per-project surface. The store is no longer a global
// /settings drill-down reached through a project picker; it is a project
// sub-route reached from the project-detail chip row (like ตารางงาน / แผนจัดหา).
// projectId comes from the route, so the picker disappears and RLS already
// scopes the viewer. Gated to WP_DETAIL_ROLES — the same set that can open a
// project's WPs — which finally admits site_admin (the on-site storekeeper),
// the headline access change. Within the page each action keeps its own gate
// (รับเข้า = the record_stock_in RPC, ตรวจนับ = site staff, P&L = super/director;
// เบิก is no longer a store-console action — spec 208 moved it to the WP-detail
// เบิกของ tab).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { SITE_STAFF_ROLES, SUPPLY_PLAN_ROLES, WP_DETAIL_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { projectHref, supplyPlanHref } from "@/lib/nav/project-paths";
import {
  StoreManager,
  type CatalogPick,
  type CountRow,
  type ReceiptRow,
  type StockRow,
} from "@/components/features/store/store-manager";
import {
  StoreCountManager,
  type CountStockRow,
} from "@/components/features/store/store-count-manager";
import { StorePnlView, type StorePnlRow } from "@/components/features/store/store-pnl-view";
import {
  DivertToStoreList,
  type DivertLine,
} from "@/components/features/store/divert-to-store-list";
import { toDivertLines } from "@/lib/store/divert-lines";
import { loadCatalogCategories, categoryNameById } from "@/lib/catalog/categories";
import { STORE_LABEL } from "@/lib/i18n/labels";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: STORE_LABEL };

export default async function ProjectStorePage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(WP_DETAIL_ROLES);
  const supabase = await createClient();

  // RLS scopes the viewer to projects they can see; a hidden/absent project 404s.
  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  // เบิก (issue-out) follows the issue_stock RPC gate (SITE_STAFF): site_admin +
  // the PM tier issue; procurement reaches the page (WP_DETAIL_ROLES) read-only.
  const canIssue = SITE_STAFF_ROLES.includes(ctx.role);
  // Store P&L (the margin view) is super_admin / project_director — the store_pnl
  // RPC's money gate (mirrors wp_profit). Procurement/PM/SA never see it.
  const canSeePnl = ctx.role === "super_admin" || ctx.role === "project_director";
  // Spec 197 U3: the empty-store state points at แผนจัดหา as a second way to fill
  // the store — a link only when the viewer can reach the supply plan
  // (SUPPLY_PLAN_ROLES; site_admin can't plan, so for them it stays plain text).
  const canPlanSupply = SUPPLY_PLAN_ROLES.includes(ctx.role);

  // Perf debt rank 4 (architecture audit 2026-06): these reads used to run as a
  // serial waterfall. All are independent given project.id, so they ride ONE
  // Promise.all (the spec 147 U1 pattern); the two follow-up reads that depend
  // on a first-batch result run in a second, smaller batch below. Same
  // queries/columns/results — only the scheduling changes.
  const [
    { data: ohRows },
    // Spec 221 cleanup — the รับเข้า item picker reads the managed category (id +
    // name) so user-created categories group + label correctly; the item_category
    // enum is no longer read here.
    categories,
    { data: catRows },
    { data: supRows },
    { data: receiptRows },
    { data: countRows },
    // Spec 198 U2 / ADR 0064: delivered WP-bound catalogued lines not yet diverted
    // — the storekeeper can move them into store stock (cost transfers WP-WIP →
    // Inventory). SITE_STAFF only (the divert RPC gate); procurement is read-only.
    { data: prRows },
    // Store P&L rows — only for the roles that may see them (canSeePnl gate above).
    { data: pnl },
  ] = await Promise.all([
    supabase
      .from("stock_on_hand")
      .select(
        "catalog_item_id, qty_on_hand, total_value, catalog_items ( base_item, spec_attrs, unit )",
      )
      .eq("project_id", project.id),
    loadCatalogCategories(supabase),
    supabase
      .from("catalog_items")
      .select("id, category_id, base_item, spec_attrs, unit")
      .eq("is_active", true)
      .order("base_item", { ascending: true }),
    supabase.from("suppliers").select("id, name").order("name", { ascending: true }),
    supabase
      .from("stock_receipts")
      .select("id, qty, unit, unit_cost, catalog_items ( base_item, spec_attrs )")
      .eq("project_id", project.id)
      .order("received_at", { ascending: false })
      .limit(10),
    supabase
      .from("stock_counts")
      .select("id, counted_qty, variance, unit, catalog_items ( base_item, spec_attrs )")
      .eq("project_id", project.id)
      .order("counted_at", { ascending: false })
      .limit(10),
    canIssue
      ? supabase
          .from("purchase_requests")
          .select(
            "id, quantity, unit, amount, catalog_items ( base_item, spec_attrs ), work_packages!work_package_id ( code, name )",
          )
          .eq("project_id", project.id)
          .eq("status", "delivered")
          .not("work_package_id", "is", null)
          .not("catalog_item_id", "is", null)
          .order("delivered_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null }),
    canSeePnl
      ? supabase.rpc("store_pnl", { p_project_id: project.id })
      : Promise.resolve({ data: null }),
  ]);

  const onHand: StockRow[] = (ohRows ?? [])
    .map((r) => ({
      catalogItemId: r.catalog_item_id,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.catalog_items?.unit ?? "",
      qtyOnHand: Number(r.qty_on_hand),
      totalValue: Number(r.total_value),
    }))
    .sort((a, b) => a.baseItem.localeCompare(b.baseItem, "th"));

  const categoryName = categoryNameById(categories);
  const catalogItems: CatalogPick[] = (catRows ?? []).map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_id ? (categoryName.get(r.category_id) ?? "") : "",
    baseItem: r.base_item,
    specAttrs: r.spec_attrs,
    unit: r.unit,
  }));

  const suppliers = (supRows ?? []).map((s) => ({ id: s.id, name: s.name }));

  const receipts: ReceiptRow[] = (receiptRows ?? []).map((r) => ({
    id: r.id,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.unit,
    qty: Number(r.qty),
    unitCost: Number(r.unit_cost),
  }));

  const counts: CountRow[] = (countRows ?? []).map((r) => ({
    id: r.id,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.unit,
    countedQty: Number(r.counted_qty),
    variance: Number(r.variance),
  }));

  // Second batch: the divert set (needs the delivered-PR ids) and the P&L item
  // names (needs the P&L rows) — independent of each other.
  const prIds = (prRows ?? []).map((r) => r.id);
  const pnlItemIds = (pnl ?? []).map((r) => r.catalog_item_id);
  const [{ data: srRows }, { data: nameRows }] = await Promise.all([
    prIds.length > 0
      ? supabase
          .from("stock_receipts")
          .select("purchase_request_id")
          .in("purchase_request_id", prIds)
      : Promise.resolve({ data: null }),
    pnlItemIds.length > 0
      ? supabase.from("catalog_items").select("id, base_item, spec_attrs").in("id", pnlItemIds)
      : Promise.resolve({ data: null }),
  ]);

  let divertLines: DivertLine[] = [];
  if (canIssue) {
    const diverted = new Set<string>();
    for (const s of srRows ?? []) if (s.purchase_request_id) diverted.add(s.purchase_request_id);
    divertLines = toDivertLines(prRows ?? [], diverted);
  }

  let pnlRows: StorePnlRow[] = [];
  if (canSeePnl) {
    const nameMap = new Map<string, { base_item: string; spec_attrs: string | null }>();
    for (const n of nameRows ?? []) nameMap.set(n.id, n);
    pnlRows = (pnl ?? [])
      .map((r) => {
        const meta = nameMap.get(r.catalog_item_id);
        return {
          catalogItemId: r.catalog_item_id,
          baseItem: meta?.base_item ?? "",
          specAttrs: meta?.spec_attrs ?? null,
          qtyIssued: Number(r.qty_issued),
          costTotal: Number(r.cost_total),
          sellTotal: Number(r.sell_total),
          margin: Number(r.margin),
          shrinkageValue: Number(r.shrinkage_value),
        };
      })
      .sort((a, b) => a.baseItem.localeCompare(b.baseItem, "th"));
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปโครงการ">
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            {STORE_LABEL} — {project.name}
          </h1>
        </div>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <StoreManager
          projects={[{ id: project.id, code: project.code, name: project.name }]}
          selectedProjectId={project.id}
          hidePicker
          onHand={onHand}
          catalogItems={catalogItems}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          suppliers={suppliers}
          canIssue={canIssue}
          receipts={receipts}
          counts={counts}
          emptyStateSupplyPlanHref={canPlanSupply ? supplyPlanHref(project.id) : null}
        />
        {/* Spec 198 U2: move delivered WP-bound lines into the store (cost
            transfer). Renders nothing when there are none. */}
        <DivertToStoreList lines={divertLines} />
        {/* Spec 197 U2: ตรวจนับทั้งคลัง — the full-stocktake pass (the relocated
            /stock-count count-list), behind a toggle so it does not compete with
            the per-row spot count above. Same SITE_STAFF gate as the spot count
            (record_stock_count); the project comes from the route (hidePicker).
            Spec 197 U3: suppressed while the store is empty — counting zero items
            is meaningless; the empty state leads with รับเข้า instead. */}
        {canIssue && onHand.length > 0 ? (
          <StoreCountManager
            projects={[{ id: project.id, code: project.code, name: project.name }]}
            selectedProjectId={project.id}
            onHand={onHand.map(
              (r): CountStockRow => ({
                catalogItemId: r.catalogItemId,
                baseItem: r.baseItem,
                specAttrs: r.specAttrs,
                unit: r.unit,
                qtyOnHand: r.qtyOnHand,
              }),
            )}
            hidePicker
            collapsible
          />
        ) : null}
        {canSeePnl ? <StorePnlView rows={pnlRows} /> : null}
      </div>
    </PageShell>
  );
}
