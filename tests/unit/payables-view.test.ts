// Writing failing test first.
//
// Spec 196 Tier 2 — the AP subledger (เจ้าหนี้การค้า). Accounts payable lives in
// the GL as account 2100 with a supplier_id dimension on each line; there is no
// separate AP table. aggregatePayables rolls the 2100 lines up per supplier into
// the outstanding balance owed = credit − debit (AP is credit-normal). Fully-paid
// suppliers (net zero) drop out — the register shows who we still owe.

import { describe, expect, it } from "vitest";

import { aggregatePayables } from "@/lib/accounting/payables-view";

describe("aggregatePayables", () => {
  it("nets each supplier's credit − debit and sorts by balance owed (desc)", () => {
    const agg = aggregatePayables([
      { supplierId: "a", debit: 2000, credit: 5000 },
      { supplierId: "b", debit: 0, credit: 1000 },
      { supplierId: "a", debit: 0, credit: 0 },
    ]);
    expect(agg.rows).toEqual([
      { supplierId: "a", balance: 3000 },
      { supplierId: "b", balance: 1000 },
    ]);
    expect(agg.total).toBe(4000);
  });

  it("drops a fully-paid supplier (net zero) from the outstanding register", () => {
    const agg = aggregatePayables([
      { supplierId: "paid", debit: 1000, credit: 1000 },
      { supplierId: "owed", debit: 0, credit: 750 },
    ]);
    expect(agg.rows).toEqual([{ supplierId: "owed", balance: 750 }]);
    expect(agg.total).toBe(750);
  });

  it("keeps a null-supplier bucket (a 2100 posting with no counterparty)", () => {
    const agg = aggregatePayables([{ supplierId: null, debit: 0, credit: 500 }]);
    expect(agg.rows).toEqual([{ supplierId: null, balance: 500 }]);
  });

  it("shows a debit balance (overpaid / prepaid supplier) as negative", () => {
    const agg = aggregatePayables([{ supplierId: "x", debit: 300, credit: 0 }]);
    expect(agg.rows).toEqual([{ supplierId: "x", balance: -300 }]);
  });

  it("sums in integer satang — no float drift", () => {
    const agg = aggregatePayables([
      { supplierId: "a", debit: 0, credit: 0.1 },
      { supplierId: "a", debit: 0, credit: 0.2 },
    ]);
    expect(agg.rows[0]!.balance).toBe(0.3);
  });

  it("is empty for no lines", () => {
    expect(aggregatePayables([])).toEqual({ rows: [], total: 0 });
  });
});
