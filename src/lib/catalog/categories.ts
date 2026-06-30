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

// Spec 225 (ADR 0066 D2) — secondary material membership. A catalog item keeps ONE
// canonical home (category_id) but can ALSO appear under other groupings via the
// additive catalog_item_categories junction. Scoped pickers read the UNION of the
// canonical home and the secondary memberships (de-duplicated). The helpers below
// are the SSOT for that union — the picker filters delegate to itemInCategoryScope.

/** One row of the catalog_item_categories junction (membership = item ↔ category). */
export type CatalogItemMembership = { catalogItemId: string; categoryId: string };

/** Load every item↔category membership (primary + secondary) for the picker union. */
export async function loadCatalogItemMemberships(
  supabase: SupabaseClient<Database>,
): Promise<CatalogItemMembership[]> {
  const { data } = await supabase
    .from("catalog_item_categories")
    .select("catalog_item_id, category_id");
  return (data ?? []).map((r) => ({
    catalogItemId: r.catalog_item_id,
    categoryId: r.category_id,
  }));
}

/** Group membership category ids per item → itemId → Set(categoryId). */
export function membershipsByItem(rows: CatalogItemMembership[]): Map<string, Set<string>> {
  const byItem = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byItem.get(r.catalogItemId) ?? new Set<string>();
    set.add(r.categoryId);
    byItem.set(r.catalogItemId, set);
  }
  return byItem;
}

/** The de-duplicated set of category ids an item belongs to: canonical ∪ secondary. */
export function itemCategoryIds(
  canonicalCategoryId: string | null,
  secondary: Set<string> | undefined,
): Set<string> {
  const ids = new Set<string>(secondary ?? []);
  if (canonicalCategoryId) ids.add(canonicalCategoryId);
  return ids;
}

/** Does an item fall under a category scope? (union of canonical + secondary) */
export function itemInCategoryScope(
  canonicalCategoryId: string | null,
  secondary: Set<string> | undefined,
  scopeCategoryId: string,
): boolean {
  return itemCategoryIds(canonicalCategoryId, secondary).has(scopeCategoryId);
}

// Spec 239 U2 (ADR 0066 / C1) — the item-form multi-category control writes
// SECONDARY memberships. The save action reconciles the item's current secondary
// set against the chosen one. This is the SSOT for that diff: the primary (the
// canonical home) is maintained by update_catalog_item, so it is excluded from
// both sides — it can never be a secondary.

/** The secondary memberships to add / remove to reach `desired` from `current`,
 *  excluding the primary category (it is the canonical home, never a secondary). */
export function diffSecondaryMemberships(
  currentSecondaryIds: string[],
  desiredCategoryIds: string[],
  primaryCategoryId: string,
): { toAdd: string[]; toRemove: string[] } {
  const current = new Set(currentSecondaryIds.filter((id) => id !== primaryCategoryId));
  const desired = new Set(desiredCategoryIds.filter((id) => id !== primaryCategoryId));
  const toAdd = [...desired].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !desired.has(id));
  return { toAdd, toRemove };
}
