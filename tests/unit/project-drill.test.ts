// Spec 253 U1 — finance project drill view-model: the revenue funnel assembled
// from quotations / client POs / contract+งวด / billings / receipts. Pure layer,
// no business math in components. Writing failing test first.

import { describe, expect, it } from "vitest";
import { assembleRevenueFunnel, type RevenueFunnelInput } from "@/lib/accounting/project-drill";

const base: RevenueFunnelInput = {
  quotations: [
    { id: "q1", quotationNo: "Q-001", amount: 500000, quoteDate: "2026-06-01", status: "accepted" },
  ],
  clientPos: [{ id: "po1", poNo: "PO-9", amount: 500000, poDate: "2026-06-05", quotationId: "q1" }],
  contract: {
    id: "c1",
    contractValue: 620000,
    retentionRate: 5,
    signDate: "2026-06-10",
  },
  installments: [
    { id: "i1", seq: 1, label: "งวดที่ 1", amount: 200000, plannedDate: null },
    { id: "i2", seq: 2, label: "งวดที่ 2", amount: 420000, plannedDate: null },
  ],
  billings: [
    {
      id: "b1",
      installmentId: "i1",
      grossAmount: 200000,
      netReceivable: 198000,
      status: "invoiced",
    },
    { id: "b2", installmentId: null, grossAmount: 50000, netReceivable: null, status: "draft" },
  ],
  receipts: [
    { id: "r1", billingId: "b1", amount: 100000, receivedDate: "2026-07-01", supersededBy: null },
    { id: "r2", billingId: null, amount: 30000, receivedDate: "2026-07-02", supersededBy: null },
  ],
};

describe("assembleRevenueFunnel", () => {
  it("assembles tiles, per-งวด rollup, and coverage", () => {
    const f = assembleRevenueFunnel(base);
    expect(f.tiles).toMatchObject({
      billed: 198000,
      received: 130000,
      advances: 30000,
      outstanding: 98000,
    });
    expect(f.installments[0]).toMatchObject({ id: "i1", billed: 200000, received: 100000 });
    expect(f.installments[1]).toMatchObject({ id: "i2", billed: 0, received: 0 });
  });

  it("no sum warning when งวด total matches the contract", () => {
    const f = assembleRevenueFunnel(base);
    expect(f.sumWarning).toBeNull();
  });

  it("handles the receipts-only project (slow-contract case) without blowing up", () => {
    const f = assembleRevenueFunnel({
      quotations: [],
      clientPos: [],
      contract: null,
      installments: [],
      billings: [],
      receipts: [
        {
          id: "r1",
          billingId: null,
          amount: 80000,
          receivedDate: "2026-07-01",
          supersededBy: null,
        },
      ],
    });
    expect(f.tiles).toMatchObject({ billed: 0, received: 80000, advances: 80000, outstanding: 0 });
    expect(f.installments).toEqual([]);
    expect(f.sumWarning).toBeNull();
  });

  it("excludes superseded receipts from per-งวด received", () => {
    const f = assembleRevenueFunnel({
      ...base,
      receipts: [
        {
          id: "r1",
          billingId: "b1",
          amount: 100000,
          receivedDate: "2026-07-01",
          supersededBy: null,
        },
        {
          id: "rx",
          billingId: "b1",
          amount: 90000,
          receivedDate: "2026-07-01",
          supersededBy: "r1",
        },
      ],
    });
    // rx supersedes r1 → only rx counts.
    expect(f.installments[0]?.received).toBe(90000);
    expect(f.tiles.received).toBe(90000);
  });
});

// Spec 253 U2 — committed vs actual material split (writing failing test first).
import { splitMaterialSpend } from "@/lib/accounting/project-drill";

describe("splitMaterialSpend", () => {
  const pr = (id: string, status: string, amount: number | null) => ({ id, status, amount });

  it("splits committed (purchased/on_route) from actual (delivered/site_purchased)", () => {
    const s = splitMaterialSpend(
      [
        pr("p1", "purchased", 1000),
        pr("p2", "on_route", 2000),
        pr("p3", "delivered", 3000),
        pr("p4", "site_purchased", 400),
        pr("p5", "approved", 9999), // not spend
      ],
      new Set(),
    );
    expect(s.committed).toBe(3000);
    expect(s.actualPurchases).toBe(3400);
    expect(s.awaitingPriceCount).toBe(0);
  });

  it("counts null-amount spend PRs as the awaiting-price blind spot", () => {
    const s = splitMaterialSpend(
      [pr("p1", "purchased", null), pr("p2", "delivered", null), pr("p3", "delivered", 500)],
      new Set(),
    );
    expect(s.committed).toBe(0);
    expect(s.actualPurchases).toBe(500);
    expect(s.awaitingPriceCount).toBe(2);
  });

  it("excludes store-routed PRs entirely (counted at เบิก)", () => {
    const s = splitMaterialSpend([pr("p1", "delivered", 700)], new Set(["p1"]));
    expect(s.actualPurchases).toBe(0);
    expect(s.awaitingPriceCount).toBe(0);
  });
});
