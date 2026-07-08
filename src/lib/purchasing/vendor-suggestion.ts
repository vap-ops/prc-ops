// Spec 280 U1 — derive-first vendor suggestion. A vendor's material categories
// are NOT declared anywhere; they are derivable from committed purchase history
// (purchase_request → catalog_item → catalog_categories, grouped by supplier).
// This pure layer turns that history into "vendors who've supplied THIS category
// before", ranked, so the PR/PO supplier picker can surface them first. No I/O,
// no React. The full supplier list is always kept (show-all fallback, ADR 0066
// D8) — the suggestion only re-orders, it never hides a vendor.

export interface VendorCategoryEvent {
  supplierId: string;
  /** The catalog category the purchase belonged to; null for uncatalogued PRs. */
  categoryId: string | null;
  /** ISO timestamp of the committed purchase; null when unknown. */
  purchasedAt: string | null;
}

interface VendorStat {
  count: number;
  /** Most-recent purchase timestamp seen for this supplier in this category. */
  lastPurchasedAt: string | null;
}

/**
 * Build `categoryId → ranked supplierId[]` from committed purchase events.
 * Ranking: committed-PR count in the category (desc), then most-recent purchase
 * (desc, nulls last). Events with no category are ignored (they cannot suggest a
 * vendor for a category). Each supplier appears once per category.
 */
export function rankVendorsByCategory(
  events: readonly VendorCategoryEvent[],
): Record<string, string[]> {
  const byCategory = new Map<string, Map<string, VendorStat>>();

  for (const e of events) {
    if (e.categoryId === null) continue;
    let suppliers = byCategory.get(e.categoryId);
    if (!suppliers) {
      suppliers = new Map();
      byCategory.set(e.categoryId, suppliers);
    }
    const stat = suppliers.get(e.supplierId);
    if (stat) {
      stat.count += 1;
      if (isNewer(e.purchasedAt, stat.lastPurchasedAt)) stat.lastPurchasedAt = e.purchasedAt;
    } else {
      suppliers.set(e.supplierId, { count: 1, lastPurchasedAt: e.purchasedAt });
    }
  }

  const out: Record<string, string[]> = {};
  for (const [categoryId, suppliers] of byCategory) {
    out[categoryId] = [...suppliers.entries()]
      .sort(([, a], [, b]) => {
        if (b.count !== a.count) return b.count - a.count; // higher count first
        // tie: more-recent purchase first, nulls last
        const at = a.lastPurchasedAt;
        const bt = b.lastPurchasedAt;
        if (at === bt) return 0;
        if (at === null) return 1;
        if (bt === null) return -1;
        return at > bt ? -1 : 1;
      })
      .map(([supplierId]) => supplierId);
  }
  return out;
}

function isNewer(candidate: string | null, current: string | null): boolean {
  if (candidate === null) return false;
  if (current === null) return true;
  return candidate > current;
}

/**
 * Union suggestion for a multi-line PO whose lines may span several categories.
 * Ranks vendors across the given categories by how many of them the vendor has
 * supplied before (coverage, desc), tie-broken by the vendor's best (highest)
 * rank position among those categories. Null/unknown categories are ignored.
 * Returns a deduped, ranked supplierId list.
 */
export function suggestVendorsForCategories(
  categoryVendors: Record<string, readonly string[]>,
  categoryIds: Iterable<string | null | undefined>,
): string[] {
  const distinctCategories = new Set<string>();
  for (const id of categoryIds) {
    if (id != null && id in categoryVendors) distinctCategories.add(id);
  }

  const score = new Map<string, { coverage: number; bestPos: number; firstSeen: number }>();
  let order = 0;
  for (const categoryId of distinctCategories) {
    const ranked = categoryVendors[categoryId] ?? [];
    ranked.forEach((supplierId, pos) => {
      const prev = score.get(supplierId);
      if (prev) {
        prev.coverage += 1;
        if (pos < prev.bestPos) prev.bestPos = pos;
      } else {
        score.set(supplierId, { coverage: 1, bestPos: pos, firstSeen: order++ });
      }
    });
  }

  return [...score.entries()]
    .sort(([, a], [, b]) => {
      if (b.coverage !== a.coverage) return b.coverage - a.coverage; // more categories first
      if (a.bestPos !== b.bestPos) return a.bestPos - b.bestPos; // better rank first
      return a.firstSeen - b.firstSeen; // stable
    })
    .map(([supplierId]) => supplierId);
}

export interface SplitSuppliers<T> {
  /** Suggested vendors, in ranked order; only those present in `all`. */
  suggested: T[];
  /** Every other vendor, in the original order of `all`. */
  rest: T[];
}

/**
 * Partition the full supplier list into the ranked-suggested set and the
 * remainder. `suggested` follows `suggestedIds` order (dropping ids absent from
 * `all`); `rest` preserves the original order of `all` minus the suggested. The
 * union is always the whole list — nothing is dropped.
 */
export function splitSupplierOptions<T extends { id: string }>(
  all: readonly T[],
  suggestedIds: readonly string[],
): SplitSuppliers<T> {
  const byId = new Map(all.map((s) => [s.id, s]));
  const suggested: T[] = [];
  const suggestedSet = new Set<string>();
  for (const id of suggestedIds) {
    const option = byId.get(id);
    if (option && !suggestedSet.has(id)) {
      suggested.push(option);
      suggestedSet.add(id);
    }
  }
  const rest = all.filter((s) => !suggestedSet.has(s.id));
  return { suggested, rest };
}
