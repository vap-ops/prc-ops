import { describe, it, expect } from "vitest";
import { aggregateCategorySpend, sumAmounts } from "@/lib/expenses/expense-summary";

describe("expense summary aggregation", () => {
  it("groups spend by category and sorts by total desc", () => {
    const out = aggregateCategorySpend([
      { label: "น้ำมัน", amount: 100 },
      { label: "ทางด่วน", amount: 300 },
      { label: "น้ำมัน", amount: 50 },
    ]);
    expect(out).toEqual([
      { label: "ทางด่วน", total: 300 },
      { label: "น้ำมัน", total: 150 },
    ]);
  });

  it("buckets a null category label under อื่นๆ", () => {
    const out = aggregateCategorySpend([{ label: null, amount: 20 }]);
    expect(out).toEqual([{ label: "อื่นๆ", total: 20 }]);
  });

  it("sums amounts", () => {
    expect(sumAmounts([{ amount: 10 }, { amount: 5.5 }])).toBe(15.5);
    expect(sumAmounts([])).toBe(0);
  });
});
