// Spec 332 U2 — pure helpers behind the roster's trade tagging (สายงาน).
// set_worker_trades is full-replace, so the sheet decides whether the selection
// actually changed before spending a call, and the row shows a stable
// primary-first order. No I/O here — the RPC lives in the server action.

import { workCategoryIdentity } from "@/lib/work-categories/identity";

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

// Spec 338 U2 — fold worker_trades join rows (as the team-map page reads them)
// into a per-worker primary-first list the view indexes by chip. A row whose
// category join came back null contributes nothing.
export function foldWorkerTrades(
  rows: {
    worker_id: string;
    work_category_id: string;
    is_primary: boolean;
    work_categories: { code: string; name_th: string } | null;
  }[],
): Record<string, WorkerTrade[]> {
  const byWorker: Record<string, WorkerTrade[]> = {};
  for (const r of rows) {
    if (!r.work_categories) continue;
    (byWorker[r.worker_id] ??= []).push({
      categoryId: r.work_category_id,
      code: r.work_categories.code,
      nameTh: r.work_categories.name_th,
      isPrimary: r.is_primary,
    });
  }
  for (const id of Object.keys(byWorker)) {
    byWorker[id] = sortTradesPrimaryFirst(byWorker[id] ?? []);
  }
  return byWorker;
}

// Spec 338 U3 — the placing-hint predicate. Returns the WP category's resolved
// TOP code only when a mismatch is PROVABLE: the category resolves AND the lead
// carries ≥1 trade AND none of the lead's trades resolves to that top. Every
// unknown → null — absence of data is never treated as incapability, so the
// map can only ever under-warn, never scold a half-tagged roster.
export function tradeMismatchCode(
  categoryCode: string | null | undefined,
  leadTrades: WorkerTrade[],
): string | null {
  const target = workCategoryIdentity(categoryCode);
  if (!target || leadTrades.length === 0) return null;
  const covered = leadTrades.some((t) => workCategoryIdentity(t.code)?.code === target.code);
  return covered ? null : target.code;
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
