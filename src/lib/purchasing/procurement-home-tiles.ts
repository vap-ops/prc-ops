// Spec 262 U4 — pure layer for the /requests procurement home tiles:
// เดือนนี้สั่งซื้อ (this-month vs last-month committed spend), PO ค้างส่ง
// (undelivered POs + worst aging, spec 262 U3), ค้างรับเข้า (delivered
// store-bound PRs with no stock_receipts row yet — the store-first backlog).

import { addMonthsIso } from "@/lib/work-packages/calendar-grid";

export interface MonthSpendTrend {
  currentMonth: number;
  previousMonth: number;
  /** Rounded %, null when there was no spend last month to compare against. */
  pctChange: number | null;
}

export function buildMonthSpendTrend(currentMonth: number, previousMonth: number): MonthSpendTrend {
  const pctChange =
    previousMonth > 0 ? Math.round(((currentMonth - previousMonth) / previousMonth) * 100) : null;
  return { currentMonth, previousMonth, pctChange };
}

export interface PendingPoSummary {
  count: number;
  worstAgingDays: number | null;
}

/** Spec 262 U3's per-PO agingDays (null = received/never-ordered) → the tile's
 * count + worst-case wait. */
export function buildPendingPoSummary(
  agingDaysList: ReadonlyArray<number | null>,
): PendingPoSummary {
  const pending = agingDaysList.filter((d): d is number => d !== null);
  return {
    count: pending.length,
    worstAgingDays: pending.length > 0 ? Math.max(...pending) : null,
  };
}

/** Store-first doctrine (specs 195/209): a delivered, store-bound PR should
 * generate a stock_receipts row; one that hasn't yet is "ค้างรับเข้า" —
 * arrived but not logged into the store. `storedPrIds` is the SAME set
 * `sumMaterials`/the dashboard already compute (stock_receipts.purchase_request_id). */
export function countPendingStoreReceipt(
  deliveredStoreBoundPrIds: ReadonlyArray<string>,
  storedPrIds: ReadonlySet<string>,
): number {
  return deliveredStoreBoundPrIds.filter((id) => !storedPrIds.has(id)).length;
}

export interface DateRange {
  from: string;
  to: string;
}

export function monthToDateRange(todayIso: string): DateRange {
  return { from: `${todayIso.slice(0, 7)}-01`, to: todayIso };
}

/** The SAME day-of-month, one calendar month back — an apples-to-apples
 * partial-month comparison for the trend tile (not the previous month's
 * FULL total, which would compare unequal day-counts). */
export function previousMonthToDateRange(todayIso: string): DateRange {
  return {
    from: addMonthsIso(`${todayIso.slice(0, 7)}-01`, -1),
    to: addMonthsIso(todayIso, -1),
  };
}
