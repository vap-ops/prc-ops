// Spec 344 U1b — resolve a catalog item to every id its history lives under.
//
// merge_catalog_items folds a duplicate row's balance into its twin, but the
// stock ledger is append-only (stock_receipts / stock_returns / stock_reversals /
// stock_counts raise P0001 on UPDATE; stock_issues freezes catalog_item_id), so
// the retired row keeps its movements. `catalog_items.merged_into` names the
// survivor, and any reader keyed on catalog_item_id must widen to the set —
// otherwise the survivor shows a folded balance with only half the movements
// that explain it.

/** The item itself, followed by every row merged into it. Order is stable and ids are unique. */
export function mergedItemIds(
  itemId: string,
  mergedFrom: ReadonlyArray<{ id: string }> | null | undefined,
): string[] {
  return [...new Set([itemId, ...(mergedFrom ?? []).map((row) => row.id)])];
}
