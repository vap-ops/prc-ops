// Spec 175 U1 — /catalog: read-only item master (storage / inventory
// foundation). A settings drill-down (DetailHeader back → /settings, no HubNav),
// gated to BACK_OFFICE_ROLES — the back-office curators (PM/super/procurement/
// director), mirroring the suppliers master. Create/edit of items is a later unit.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { CatalogList, type CatalogItem } from "@/components/features/catalog/catalog-list";
import { CATALOG_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: CATALOG_LABEL };

export default async function CatalogPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const { data: rows } = await supabase
    .from("catalog_items")
    .select("id, category, base_item, spec_attrs, unit, stockable")
    .eq("is_active", true)
    .order("base_item", { ascending: true });

  const items: CatalogItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    baseItem: r.base_item,
    specAttrs: r.spec_attrs,
    unit: r.unit,
    stockable: r.stockable,
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{CATALOG_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <CatalogList items={items} />
      </div>
    </PageShell>
  );
}
