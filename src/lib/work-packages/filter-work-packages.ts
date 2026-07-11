// Spec 293 — type-to-find search over the project work-list.
//
// The work-list holds every WP in-memory (roster leaves), so a plain
// substring filter is enough — no server round-trip, no debounce. This
// helper is the pure core: the WorkPackageList component renders its
// result as a flat hit list while a query is active.

/** The minimal shape the search reads — WorkPackageListItem satisfies it. */
export interface SearchableWorkPackage {
  code: string;
  name: string;
  /** งาน groups head sections, they are never actionable rows (spec 270). */
  isGroup: boolean;
  /** Lower rank = higher priority; drives the hit-list order. */
  priorityRank: number;
}

/**
 * Filter the WP roster for the search box: match the query against WP
 * **code** OR **name** (case-insensitive substring), always excluding งาน
 * groups, and return the matches ordered by `priorityRank` ascending so the
 * hit list is deterministic and highest-leverage-first. A blank/whitespace
 * query is treated as "no filter" and returns the full (group-free, ranked)
 * list — the component decides separately whether a search is active.
 */
export function filterWorkPackages<T extends SearchableWorkPackage>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  const matches = items.filter((wp) => {
    if (wp.isGroup) return false;
    if (q === "") return true;
    return wp.code.toLowerCase().includes(q) || wp.name.toLowerCase().includes(q);
  });
  return matches.slice().sort((a, b) => a.priorityRank - b.priorityRank);
}
