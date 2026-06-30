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
import type { CatalogItemKind, ScopedMaterialCategory } from "@/lib/catalog/scoped-categories";

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

// ── Spec 229 (ADR 0066 / S8): UC2 เบิก on-hand scope ────────────────────────────
// The WP เบิก picker is a native <select> over the project store's on-hand stock.
// Unlike the PR/supply-plan picker above (category-only, UC1), it honours Relation
// R's per-row kindFilter so it can SEPARATE tools (equipment family) from materials.
// Same D8 contract: in-scope rows surface first, the rest stay present, and an
// empty relation = the full on-hand list untouched (the show-all fallback).

/** One on-hand row paired with whether it matches the active Relation-R scope. */
export type ScopedStockEntry<T> = { row: T; inScope: boolean };

export type ScopedStockList<T> = {
  /** True only when a non-empty Relation R is active. */
  scoped: boolean;
  /** Rows, in-scope first (stable). Unscoped → original order, all `inScope: false`. */
  entries: ScopedStockEntry<T>[];
  /** How many entries are in scope (0 when not scoped). */
  inScopeCount: number;
};

/**
 * Does an item — identified by its canonical∪secondary category ids and its
 * `kind` (the spec-224 facet) — match ANY Relation-R row? A relation row
 * `(categoryId, kindFilter)` matches when its category is among the item's
 * categories AND its kindFilter is null (any kind in that category) or equals the
 * item's kind. This is how UC2 honours the tool-vs-material split.
 */
export function itemInRelationScope(
  categoryIds: ReadonlySet<string>,
  kind: CatalogItemKind | null,
  relation: readonly ScopedMaterialCategory[],
): boolean {
  for (const r of relation) {
    if (!categoryIds.has(r.categoryId)) continue;
    if (r.kindFilter === null || r.kindFilter === kind) return true;
  }
  return false;
}

/**
 * Order + flag on-hand stock rows against a WP work-category's Relation R.
 *
 * @param rows the on-hand stock rows (each carries its canonical `categoryId`
 *   and `kind`).
 * @param membershipsByItem catalogItemId → secondary category ids (the S4 union).
 * @param relation the resolved Relation-R rows, or empty/undefined for the
 *   show-all fallback.
 */
export function scopeStockRows<
  T extends { catalogItemId: string; categoryId: string | null; kind: CatalogItemKind | null },
>(
  rows: readonly T[],
  membershipsByItem: ReadonlyMap<string, Set<string>>,
  relation: readonly ScopedMaterialCategory[] | null | undefined,
): ScopedStockList<T> {
  const rel = relation ?? [];

  // D8 show-all fallback: no relation → the full on-hand list, untouched.
  if (rel.length === 0) {
    return {
      scoped: false,
      entries: rows.map((row) => ({ row, inScope: false })),
      inScopeCount: 0,
    };
  }

  const inScope: ScopedStockEntry<T>[] = [];
  const rest: ScopedStockEntry<T>[] = [];
  for (const row of rows) {
    const ids = itemCategoryIds(row.categoryId, membershipsByItem.get(row.catalogItemId));
    const hit = itemInRelationScope(ids, row.kind, rel);
    (hit ? inScope : rest).push({ row, inScope: hit });
  }

  return { scoped: true, entries: [...inScope, ...rest], inScopeCount: inScope.length };
}
