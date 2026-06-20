// Spec 161 U13 — summarizeLedger: the Nova economy snapshot derived from the coin
// ledger (issued / returned / outstanding / holders / by-source). Pure function so
// the page just renders it. Amounts can arrive as strings (PostgREST numeric).

import { describe, it, expect } from "vitest";
import { summarizeLedger } from "@/lib/nova/economy-summary";

describe("summarizeLedger", () => {
  it("returns zeros for an empty ledger", () => {
    const s = summarizeLedger([]);
    expect(s).toEqual({ issued: 0, returned: 0, outstanding: 0, holders: 0, bySource: {} });
  });

  it("sums issued (positive) vs returned (|negative|) and nets outstanding", () => {
    const s = summarizeLedger([
      { worker_id: "w1", source: "profit_share", amount: 1000 },
      { worker_id: "w1", source: "shop_redemption", amount: -100 },
      { worker_id: "w2", source: "profit_share", amount: 500 },
      { worker_id: "w2", source: "confiscation", amount: -500 },
    ]);
    expect(s.issued).toBe(1500);
    expect(s.returned).toBe(600);
    expect(s.outstanding).toBe(900);
    expect(s.bySource).toEqual({ profit_share: 1500, shop_redemption: -100, confiscation: -500 });
  });

  it("counts only workers with a positive net balance as holders", () => {
    // w1 net 900 (>0), w2 net 0 (fully clawed) → 1 holder.
    const s = summarizeLedger([
      { worker_id: "w1", source: "profit_share", amount: 1000 },
      { worker_id: "w1", source: "shop_redemption", amount: -100 },
      { worker_id: "w2", source: "profit_share", amount: 500 },
      { worker_id: "w2", source: "confiscation", amount: -500 },
    ]);
    expect(s.holders).toBe(1);
  });

  it("coerces string amounts (PostgREST numeric) before math", () => {
    const s = summarizeLedger([
      { worker_id: "w1", source: "profit_share", amount: "1000.5000" },
      { worker_id: "w1", source: "savers_bonus", amount: "0.5000" },
    ]);
    expect(s.issued).toBe(1001);
    expect(s.outstanding).toBe(1001);
    expect(s.holders).toBe(1);
  });
});
