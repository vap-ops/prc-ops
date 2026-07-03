// Spec 249 U2 — pure receipt rollups: anti-join current-state, per-billing
// coverage, per-project funnel summary. Writing failing test first.

import { describe, expect, it } from "vitest";
import {
  currentReceipts,
  billingCoverage,
  projectReceiptSummary,
  type ReceiptRow,
  type BillingForSummary,
} from "@/lib/accounting/receipts";

const r = (
  id: string,
  billingId: string | null,
  amount: number | null,
  supersededBy: string | null = null,
): ReceiptRow => ({ id, billingId, amount, receivedDate: "2026-07-03", supersededBy });

describe("currentReceipts", () => {
  it("drops superseded rows and tombstones", () => {
    const rows = [
      r("r1", "b1", 100), // superseded by r3
      r("r2", null, 50), // live advance
      r("r3", "b1", 120, "r1"), // live replacement
      r("r4", null, null, "r2x"), // tombstone (never current)
    ];
    expect(currentReceipts(rows).map((x) => x.id)).toEqual(["r2", "r3"]);
  });
});

describe("billingCoverage", () => {
  it("computes received + outstanding against net_receivable", () => {
    const cov = billingCoverage(99000, [r("r1", "b1", 50000), r("r2", "b1", 20000)]);
    expect(cov.received).toBe(70000);
    expect(cov.outstanding).toBe(29000);
    expect(cov.covered).toBe(false);
  });

  it("caps covered at true when receipts meet net", () => {
    const cov = billingCoverage(99000, [r("r1", "b1", 99000)]);
    expect(cov.covered).toBe(true);
    expect(cov.outstanding).toBe(0);
  });

  it("uncertified billing (null net) reports received but no outstanding", () => {
    const cov = billingCoverage(null, [r("r1", "b1", 10000)]);
    expect(cov.received).toBe(10000);
    expect(cov.outstanding).toBeNull();
  });
});

describe("projectReceiptSummary", () => {
  const billings: BillingForSummary[] = [
    { id: "b1", netReceivable: 99000, status: "invoiced" },
    { id: "b2", netReceivable: 49500, status: "certified" },
    { id: "b3", netReceivable: null, status: "draft" },
  ];

  it("splits received into allocated + advances and sums outstanding", () => {
    const receipts = [
      r("r1", "b1", 99000), // covers b1
      r("r2", null, 30000), // advance
      r("r3", "b2", 10000), // partial on b2
    ];
    const s = projectReceiptSummary(billings, receipts);
    expect(s.billed).toBe(148500); // b1 + b2 (certified+ only)
    expect(s.received).toBe(139000);
    expect(s.advances).toBe(30000);
    expect(s.outstanding).toBe(39500); // b2 shortfall only
  });

  it("ignores superseded rows in every figure", () => {
    const receipts = [r("r1", "b1", 99000, null), r("r0", "b1", 5000), r("rx", "b1", 99000, "r0")];
    // r0 superseded by rx → only r1 + rx count.
    const s = projectReceiptSummary(billings, receipts);
    expect(s.received).toBe(198000);
  });

  it("empty everything → zeros, no NaN", () => {
    const s = projectReceiptSummary([], []);
    expect(s).toMatchObject({ billed: 0, received: 0, advances: 0, outstanding: 0 });
  });
});
