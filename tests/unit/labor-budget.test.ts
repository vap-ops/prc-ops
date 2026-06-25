import { describe, it, expect } from "vitest";
import { laborBudgetSummary } from "@/lib/labor/budget";

// Spec 205 U2 — per-WP labor budget vs actual. Pure derivation behind the PM
// review card. The 0-vs-NULL distinction matters: NULL = unset (show the "set a
// budget" prompt), 0 = a real budget of zero (any labor spend is over budget).

describe("laborBudgetSummary", () => {
  it("unset (NULL) → not set, no comparison, ok tone", () => {
    const s = laborBudgetSummary(null, 5000);
    expect(s.isSet).toBe(false);
    expect(s.budget).toBeNull();
    expect(s.remaining).toBeNull();
    expect(s.pctUsed).toBeNull();
    expect(s.over).toBe(false);
    expect(s.tone).toBe("ok");
  });

  it("under budget → positive remaining, ok tone", () => {
    const s = laborBudgetSummary(100000, 40000);
    expect(s.isSet).toBe(true);
    expect(s.spend).toBe(40000);
    expect(s.remaining).toBe(60000);
    expect(s.pctUsed).toBe(40);
    expect(s.over).toBe(false);
    expect(s.tone).toBe("ok");
  });

  it("near budget (>=90% and not over) → attn tone", () => {
    const s = laborBudgetSummary(100000, 95000);
    expect(s.pctUsed).toBe(95);
    expect(s.over).toBe(false);
    expect(s.tone).toBe("attn");
  });

  it("exactly at budget → 100%, not over, attn tone", () => {
    const s = laborBudgetSummary(100000, 100000);
    expect(s.remaining).toBe(0);
    expect(s.pctUsed).toBe(100);
    expect(s.over).toBe(false);
    expect(s.tone).toBe("attn");
  });

  it("over budget → negative remaining, over tone", () => {
    const s = laborBudgetSummary(100000, 130000);
    expect(s.remaining).toBe(-30000);
    expect(s.pctUsed).toBe(130);
    expect(s.over).toBe(true);
    expect(s.tone).toBe("over");
  });

  it("budget of 0 with no spend → set, 0%, ok tone (distinct from unset)", () => {
    const s = laborBudgetSummary(0, 0);
    expect(s.isSet).toBe(true);
    expect(s.budget).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.pctUsed).toBe(0);
    expect(s.over).toBe(false);
    expect(s.tone).toBe("ok");
  });

  it("budget of 0 with spend → over (you budgeted zero), null pct, over tone", () => {
    const s = laborBudgetSummary(0, 5000);
    expect(s.isSet).toBe(true);
    expect(s.remaining).toBe(-5000);
    expect(s.pctUsed).toBeNull();
    expect(s.over).toBe(true);
    expect(s.tone).toBe("over");
  });

  it("floors the percentage to a whole number", () => {
    const s = laborBudgetSummary(30000, 10000);
    expect(s.pctUsed).toBe(33);
  });

  it("just under budget (fractional) → floors to 99%, not over, money still remaining", () => {
    // 998/1000 = 99.8% — must NOT round up to 100% (a full bar) while under budget.
    const s = laborBudgetSummary(1000, 998);
    expect(s.pctUsed).toBe(99);
    expect(s.over).toBe(false);
    expect(s.remaining).toBe(2);
    expect(s.tone).toBe("attn");
  });

  it("attn boundary is exactly 90% (floored): 89.9% stays ok, 90% turns attn", () => {
    expect(laborBudgetSummary(1000, 899).pctUsed).toBe(89);
    expect(laborBudgetSummary(1000, 899).tone).toBe("ok");
    expect(laborBudgetSummary(1000, 900).pctUsed).toBe(90);
    expect(laborBudgetSummary(1000, 900).tone).toBe("attn");
  });
});
