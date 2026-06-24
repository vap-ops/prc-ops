// Writing failing test first.
//
// Spec 196 Tier 1 — the GL ledger drill: accounting taps a trial-balance account
// and sees every journal line that hit it in the period, with the source document
// it came from. ledger-view.ts is the pure shaping: a Thai label for each source
// table (so an auditor reads "ใบขอซื้อ" not "purchase_requests") and a running
// total of the lines (debit, credit, and the net movement = debit − credit).

import { describe, expect, it } from "vitest";

import { sourceDocLabel, summarizeLedger } from "@/lib/accounting/ledger-view";

describe("sourceDocLabel", () => {
  it("maps known purchase/store/billing source tables to Thai labels", () => {
    expect(sourceDocLabel("purchase_requests")).toBe("ใบขอซื้อ");
    expect(sourceDocLabel("stock_receipts")).toBe("รับเข้าสต๊อก");
    expect(sourceDocLabel("stock_issues")).toBe("เบิกของ");
  });

  it("falls back to the raw source table for an unknown kind (forward-compatible)", () => {
    expect(sourceDocLabel("some_future_feed")).toBe("some_future_feed");
  });
});

describe("summarizeLedger", () => {
  it("totals debits and credits and nets them (debit − credit)", () => {
    const s = summarizeLedger([
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 250 },
      { debit: 70, credit: 0 },
    ]);
    expect(s.totalDebit).toBe(1070);
    expect(s.totalCredit).toBe(250);
    expect(s.net).toBe(820);
  });

  it("is zero for an empty ledger", () => {
    expect(summarizeLedger([])).toEqual({ totalDebit: 0, totalCredit: 0, net: 0 });
  });

  it("nets to a credit balance (negative) when credits exceed debits — an AP account", () => {
    const s = summarizeLedger([
      { debit: 0, credit: 5000 },
      { debit: 1200, credit: 0 },
    ]);
    expect(s.net).toBe(-3800);
  });

  it("compares in integer satang — no float drift on .01 sums", () => {
    const s = summarizeLedger([
      { debit: 0.1, credit: 0 },
      { debit: 0.2, credit: 0 },
    ]);
    expect(s.totalDebit).toBe(0.3);
  });
});
