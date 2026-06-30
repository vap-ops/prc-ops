// Spec 227 (ADR 0066 D5) — Relation R resolver. The scoped pickers (specs 228/229)
// need, for a WP's reconciled work-category, the set of material-categories that
// work-category typically buys (optionally narrowed by kind). This reads the GLOBAL
// work_category_material_categories bridge for one work_category_id and returns its
// (categoryId, kindFilter) rows. An UNMAPPED work-category resolves to an empty array
// — the pickers then show ALL items (the ADR 0066 D8 show-all fallback); the scope
// only ever reorders/pre-filters, it never hides.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

/** A catalog item kind (material | tool | equipment | labor | service | softcost). */
export type CatalogItemKind = Database["public"]["Enums"]["catalog_item_kind"];

/** One resolved relation row: a material-category, optionally narrowed by kind. */
export type ScopedMaterialCategory = {
  categoryId: string;
  kindFilter: CatalogItemKind | null;
};

/**
 * Resolve the material-categories a work-category is related to (Relation R).
 * Returns an empty array for an unmapped work-category — the picker's show-all
 * fallback depends on this empty case.
 */
export async function resolveScopedCategories(
  supabase: SupabaseClient<Database>,
  workCategoryId: string,
): Promise<ScopedMaterialCategory[]> {
  const { data } = await supabase
    .from("work_category_material_categories")
    .select("category_id, kind_filter")
    .eq("work_category_id", workCategoryId);
  return (data ?? []).map((r) => ({ categoryId: r.category_id, kindFilter: r.kind_filter }));
}
