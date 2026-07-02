// Spec 245 U3 — group a plan's saved lines by the item's managed category so a
// planner reviews/adjusts the plan category by category (D6: a display grouping,
// not a per-category approval flow). Applies to every plan's line list, not just
// cloned ones. Pure so it's unit-tested; the component only renders the result.

// Uncategorized lines (no category, or a category no longer in the managed set)
// collect under one trailing group.
export const UNCATEGORIZED_LABEL = "อื่นๆ";

export type LineGroup<T> = {
  // The managed category id, or null for the trailing uncategorized group.
  categoryId: string | null;
  categoryName: string;
  lines: T[];
};

// Groups `lines` by `line.categoryId`. Groups are emitted in the managed
// `categories` order (so the review order is stable and matches the picker),
// skipping any category with no lines. Lines whose category is null or not in
// `categories` fall into a single "อื่นๆ" group appended last. Input order is
// preserved within each group.
export function groupLinesByCategory<T extends { categoryId: string | null }>(
  lines: T[],
  categories: { id: string; name: string }[],
): LineGroup<T>[] {
  const known = new Set(categories.map((c) => c.id));
  const byCategory = new Map<string, T[]>();
  const uncategorized: T[] = [];

  for (const line of lines) {
    if (line.categoryId !== null && known.has(line.categoryId)) {
      const bucket = byCategory.get(line.categoryId);
      if (bucket) bucket.push(line);
      else byCategory.set(line.categoryId, [line]);
    } else {
      uncategorized.push(line);
    }
  }

  const groups: LineGroup<T>[] = [];
  for (const category of categories) {
    const bucket = byCategory.get(category.id);
    if (bucket && bucket.length > 0) {
      groups.push({ categoryId: category.id, categoryName: category.name, lines: bucket });
    }
  }
  if (uncategorized.length > 0) {
    groups.push({ categoryId: null, categoryName: UNCATEGORIZED_LABEL, lines: uncategorized });
  }
  return groups;
}
