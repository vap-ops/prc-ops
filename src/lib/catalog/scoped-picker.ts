// Spec 228 (ADR 0066 / S7, decisions D5 / D8) — the scoped supply-plan picker
// ordering helper. Given a WP's Relation-R material-category scope + the catalog
// items + their canonical∪secondary membership union (the S4 SSOT in
// `categories.ts`), produce an ORDERED + FLAGGED list: the in-scope items first
// (flagged relevant), with the out-of-scope items STILL PRESENT after them. An
// empty or absent scope (an uncategorised WP, a whole-project row, or an empty
// Relation R) returns the full catalog in its original order — the D8 show-all
// fallback. The scope only ever reorders/pre-filters; it NEVER hides, so the
// picker is usable even though almost nothing is categorised yet.

import { itemCategoryIds } from "@/lib/catalog/categories";

/** One catalog item paired with whether it falls in the active scope. */
export type ScopedPickerEntry<T> = { item: T; inScope: boolean };

export type ScopedItemList<T> = {
  /** True only when a non-empty material-category scope is active. */
  scoped: boolean;
  /** Items, in-scope first (stable). Unscoped → original order, all `inScope: false`. */
  entries: ScopedPickerEntry<T>[];
  /** How many entries are in scope (0 when not scoped). */
  inScopeCount: number;
};

/**
 * Order + flag catalog items against a Relation-R material-category scope.
 *
 * @param items the catalog items (each carries its canonical `categoryId`).
 * @param membershipsByItem itemId → secondary category ids (the S4 union source).
 * @param scopedCategoryIds the work-category's related material categories, or
 *   empty/undefined for the show-all fallback.
 */
export function scopeCatalogItems<T extends { id: string; categoryId: string | null }>(
  items: readonly T[],
  membershipsByItem: ReadonlyMap<string, Set<string>>,
  scopedCategoryIds: readonly string[] | null | undefined,
): ScopedItemList<T> {
  const scope = new Set(scopedCategoryIds ?? []);

  // D8 show-all fallback: no scope → the full catalog, untouched.
  if (scope.size === 0) {
    return {
      scoped: false,
      entries: items.map((item) => ({ item, inScope: false })),
      inScopeCount: 0,
    };
  }

  // Partition into in-scope (canonical∪secondary ∩ scope ≠ ∅) and the rest,
  // each keeping its original relative order — then surface in-scope first.
  const inScope: ScopedPickerEntry<T>[] = [];
  const rest: ScopedPickerEntry<T>[] = [];
  for (const item of items) {
    const ids = itemCategoryIds(item.categoryId, membershipsByItem.get(item.id));
    let hit = false;
    for (const id of ids) {
      if (scope.has(id)) {
        hit = true;
        break;
      }
    }
    (hit ? inScope : rest).push({ item, inScope: hit });
  }

  return { scoped: true, entries: [...inScope, ...rest], inScopeCount: inScope.length };
}
