// Spec 385 U3a — /equipment/catalog: the ทะเบียนเครื่องมือ page. TYPE grain —
// one row per SKU, curated by the back office (the same audience the
// equipment_catalog_items write policies admit). The per-unit registry stays on
// /equipment; the ข้อมูลหลัก hub's ทะเบียนอุปกรณ์ + หมวดอุปกรณ์ doors both land
// HERE now (they used to dump into the item page — the operator's "mixed up"
// report, 2026-07-31).
//
// Reads are COLUMN-PROJECTED: equipment_catalog_items is column-granted and
// default_daily_rate has NO authenticated grant, so a select("*") would refuse
// the whole read (the worker_level_rates class). No money renders here — the
// rate editor is U3b's DEFINER seam.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { safeBackHref } from "@/lib/nav/back-href";
import { EQUIPMENT_CATALOG_LABEL } from "@/lib/i18n/labels";
import {
  EquipmentCatalogManager,
  type CatalogSkuRowData,
} from "@/components/features/equipment/equipment-catalog-manager";

export const metadata = { title: EQUIPMENT_CATALOG_LABEL };

// Multi-parent: reached from the ข้อมูลหลัก hub (?from threaded by the board),
// /settings (its entry href carries ?from) and the /equipment door — back chip
// resolves ?from, else the domain home /equipment. ?open=categories deep-links
// the หมวดเครื่องมือ sheet.
export default async function EquipmentCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; open?: string }>;
}) {
  const { from, open } = await searchParams;
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const [{ data: skuRows }, { data: categoryRows }] = await Promise.all([
    supabase
      .from("equipment_catalog_items")
      .select("id, name, category_id, brand, model, default_tracking, is_active")
      .order("name", { ascending: true }),
    supabase.from("equipment_categories").select("id, name").order("name", { ascending: true }),
  ]);

  const skus: CatalogSkuRowData[] = (skuRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    categoryId: s.category_id,
    brand: s.brand,
    model: s.model,
    defaultTracking: s.default_tracking,
    isActive: s.is_active,
  }));

  // The one instance-grain fact this page needs: how many real units stand
  // behind each SKU. PAGED to exhaustion — PostgREST caps a read at db-max-rows
  // (1000 on this project), so a single select would silently undercount past
  // 1000 units (the spec-361 U8 lesson).
  const instanceCounts: Record<string, number> = {};
  const PAGE = 1000;
  for (let start = 0; ; start += PAGE) {
    const { data: fkRows } = await supabase
      .from("equipment_items")
      .select("equipment_catalog_item_id")
      .range(start, start + PAGE - 1);
    for (const row of fkRows ?? []) {
      const ref = row.equipment_catalog_item_id;
      if (!ref) continue;
      instanceCounts[ref] = (instanceCounts[ref] ?? 0) + 1;
    }
    if ((fkRows ?? []).length < PAGE) break;
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/equipment")} backLabel="อุปกรณ์">
        <h1 className="text-title text-ink font-bold tracking-tight">{EQUIPMENT_CATALOG_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <EquipmentCatalogManager
          skus={skus}
          categories={categoryRows ?? []}
          instanceCounts={instanceCounts}
          initialCategoriesOpen={open === "categories"}
        />
      </div>
    </PageShell>
  );
}
