// Spec 237 (ADR 0066 / S10-U2) — the server-side BOQ loaders. Thin read layer over
// the spec-236 tables (read under the caller's RLS context — grant-select to
// authenticated, `using(true)`). The list computes per-template line counts +
// totals via the pure templateTotal helper; the detail joins each line to its
// optional catalog item + work-category for display; the picker data assembles the
// inputs the line form needs (the full catalog, the managed categories, the unit
// vocabulary, the global work-category library).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { templateTotal } from "@/lib/boq/totals";
import { loadCatalogCategories, type CatalogCategoryOption } from "@/lib/catalog/categories";
import type { CatalogUnitOption } from "@/components/features/catalog/catalog-item-form";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import type { BoqWorkCategoryOption } from "@/components/features/boq/boq-line-form";

type Db = SupabaseClient<Database>;

// A template row in the list, with its derived line count + grand total.
export interface BoqTemplateSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  lineCount: number;
  total: number;
}

// The template header for the detail view.
export interface BoqTemplateHeader {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

// One line on the detail view, joined to its optional catalog item + work-category.
export interface BoqLineDetail {
  id: string;
  description: string;
  qty: number;
  unit: string;
  catalogItemId: string | null;
  catalogItemName: string | null;
  workCategoryId: string | null;
  workCategoryName: string | null;
  materialRate: number;
  laborRate: number;
  isStandard: boolean;
  variationType: Database["public"]["Enums"]["boq_variation_type"];
  exclusivityGroup: string | null;
}

export interface BoqTemplateDetailData {
  template: BoqTemplateHeader;
  lines: BoqLineDetail[];
}

export interface BoqPickerData {
  items: PurchaseRequestCatalogItem[];
  categories: { id: string; name: string }[];
  units: CatalogUnitOption[];
  workCategories: BoqWorkCategoryOption[];
}

/** The template list, active first (sort_order then code), each with count + total. */
export async function loadBoqTemplates(supabase: Db): Promise<BoqTemplateSummary[]> {
  const { data: templates } = await supabase
    .from("boq_template")
    .select("id, code, name, is_active, sort_order")
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });

  const { data: lines } = await supabase
    .from("boq_line")
    .select("boq_template_id, qty, material_rate, labor_rate");

  const byTemplate = new Map<string, { qty: number; materialRate: number; laborRate: number }[]>();
  for (const l of lines ?? []) {
    const bucket = byTemplate.get(l.boq_template_id) ?? [];
    bucket.push({ qty: l.qty, materialRate: l.material_rate, laborRate: l.labor_rate });
    byTemplate.set(l.boq_template_id, bucket);
  }

  return (templates ?? []).map((t) => {
    const bucket = byTemplate.get(t.id) ?? [];
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      isActive: t.is_active,
      sortOrder: t.sort_order,
      lineCount: bucket.length,
      total: templateTotal(bucket),
    };
  });
}

/** One template + its lines (sort_order then created_at), or null if not found. */
export async function loadBoqTemplateDetail(
  supabase: Db,
  id: string,
): Promise<BoqTemplateDetailData | null> {
  const { data: template } = await supabase
    .from("boq_template")
    .select("id, code, name, description, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!template) return null;

  const { data: lines } = await supabase
    .from("boq_line")
    .select(
      "id, description, qty, unit, catalog_item_id, work_category_id, material_rate, labor_rate, is_standard, variation_type, exclusivity_group, catalog_items(base_item), work_categories(name_th)",
    )
    .eq("boq_template_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return {
    template: {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      isActive: template.is_active,
    },
    lines: (lines ?? []).map((l) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      catalogItemId: l.catalog_item_id,
      catalogItemName: l.catalog_items?.base_item ?? null,
      workCategoryId: l.work_category_id,
      workCategoryName: l.work_categories?.name_th ?? null,
      materialRate: l.material_rate,
      laborRate: l.labor_rate,
      isStandard: l.is_standard,
      variationType: l.variation_type,
      exclusivityGroup: l.exclusivity_group,
    })),
  };
}

/** The inputs the line form needs: the full catalog, categories, units, work library. */
export async function loadBoqPickerData(supabase: Db): Promise<BoqPickerData> {
  const categoryOptions: CatalogCategoryOption[] = await loadCatalogCategories(supabase);
  const categoryNameById = new Map(categoryOptions.map((c) => [c.id, c.name]));

  const { data: itemRows } = await supabase
    .from("catalog_items")
    .select("id, category_id, base_item, spec_attrs, unit, product_code")
    .eq("is_active", true)
    .order("base_item", { ascending: true });
  const items: PurchaseRequestCatalogItem[] = (itemRows ?? []).map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_id ? (categoryNameById.get(r.category_id) ?? "") : "",
    baseItem: r.base_item,
    specAttrs: r.spec_attrs,
    unit: r.unit,
    thumbnailUrl: null,
    productCode: r.product_code,
  }));

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

  const { data: workRows } = await supabase
    .from("work_categories")
    .select("id, code, name_th, is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  const workCategories: BoqWorkCategoryOption[] = (workRows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name_th,
    isActive: r.is_active,
  }));

  return {
    items,
    categories: categoryOptions.map((c) => ({ id: c.id, name: c.name })),
    units,
    workCategories,
  };
}
