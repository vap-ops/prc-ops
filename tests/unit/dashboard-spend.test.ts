// Spec 100 — dashboard money helpers (PM/super only). spend = labor +
// materials; materials counts only spend-status PRs that recorded a price.

import { describe, expect, it } from "vitest";
import { SPEND_STATUSES, sumMaterials, budgetStatus } from "@/lib/dashboard/spend";

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
        { status: "purchased", amount: 1000 },
        { status: "delivered", amount: 500 },
        { status: "site_purchased", amount: 250 },
        { status: "requested", amount: 999 }, // not spent yet
        { status: "approved", amount: 999 }, // not spent yet
        { status: "cancelled", amount: 999 },
        { status: "purchased", amount: null }, // no price recorded
      ]),
    ).toBe(1750);
  });

  it("empty → 0", () => {
    expect(sumMaterials([])).toBe(0);
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
