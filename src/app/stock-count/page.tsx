// Spec 178 B2 — /stock-count: the site_admin stock-count surface. site_admin keeps
// the on-site store but cannot reach /store (BACK_OFFICE-gated). This count-ONLY
// surface (gated SITE_STAFF_ROLES — site_admin + the PM tier) lets them reconcile
// the store: pick a project → see its on-hand → ตรวจนับ each item. A settings
// drill-down (DetailHeader back → /settings, no HubNav), like /store.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import {
  StoreCountManager,
  type CountStockRow,
} from "@/components/features/store/store-count-manager";
import { STOCK_COUNT_LABEL } from "@/lib/i18n/labels";

interface PageProps {
  searchParams: Promise<{ project?: string }>;
}

export const metadata = { title: STOCK_COUNT_LABEL };

export default async function StockCountPage({ searchParams }: PageProps) {
  const ctx = await requireRole(SITE_STAFF_ROLES);
  const { project } = await searchParams;
  const supabase = await createClient();

  // Projects the viewer can see (RLS: site_admin/PM = members, super/director all).
  const { data: projRows } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code", { ascending: true });
  const projects = (projRows ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name }));

  const selectedProjectId = project && projects.some((p) => p.id === project) ? project : null;

  let onHand: CountStockRow[] = [];
  if (selectedProjectId) {
    const { data: ohRows } = await supabase
      .from("stock_on_hand")
      .select("catalog_item_id, qty_on_hand, catalog_items ( base_item, spec_attrs, unit )")
      .eq("project_id", selectedProjectId);
    onHand = (ohRows ?? [])
      .map((r) => ({
        catalogItemId: r.catalog_item_id,
        baseItem: r.catalog_items?.base_item ?? "",
        specAttrs: r.catalog_items?.spec_attrs ?? null,
        unit: r.catalog_items?.unit ?? "",
        qtyOnHand: Number(r.qty_on_hand),
      }))
      .sort((a, b) => a.baseItem.localeCompare(b.baseItem, "th"));
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{STOCK_COUNT_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <StoreCountManager
          projects={projects}
          selectedProjectId={selectedProjectId}
          onHand={onHand}
        />
      </div>
    </PageShell>
  );
}
