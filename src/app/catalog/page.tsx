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
import Link from "next/link";
import { CatalogList, type CatalogItem } from "@/components/features/catalog/catalog-list";
import type { CatalogSubcategoryOption } from "@/components/features/catalog/catalog-item-form";
import { AddCatalogItem } from "@/components/features/catalog/add-catalog-item";
import { CATALOG_LABEL, MANAGE_TAXONOMY_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: CATALOG_LABEL };

export default async function CatalogPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const { data: rows } = await supabase
    .from("catalog_items")
    .select(
      "id, category, base_item, spec_attrs, unit, note, image_path, product_code, subcategory_id",
    )
    .eq("is_active", true)
    .order("base_item", { ascending: true });

  // Spec 219 — the subcategory options for the add/edit cascading picker.
  const { data: subRows } = await supabase
    .from("catalog_subcategories")
    .select("id, category, code, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  const subcategories: CatalogSubcategoryOption[] = (subRows ?? []).map((r) => ({
    id: r.id,
    // Spec 221: category is now nullable (vestigial enum); non-null until the item form switches to category_id (later unit).
    category: r.category as NonNullable<typeof r.category>,
    code: r.code,
    name: r.name,
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

  const items: CatalogItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    // Spec 221: category is now nullable (vestigial enum); non-null until the item form switches to category_id (later unit).
    category: r.category as NonNullable<typeof r.category>,
    baseItem: r.base_item,
    specAttrs: r.spec_attrs,
    unit: r.unit,
    productCode: r.product_code,
    note: r.note,
    subcategoryId: r.subcategory_id,
    thumbnailUrl: signed.get(r.id) ?? null,
    // Omit the key entirely for non-super (exactOptionalPropertyTypes forbids an
    // explicit `undefined`) — the rate never reaches the client for them.
    ...(canSetSellRate ? { sellRate: sellRates.get(r.id) ?? null } : {}),
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{CATALOG_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/catalog/subcategories"
            className="text-action text-sm font-medium hover:underline"
          >
            {MANAGE_TAXONOMY_LABEL}
          </Link>
          <AddCatalogItem subcategories={subcategories} />
        </div>
        <CatalogList
          items={items}
          subcategories={subcategories}
          editable
          canSetSellRate={canSetSellRate}
        />
      </div>
    </PageShell>
  );
}
