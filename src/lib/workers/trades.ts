// Spec 332 U2 — pure helpers behind the roster's trade tagging (สายงาน).
// set_worker_trades is full-replace, so the sheet decides whether the selection
// actually changed before spending a call, and the row shows a stable
// primary-first order. No I/O here — the RPC lives in the server action.

export type WorkerTrade = {
  categoryId: string;
  /** work_categories.code — a top-level W01–W09. */
  code: string;
  nameTh: string;
  isPrimary: boolean;
};

// Primary first, then by code. Returns a new array — never mutates the input
// (the roster reuses the same list for its checkbox state).
export function sortTradesPrimaryFirst(trades: WorkerTrade[]): WorkerTrade[] {
  return [...trades].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
}

// True when the incoming (categoryId set, primary) differs from what the worker
// already carries — order-insensitive, duplicate-insensitive (the RPC dedups).
export function tradeSelectionChanged(
  current: WorkerTrade[],
  selectedIds: string[],
  primaryId: string | null,
): boolean {
  const nextSet = new Set(selectedIds);
  const currentSet = new Set(current.map((t) => t.categoryId));
  if (nextSet.size !== currentSet.size) return true;
  for (const id of nextSet) {
    if (!currentSet.has(id)) return true;
  }
  const currentPrimary = current.find((t) => t.isPrimary)?.categoryId ?? null;
  return (primaryId ?? null) !== currentPrimary;
}
