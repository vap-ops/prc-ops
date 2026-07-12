// Spec 301 U2 — the approver-side recompute of the picker's off-category flag.
// Spec 297 shipped the flag at PICK time only (the PR stores no category); this
// helper re-derives the same verdict at review time. Built ON scopeCatalogItems
// so the semantics can never drift from the picker: category-only (UC1), the
// canonical∪secondary union, and the same scopeActive gating — an empty/absent
// scope means NO flag (null), never "mismatch".

import { scopeCatalogItems } from "@/lib/catalog/scoped-picker";

export type PrCategoryMatch = "match" | "mismatch" | null;

/**
 * @param item the PR's catalog item (canonical categoryId), or null for a
 *   free-text PR — no item, no verdict.
 * @param membershipsByItem itemId → secondary category ids (the S4 union).
 * @param scopedCategoryIds the WP work-category's Relation-R material
 *   categories; empty/absent → show-all fallback → null (no flag).
 */
export function prCategoryMatch(
  item: { id: string; categoryId: string | null } | null,
  membershipsByItem: ReadonlyMap<string, Set<string>>,
  scopedCategoryIds: readonly string[] | null | undefined,
): PrCategoryMatch {
  if (!item) return null;
  const scoped = scopeCatalogItems([item], membershipsByItem, scopedCategoryIds);
  if (!scoped.scoped) return null;
  return scoped.entries[0]?.inScope ? "match" : "mismatch";
}
