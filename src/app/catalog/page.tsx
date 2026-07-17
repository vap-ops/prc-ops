// Spec 175 U1 — /catalog: read-only item master (storage / inventory
// foundation). A settings drill-down (DetailHeader back → /settings, no HubNav),
// gated to BACK_OFFICE_ROLES — the back-office curators (PM/super/procurement/
// director), mirroring the suppliers master. Create/edit of items is a later unit.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { CATALOG_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { safeBackHref } from "@/lib/nav/back-href";
import Link from "next/link";
import { CatalogList, type CatalogItem } from "@/components/features/catalog/catalog-list";
import type { CatalogUnitOption } from "@/components/features/catalog/catalog-item-form";
import {
  loadCatalogCategories,
  loadCatalogItemMemberships,
  membershipsByItem,
} from "@/lib/catalog/categories";
import { AddCatalogItem } from "@/components/features/catalog/add-catalog-item";
import { CATALOG_LABEL, MANAGE_TAXONOMY_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: CATALOG_LABEL };

// Nav-coherence audit 2026-07: multi-parent (settings hub · /procurement Scope
// tile · the PR-raise catalog picker) — back chip resolves ?from, else /settings.
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const { data: rows } = await supabase
    .from("catalog_items")
    .select(
      "id, category_id, base_item, spec_attrs, unit, note, image_path, product_code, subcategory_id, kind, fulfillment_mode, owner_supplied, search_terms, lead_time_days",
    )
    .eq("is_active", true)
    .order("base_item", { ascending: true });

  // Spec 221 U3c — the managed main categories (names + order for the filter + form).
  const categories = await loadCatalogCategories(supabase);

  // Spec 239 U2 — the secondary memberships (catalog_item_categories) for browse-by-
  // union + the edit-form multi-category pre-fill. The primary is on the row itself,
  // so it is stripped from each item's secondary set.
  const memberships = membershipsByItem(await loadCatalogItemMemberships(supabase));

  // Spec 223 (ADR 0066) — the managed unit vocabulary for the item-form picker
  // (active rows; the table is the SSOT, COMMON_UNITS is only an in-code fallback).
  const { data: unitRows } = await supabase
    .from("catalog_units")
    .select("code, display_name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  const units: CatalogUnitOption[] = (unitRows ?? []).map((r) => ({
    code: r.code,
    displayName: r.display_name,
  }));

  // Reads on the private catalog-images bucket go through service-role signed
  // URLs (the rows above were already read under the user's RLS).
  const signed = await mintSignedUrls(
    CATALOG_IMAGES_BUCKET,
    (rows ?? []).map((r) => ({ id: r.id, storage_path: r.image_path })),
  );

  // Spec 178 U5 — the per-item SELL rate is margin-sensitive money (zero
  // authenticated grant), so it is read ONLY for super_admin and ONLY via the
  // admin client (the nova money pattern: read admin, write via the gated RPC).
  const canSetSellRate = ctx.role === "super_admin" || ctx.role === "project_director";
  const sellRates = new Map<string, number>();
  if (canSetSellRate) {
    const admin = createAdminSupabase();
    const { data: rates } = await admin
      .from("item_sell_rates")
      .select("catalog_item_id, sell_rate");
    for (const r of rates ?? []) sellRates.set(r.catalog_item_id, r.sell_rate);
  }

  const items: CatalogItem[] = (rows ?? []).map((r) => {
    // Spec 239 U2 — the secondary set is every membership minus the primary.
    const secondary = [...(memberships.get(r.id) ?? [])].filter((id) => id !== r.category_id);
    return {
      id: r.id,
      categoryId: r.category_id,
      baseItem: r.base_item,
      specAttrs: r.spec_attrs,
      unit: r.unit,
      productCode: r.product_code,
      note: r.note,
      subcategoryId: r.subcategory_id,
      kind: r.kind,
      fulfillmentMode: r.fulfillment_mode,
      ownerSupplied: r.owner_supplied,
      searchTerms: r.search_terms,
      leadTimeDays: r.lead_time_days,
      secondaryCategoryIds: secondary,
      thumbnailUrl: signed.get(r.id) ?? null,
      // Omit the key entirely for non-super (exactOptionalPropertyTypes forbids an
      // explicit `undefined`) — the rate never reaches the client for them.
      ...(canSetSellRate ? { sellRate: sellRates.get(r.id) ?? null } : {}),
    };
  });

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/settings")} backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{CATALOG_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Link
              href="/catalog/subcategories"
              className="text-action text-sm font-medium hover:underline"
            >
              {MANAGE_TAXONOMY_LABEL}
            </Link>
            {/* Spec 239 U2 — the dormant BOQ-template link is retired (the screen +
                tables stay; operator chose hide-not-drop). */}
          </div>
          <AddCatalogItem categories={categories} units={units} />
        </div>
        <CatalogList
          items={items}
          categories={categories}
          units={units}
          editable
          canSetSellRate={canSetSellRate}
        />
      </div>
    </PageShell>
  );
}
