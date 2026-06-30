// Spec 230 (ADR 0066 / S9) — the procurement-grid material-category facet. The grid
// surfaces which managed material category each purchase request buys (resolved from
// the PR's catalog item) as an opt-in filter chip + a per-row badge. This is the pure
// logic behind it: the facet chips (counts taken over the FULL record set so they do
// not shift when a filter is applied) and the per-record match predicate. Show-all is
// the default — the component renders the always-present "ทั้งหมด" chip; selecting a
// category narrows the ROWS only, never the chip counts.

/** The always-present "show everything" selection (no narrowing). */
export const CATEGORY_ALL = "all";
/** The "uncategorised" bucket — records whose PR has no catalog-item category. */
export const CATEGORY_NONE = "__none__";

/** One facet chip: a present category, or the unset bucket (id = CATEGORY_NONE). */
export interface CategoryFacet {
  id: string;
  name: string;
  count: number;
}

type Categorized = { categoryId: string | null; categoryName: string | null };

/**
 * Enumerate the material-category facet chips present in `records`. Counts are over
 * the full set (a facet count is a property of the data, not of the current filter —
 * it must stay stable as the user filters). Sorted by count desc then name asc; an
 * unset bucket (CATEGORY_NONE) is appended LAST when any record lacks a category. Does
 * NOT include the "ทั้งหมด" chip — the component owns that (its count is records.length).
 */
export function buildCategoryFacets(
  records: ReadonlyArray<Categorized>,
  unsetLabel: string,
): CategoryFacet[] {
  const counts = new Map<string, { name: string; count: number }>();
  let none = 0;
  for (const r of records) {
    // A record needs BOTH a category id AND a resolvable name to earn a chip — an
    // id with no name (e.g. a deactivated category, absent from the active-only
    // loadCatalogCategories) folds into the unset bucket, never a raw-uuid chip.
    if (r.categoryId == null || r.categoryName == null) {
      none++;
      continue;
    }
    const entry = counts.get(r.categoryId) ?? { name: r.categoryName, count: 0 };
    entry.count++;
    counts.set(r.categoryId, entry);
  }
  const facets: CategoryFacet[] = [...counts.entries()].map(([id, { name, count }]) => ({
    id,
    name,
    count,
  }));
  facets.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (none > 0) facets.push({ id: CATEGORY_NONE, name: unsetLabel, count: none });
  return facets;
}

/** Does a record match the selected facet chip? ALL → always (show-all default). */
export function recordMatchesCategory(
  record: { categoryId: string | null },
  selected: string,
): boolean {
  if (selected === CATEGORY_ALL) return true;
  if (selected === CATEGORY_NONE) return record.categoryId == null;
  return record.categoryId === selected;
}
