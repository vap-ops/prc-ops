// Spec 245 U4 — /settings/ordering-templates/[templateId]: one template's
// stripped-down editor (item + qty + note rows — no WP column, no lifecycle,
// D2/D5). Gated to the supply-plan write tier (SUPPLY_PLAN_ROLES); an id that
// isn't a real is_template row (or one the caller can't see) → notFound. Loads
// the same picker data as the plan grid (full catalog + managed categories +
// signed thumbnails) so the item picker matches the on-site PR/plan experience.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { SUPPLY_PLAN_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { CATALOG_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { loadCatalogCategories, categoryNameById } from "@/lib/catalog/categories";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { ORDERING_TEMPLATES_LABEL } from "@/lib/i18n/labels";
import type { CatalogPick } from "@/components/features/supply-plan/supply-plan-manager";
import {
  OrderingTemplateEditor,
  type TemplateEditorLine,
} from "@/components/features/supply-plan/ordering-template-editor";

export const metadata = { title: ORDERING_TEMPLATES_LABEL };

interface PageProps {
  params: Promise<{ templateId: string }>;
}

export default async function OrderingTemplateEditorPage({ params }: PageProps) {
  const { templateId } = await params;
  const ctx = await requireRole(SUPPLY_PLAN_ROLES);

  const supabase = await createClient();
  // Guard: only a real template row opens here — a plan id (is_template=false),
  // an unknown id, or a malformed one all fall to notFound.
  const { data: template } = await supabase
    .from("supply_plans")
    .select("id, name")
    .eq("id", templateId)
    .eq("is_template", true)
    .maybeSingle();
  if (!template) notFound();

  const { data: lineRows } = await supabase
    .from("supply_plan_lines")
    .select("id, qty, catalog_items ( category_id, base_item, spec_attrs, unit )")
    .eq("supply_plan_id", template.id)
    .order("created_at", { ascending: true });
  const lines: TemplateEditorLine[] = (lineRows ?? []).map((r) => ({
    id: r.id,
    categoryId: r.catalog_items?.category_id ?? null,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.catalog_items?.unit ?? "",
    qty: Number(r.qty),
  }));

  // The same picker feed as the plan grid (spec 189 follow-up: one shared
  // catalog picker everywhere — thumbnails + managed categories).
  const { data: catRows } = await supabase
    .from("catalog_items")
    .select("id, category_id, base_item, spec_attrs, unit, image_path, product_code")
    .eq("is_active", true)
    .order("base_item", { ascending: true });
  const catalogCategories = await loadCatalogCategories(supabase);
  const categoryName = categoryNameById(catalogCategories);
  const categories = catalogCategories.map((c) => ({ id: c.id, name: c.name }));
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

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings/ordering-templates" backLabel={ORDERING_TEMPLATES_LABEL}>
        <h1 className="text-title text-ink font-bold tracking-tight">
          {template.name ?? "เทมเพลต"}
        </h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <OrderingTemplateEditor
          templateId={template.id}
          lines={lines}
          catalogItems={catalogItems}
          categories={categories}
        />
      </div>
    </PageShell>
  );
}
