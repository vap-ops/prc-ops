// Writing failing test first.
//
// Spec 262 U4 — the /requests procurement home tiles' pure layer: this-month
// vs last-month committed spend (reusing U1's purchase_report RPC with
// p_bucket='month', p_group_by='none' — no separate aggregation path), the
// worst-aging undelivered PO summary (spec 262 U3's per-PO aging), and the
// store-first "ค้างรับเข้า" backlog (delivered, store-bound PRs with no
// stock_receipts row yet — the exact storedPrIds set the dashboard already
// computes, spec 195/209).

import { describe, expect, it } from "vitest";
import {
  buildMonthSpendTrend,
  buildPendingPoSummary,
  countPendingStoreReceipt,
  monthToDateRange,
  previousMonthToDateRange,
} from "@/lib/purchasing/procurement-home-tiles";

describe("buildMonthSpendTrend", () => {
  it("computes a positive % change", () => {
    expect(buildMonthSpendTrend(1100, 1000)).toEqual({
      currentMonth: 1100,
      previousMonth: 1000,
      pctChange: 10,
    });
  });

  it("computes a negative % change", () => {
    expect(buildMonthSpendTrend(800, 1000)).toEqual({
      currentMonth: 800,
      previousMonth: 1000,
      pctChange: -20,
    });
  });

  it("is null when there was no spend last month (can't compute a %)", () => {
    expect(buildMonthSpendTrend(500, 0).pctChange).toBeNull();
  });

  it("is zero change when both months are zero", () => {
    expect(buildMonthSpendTrend(0, 0)).toEqual({
      currentMonth: 0,
      previousMonth: 0,
      pctChange: null,
    });
  });
});

describe("buildPendingPoSummary", () => {
  it("is zero/null for no undelivered POs", () => {
    expect(buildPendingPoSummary([null, null])).toEqual({ count: 0, worstAgingDays: null });
  });

  it("counts undelivered POs and finds the worst aging", () => {
    expect(buildPendingPoSummary([5, null, 20, 3])).toEqual({ count: 3, worstAgingDays: 20 });
  });
});

describe("countPendingStoreReceipt", () => {
  it("counts delivered store-bound PRs with no stock_receipts row yet", () => {
    const stored = new Set(["a", "c"]);
    expect(countPendingStoreReceipt(["a", "b", "c", "d"], stored)).toBe(2); // b, d pending
  });

  it("is zero once everything has been received to store", () => {
    const stored = new Set(["a", "b"]);
    expect(countPendingStoreReceipt(["a", "b"], stored)).toBe(0);
  });
});

describe("monthToDateRange / previousMonthToDateRange", () => {
  it("this month = the 1st through today", () => {
    expect(monthToDateRange("2026-07-04")).toEqual({ from: "2026-07-01", to: "2026-07-04" });
  });

  it("last month = the same day-of-month range, one month back", () => {
    expect(previousMonthToDateRange("2026-07-04")).toEqual({
      from: "2026-06-01",
      to: "2026-06-04",
    });
  });

  it("clamps the previous-month end to that month's last day (day 31 → Feb 28)", () => {
    expect(previousMonthToDateRange("2026-03-31")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });
});
