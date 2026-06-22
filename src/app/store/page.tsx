// Spec 177 U2 — /store: the on-site store surface. Pick a project, see its on-hand
// stock (qty + value + derived moving-average cost), and record a stock-in
// (รับเข้า) at cost. A settings drill-down (DetailHeader back → /settings, no
// HubNav), gated to BACK_OFFICE_ROLES — the cost-bearing curators (PM/super/
// procurement/director), mirroring /catalog. The store is per-project; the picker
// is RLS-scoped (procurement sees all, PM sees member projects).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import {
  StoreManager,
  type CatalogPick,
  type StockRow,
} from "@/components/features/store/store-manager";
import { STORE_LABEL } from "@/lib/i18n/labels";

interface PageProps {
  searchParams: Promise<{ project?: string }>;
}

export const metadata = { title: STORE_LABEL };

export default async function StorePage({ searchParams }: PageProps) {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const { project } = await searchParams;
  const supabase = await createClient();

  // Projects the viewer can see (RLS: procurement = all, PM/SA = members,
  // super/director = all). This is the store picker.
  const { data: projRows } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code", { ascending: true });
  const projects = (projRows ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name }));

  // Only honour a project the viewer can actually see; else no selection.
  const selectedProjectId = project && projects.some((p) => p.id === project) ? project : null;

  let onHand: StockRow[] = [];
  let catalogItems: CatalogPick[] = [];
  let suppliers: { id: string; name: string }[] = [];

  if (selectedProjectId) {
    const { data: ohRows } = await supabase
      .from("stock_on_hand")
      .select(
        "catalog_item_id, qty_on_hand, total_value, catalog_items ( base_item, spec_attrs, unit )",
      )
      .eq("project_id", selectedProjectId);
    onHand = (ohRows ?? [])
      .map((r) => ({
        catalogItemId: r.catalog_item_id,
        baseItem: r.catalog_items?.base_item ?? "",
        specAttrs: r.catalog_items?.spec_attrs ?? null,
        unit: r.catalog_items?.unit ?? "",
        qtyOnHand: Number(r.qty_on_hand),
        totalValue: Number(r.total_value),
      }))
      .sort((a, b) => a.baseItem.localeCompare(b.baseItem, "th"));

    const { data: catRows } = await supabase
      .from("catalog_items")
      .select("id, category, base_item, spec_attrs, unit")
      .eq("is_active", true)
      .order("base_item", { ascending: true });
    catalogItems = (catRows ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      baseItem: r.base_item,
      specAttrs: r.spec_attrs,
      unit: r.unit,
    }));

    const { data: supRows } = await supabase
      .from("suppliers")
      .select("id, name")
      .order("name", { ascending: true });
    suppliers = (supRows ?? []).map((s) => ({ id: s.id, name: s.name }));
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{STORE_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <StoreManager
          projects={projects}
          selectedProjectId={selectedProjectId}
          onHand={onHand}
          catalogItems={catalogItems}
          suppliers={suppliers}
        />
      </div>
    </PageShell>
  );
}
