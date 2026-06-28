// Spec 100 — dashboard money helpers (PM/super only). spend = labor +
// materials; materials counts only spend-status PRs that recorded a price.

import { describe, expect, it } from "vitest";
import { SPEND_STATUSES, sumMaterials, sumStoreIssues, budgetStatus } from "@/lib/dashboard/spend";

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
