// Spec 109 — prev/next stepping for the procurement record-review drawer. The
// grid groups records into pipeline bands (spec 104); the drawer steps through
// them in the grid's reading order (band order, then within-band order). Pure
// (no UI) so the navigation is unit-tested independent of the client component.

// Flatten the banded groups into one ordered list — the order rows are read on
// screen, top to bottom. Empty bands contribute nothing.
export function flattenRecordOrder<T extends { id: string }>(
  groups: ReadonlyArray<{ items: ReadonlyArray<T> }>,
): T[] {
  return groups.flatMap((g) => g.items.slice());
}

export interface AdjacentRecords {
  prevId: string | null;
  nextId: string | null;
  /** Position of currentId in the flattened order; -1 when absent. */
  index: number;
  total: number;
}

// The neighbours of currentId in the flattened order. Non-wrapping: null at the
// ends (mirrors the lightbox's non-wrapping nav, spec 50). An absent id yields
// index -1 with no neighbours.
export function adjacentRecordIds(
  order: ReadonlyArray<{ id: string }>,
  currentId: string,
): AdjacentRecords {
  const total = order.length;
  const index = order.findIndex((r) => r.id === currentId);
  if (index === -1) return { prevId: null, nextId: null, index, total };
  return {
    prevId: index > 0 ? (order[index - 1]?.id ?? null) : null,
    nextId: index < total - 1 ? (order[index + 1]?.id ?? null) : null,
    index,
    total,
  };
}
