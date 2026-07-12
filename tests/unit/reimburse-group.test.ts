import { describe, it, expect } from "vitest";
import { groupByReimburseTarget, type ReimbursableRow } from "@/lib/expenses/reimburse-group";

const row = (over: Partial<ReimbursableRow>): ReimbursableRow => ({
  id: "x",
  reimburseToUserId: "u1",
  reimburseToName: "Pattrawut",
  amount: 100,
  categoryLabel: "น้ำมัน",
  expenseDate: "2026-07-12",
  description: "",
  ...over,
});

describe("groupByReimburseTarget", () => {
  it("groups by target and sums per person", () => {
    const groups = groupByReimburseTarget([
      row({ id: "1", reimburseToUserId: "u1", amount: 100 }),
      row({ id: "2", reimburseToUserId: "u1", amount: 50 }),
      row({ id: "3", reimburseToUserId: "u2", reimburseToName: "Acc", amount: 200 }),
    ]);
    expect(groups).toHaveLength(2);
    const u1 = groups.find((g) => g.userId === "u1");
    expect(u1?.total).toBe(150);
    expect(u1?.items).toHaveLength(2);
    const u2 = groups.find((g) => g.userId === "u2");
    expect(u2?.total).toBe(200);
    expect(u2?.name).toBe("Acc");
  });

  it("returns [] for no rows", () => {
    expect(groupByReimburseTarget([])).toEqual([]);
  });

  it("orders groups by descending total", () => {
    const groups = groupByReimburseTarget([
      row({ id: "1", reimburseToUserId: "small", amount: 10 }),
      row({ id: "2", reimburseToUserId: "big", amount: 999 }),
    ]);
    expect(groups[0]?.userId).toBe("big");
  });
});
