// Spec 100 — dashboard money helpers (PM/super only). spend = labor +
// materials; materials counts only spend-status PRs that recorded a price.

import { describe, expect, it } from "vitest";
import {
  SPEND_STATUSES,
  sumMaterials,
  sumStoreIssues,
  sumStoreReturns,
  sumStorePool,
  spendBreakdown,
  spendBarSegments,
  budgetStatus,
} from "@/lib/dashboard/spend";

describe("SPEND_STATUSES", () => {
  it("is exactly the four spent statuses", () => {
    expect([...SPEND_STATUSES].sort()).toEqual([
      "delivered",
      "on_route",
      "purchased",
      "site_purchased",
    ]);
  });
});

describe("sumMaterials", () => {
  it("sums only spend-status PRs that recorded an amount", () => {
    expect(
      sumMaterials([
        { id: "a", status: "purchased", amount: 1000 },
        { id: "b", status: "delivered", amount: 500 },
        { id: "c", status: "site_purchased", amount: 250 },
        { id: "d", status: "requested", amount: 999 }, // not spent yet
        { id: "e", status: "approved", amount: 999 }, // not spent yet
        { id: "f", status: "cancelled", amount: 999 },
        { id: "g", status: "purchased", amount: null }, // no price recorded
      ]),
    ).toBe(1750);
  });

  it("empty → 0", () => {
    expect(sumMaterials([])).toBe(0);
  });

  // Store-first doctrine (U4): a WP-bound PR whose goods entered the store (has a
  // stock_receipt) is excluded — its cost lands via sumStoreIssues at เบิก, so
  // counting it here too would double-count once U1 auto-stocks WP-bound receives.
  it("excludes PRs whose id is in storedPrIds (counted via store issues instead)", () => {
    expect(
      sumMaterials(
        [
          { id: "a", status: "purchased", amount: 1000 }, // store-routed → skip
          { id: "b", status: "delivered", amount: 500 }, // legacy direct-to-WP → count
          { id: "c", status: "site_purchased", amount: 250 }, // store-routed → skip
        ],
        new Set(["a", "c"]),
      ),
    ).toBe(500);
  });

  it("empty storedPrIds set changes nothing (pre-U1 no-op)", () => {
    const prs = [
      { id: "a", status: "purchased", amount: 1000 },
      { id: "b", status: "delivered", amount: 500 },
    ];
    expect(sumMaterials(prs, new Set())).toBe(sumMaterials(prs));
  });
});

describe("sumStoreIssues", () => {
  it("sums store-issue cost (total_cost), skipping unpriced rows", () => {
    expect(
      sumStoreIssues([
        { total_cost: 1000 },
        { total_cost: 500 },
        { total_cost: null }, // legacy/unpriced — no cost recorded
      ]),
    ).toBe(1500);
  });

  it("empty → 0", () => {
    expect(sumStoreIssues([])).toBe(0);
  });
});

// WP→store return (spec 209) — material issued to a WP then returned to the store.
// The return re-enters stock_on_hand at the issue cost (→ counted in projectPool) but
// the originating issue is left non-reversed (returns are forbidden on reversed
// issues), so its full cost stays in sumStoreIssues. Without netting this out of the
// WP level, the returned baht is counted twice. Mirrors wp_profit's return netting.
describe("sumStoreReturns", () => {
  it("sums returned cost (total_cost), skipping unpriced rows", () => {
    expect(sumStoreReturns([{ total_cost: 400 }, { total_cost: 100 }, { total_cost: null }])).toBe(
      500,
    );
  });

  it("empty → 0", () => {
    expect(sumStoreReturns([])).toBe(0);
  });
});

// PD dashboard money split — project store pool. Material paid for at the project
// level that entered the store but has NOT yet been withdrawn (เบิก) to a WP, valued
// at cost via stock_on_hand.total_value. Disjoint from sumStoreIssues (issued
// material has already left stock_on_hand), so projectPool + wpLevel never
// double-counts a baht.
describe("sumStorePool", () => {
  it("sums store-on-hand value (total_value), skipping unpriced rows", () => {
    expect(
      sumStorePool([
        { total_value: 40000 },
        { total_value: 10000 },
        { total_value: null }, // legacy/unpriced — no value recorded
      ]),
    ).toBe(50000);
  });

  it("empty → 0", () => {
    expect(sumStorePool([])).toBe(0);
  });
});

// PD dashboard money split — the breakdown the per-project card renders. wpLevel is
// today's spend (labor + WP materials + เบิก); projectPool is paid-for store stock
// not yet withdrawn. The two are disjoint, so total is a true, no-double-count
// figure that also CORRECTS today's number (which omits paid stock still in store).
describe("spendBreakdown", () => {
  it("total = wpLevel + projectPool (disjoint, no double-count)", () => {
    expect(spendBreakdown(560000, 40000)).toEqual({
      wpLevel: 560000,
      projectPool: 40000,
      total: 600000,
    });
  });

  it("no project pool → total equals wpLevel (today's number, unchanged)", () => {
    const b = spendBreakdown(560000, 0);
    expect(b.total).toBe(560000);
    expect(b.projectPool).toBe(0);
    expect(b.wpLevel).toBe(560000);
  });

  it("no WP spend → total equals projectPool (all paid stock, nothing withdrawn)", () => {
    expect(spendBreakdown(0, 40000)).toEqual({
      wpLevel: 0,
      projectPool: 40000,
      total: 40000,
    });
  });

  // The returns double-count guard, end-to-end. Receive ฿1000 into store, เบิก all
  // ฿1000 to a WP, return ฿400 of offcuts. True spend = ฿1000 (฿600 consumed by the
  // WP, ฿400 back in the store pool). wpLevel MUST net the return out of the issue;
  // projectPool holds the returned value. Without the net, total would be ฿1400.
  it("returned material is not double-counted (issue netted, pool holds the return)", () => {
    const issues = sumStoreIssues([{ total_cost: 1000 }]);
    const returns = sumStoreReturns([{ total_cost: 400 }]);
    const pool = sumStorePool([{ total_value: 400 }]);
    const b = spendBreakdown(issues - returns, pool);
    expect(b.wpLevel).toBe(600);
    expect(b.projectPool).toBe(400);
    expect(b.total).toBe(1000); // not 1400
  });
});

// PD dashboard money split — the two-colour spend bar. The bar stacks two segments
// over the budget track: wpLevel (ใช้ในงาน) then projectPool (พักในคลังโครงการ).
// Widths are % of budget; the pool segment is clamped to the remaining track so the
// two never exceed 100% (over-budget clips). `over` keys the danger styling.
describe("spendBarSegments", () => {
  it("returns each segment as a % of budget when under budget", () => {
    expect(spendBarSegments({ wpLevel: 560, projectPool: 40, total: 600 }, 1000)).toEqual({
      wpPct: 56,
      poolPct: 4,
      over: false,
    });
  });

  it("clamps the pool segment to the remaining track and flags over when total exceeds budget", () => {
    // wp 900 + pool 300 = 1200 over 1000: wp 90%, pool clamped to the last 10%, over.
    expect(spendBarSegments({ wpLevel: 900, projectPool: 300, total: 1200 }, 1000)).toEqual({
      wpPct: 90,
      poolPct: 10,
      over: true,
    });
  });

  it("caps the wp segment at 100% when wpLevel alone exceeds budget", () => {
    expect(spendBarSegments({ wpLevel: 1200, projectPool: 0, total: 1200 }, 1000)).toEqual({
      wpPct: 100,
      poolPct: 0,
      over: true,
    });
  });

  it("a pool-only project fills just the pool segment", () => {
    expect(spendBarSegments({ wpLevel: 0, projectPool: 200, total: 200 }, 1000)).toEqual({
      wpPct: 0,
      poolPct: 20,
      over: false,
    });
  });

  it("no budget (null or zero) → empty bar, never over", () => {
    expect(spendBarSegments({ wpLevel: 500, projectPool: 0, total: 500 }, null)).toEqual({
      wpPct: 0,
      poolPct: 0,
      over: false,
    });
    expect(spendBarSegments({ wpLevel: 500, projectPool: 0, total: 500 }, 0)).toEqual({
      wpPct: 0,
      poolPct: 0,
      over: false,
    });
  });
});

describe("budgetStatus", () => {
  it("no budget → hasBudget false, pctUsed null, never over", () => {
    expect(budgetStatus(null, 500)).toEqual({
      hasBudget: false,
      budget: null,
      spend: 500,
      remaining: null,
      pctUsed: null,
      over: false,
    });
  });

  it("zero budget is treated as no budget (no divide-by-zero)", () => {
    expect(budgetStatus(0, 500).hasBudget).toBe(false);
  });

  it("under budget", () => {
    expect(budgetStatus(1000, 250)).toEqual({
      hasBudget: true,
      budget: 1000,
      spend: 250,
      remaining: 750,
      pctUsed: 25,
      over: false,
    });
  });

  it("over budget → over true, negative remaining, pct > 100", () => {
    const r = budgetStatus(1000, 1500);
    expect(r.over).toBe(true);
    expect(r.remaining).toBe(-500);
    expect(r.pctUsed).toBe(150);
  });
});
