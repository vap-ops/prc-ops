// Writing failing test first.
//
// Spec 275 U4 — the rental variance roll-up. A pure helper that, for one rental
// agreement, computes the three money figures the agreement-detail surface shows:
//   • charged-to-WP   Σ billable-days × daily_rate_snapshot over the agreement's
//                     items' CURRENT usage logs (mirrors wp_equipment_sell: days are
//                     inclusive, an open checkout accrues to today);
//   • paid-to-vendor  Σ net_amount over the agreement's CURRENT settlements
//                     (supersede anti-join);
//   • committed       the agreement rate × period (a display estimate).
// The recovery flag compares charged vs paid: charged > paid = PRC margin
// (over-recovery), charged < paid = PRC loss (under-recovery).

import { describe, expect, it } from "vitest";
import { computeRentalVariance, inclusiveDays } from "@/lib/equipment/rental-variance";

const TODAY = "2026-07-08";

describe("inclusiveDays", () => {
  it("counts both endpoints (same day = 1)", () => {
    expect(inclusiveDays("2026-07-01", "2026-07-01")).toBe(1);
    expect(inclusiveDays("2026-07-01", "2026-07-10")).toBe(10);
  });

  it("never goes negative for a future-dated start", () => {
    expect(inclusiveDays("2026-07-10", "2026-07-01")).toBe(0);
  });
});

describe("computeRentalVariance — charged-to-WP", () => {
  it("sums billable days × rate over current usage, accruing an open checkout to today", () => {
    const v = computeRentalVariance({
      today: TODAY,
      committed: { rate: 0, ratePeriod: "daily", startsOn: "2026-07-01", endsOn: "2026-07-01" },
      settlements: [],
      usage: [
        // closed: 2026-07-01..2026-07-10 = 10 days × 500 = 5000
        {
          id: "u1",
          supersededBy: null,
          checkedOutOn: "2026-07-01",
          checkedInOn: "2026-07-10",
          dailyRateSnapshot: 500,
        },
        // open: 2026-07-05..today(08) = 4 days × 1000 = 4000
        {
          id: "u2",
          supersededBy: null,
          checkedOutOn: "2026-07-05",
          checkedInOn: null,
          dailyRateSnapshot: 1000,
        },
      ],
    });
    expect(v.chargedToWp).toBe(9000);
  });

  it("excludes a superseded usage row", () => {
    const v = computeRentalVariance({
      today: TODAY,
      committed: { rate: 0, ratePeriod: "daily", startsOn: "2026-07-01", endsOn: "2026-07-01" },
      settlements: [],
      usage: [
        // the correction (current) — its superseded_by points back at the old row
        {
          id: "u1",
          supersededBy: "u0",
          checkedOutOn: "2026-07-01",
          checkedInOn: "2026-07-02",
          dailyRateSnapshot: 500,
        },
        // the OLD row u1 replaced → excluded
        {
          id: "u0",
          supersededBy: null,
          checkedOutOn: "2026-07-01",
          checkedInOn: "2026-07-31",
          dailyRateSnapshot: 500,
        },
      ],
    });
    expect(v.chargedToWp).toBe(1000); // only u1: 2 days × 500
  });
});

describe("computeRentalVariance — paid-to-vendor", () => {
  it("sums current settlement nets, excluding a superseded settlement", () => {
    const v = computeRentalVariance({
      today: TODAY,
      committed: { rate: 0, ratePeriod: "daily", startsOn: "2026-07-01", endsOn: "2026-07-01" },
      usage: [],
      settlements: [
        { id: "s2", supersededBy: "s1", netAmount: 8000 }, // correction (current)
        { id: "s1", supersededBy: null, netAmount: 5000 }, // replaced → excluded
      ],
    });
    expect(v.paidToVendor).toBe(8000);
  });
});

describe("computeRentalVariance — committed", () => {
  it("daily: rate × inclusive days of the agreement period", () => {
    const v = computeRentalVariance({
      today: TODAY,
      usage: [],
      settlements: [],
      committed: { rate: 500, ratePeriod: "daily", startsOn: "2026-07-01", endsOn: "2026-07-10" },
    });
    expect(v.committed).toBe(5000); // 500 × 10
  });

  it("monthly open-ended: rate prorated over 30-day months to today", () => {
    const v = computeRentalVariance({
      today: TODAY,
      usage: [],
      settlements: [],
      committed: { rate: 30000, ratePeriod: "monthly", startsOn: "2026-07-01", endsOn: null },
    });
    // 2026-07-01..today(08) = 8 days → 30000 × 8/30 = 8000
    expect(v.committed).toBe(8000);
  });
});

describe("computeRentalVariance — recovery flag", () => {
  function withTotals(charged: number, paid: number) {
    return computeRentalVariance({
      today: TODAY,
      committed: { rate: 0, ratePeriod: "daily", startsOn: "2026-07-01", endsOn: "2026-07-01" },
      usage: charged
        ? [
            {
              id: "u1",
              supersededBy: null,
              checkedOutOn: "2026-07-01",
              checkedInOn: "2026-07-01",
              dailyRateSnapshot: charged,
            },
          ]
        : [],
      settlements: paid ? [{ id: "s1", supersededBy: null, netAmount: paid }] : [],
    });
  }

  it("flags over-recovery when charged > paid (PRC margin)", () => {
    expect(withTotals(9000, 8000).flag).toBe("over_recovery");
  });

  it("flags under-recovery when charged < paid (PRC loss)", () => {
    expect(withTotals(7000, 8000).flag).toBe("under_recovery");
  });

  it("flags balanced when charged equals paid", () => {
    expect(withTotals(8000, 8000).flag).toBe("balanced");
  });
});
