// Spec 221 cleanup — the managed catalog_categories loader, single-sourced. Every
// reader that needs the user-managed main categories (the /catalog filter + form,
// and the store readers) loads them the same way: id/code/name, is_active, ordered
// by sort_order then code. This is the SSOT behind reading category_id + the
// category NAME instead of the vestigial item_category enum — so user-created
// categories (category_id set, enum NULL) display correctly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

// The managed main category as a UI option (id keys the FK, name is what shows).
export type CatalogCategoryOption = { id: string; code: string; name: string };

/** Load the active managed main categories, ordered by sort_order then code. */
export async function loadCatalogCategories(
  supabase: SupabaseClient<Database>,
): Promise<CatalogCategoryOption[]> {
  const { data } = await supabase
    .from("catalog_categories")
    .select("id, code, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name }));
}

/** A category-id → name lookup, for labelling an item by its category_id. */
export function categoryNameById(cats: CatalogCategoryOption[]): Map<string, string> {
  return new Map(cats.map((c) => [c.id, c.name]));
}
