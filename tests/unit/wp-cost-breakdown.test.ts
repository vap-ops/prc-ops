import { describe, expect, it } from "vitest";
import {
  attributeRentalCost,
  buildWpCostRows,
  projectCostFamilies,
  reworkMaterialExposure,
  storeRoutedReworkTotal,
} from "@/lib/costs/wp-cost-breakdown";

// Spec 325 Phase 1 — per-WP material + labour composition over the EXISTING
// spend atoms (dashboard wpLevel formula per WP) + project family totals with
// equipment at PROJECT grain (settlement net via allocations). Pure model.

const labor = (wp: string, rate: number, fraction: "full" | "half" = "full") => ({
  id: `l-${Math.random().toString(36).slice(2)}`,
  worker_id: "w1",
  work_date: "2026-07-01",
  day_fraction: fraction,
  day_rate_snapshot: rate,
  pay_type_snapshot: "daily" as const,
  worker_name_snapshot: "ช่าง",
  self_logged: false,
  superseded_by: null,
  work_package_id: wp,
});

describe("buildWpCostRows", () => {
  const wps = [
    { id: "wp1", code: "A01", name: "งานผนัง" },
    { id: "wp2", code: "A02", name: "งานพื้น" },
  ];

  it("composes per-WP material (purchases + เบิก − returns) and labour", () => {
    const rows = buildWpCostRows({
      wps,
      prs: [
        { id: "p1", status: "delivered", amount: 1000, work_package_id: "wp1" },
        { id: "p2", status: "purchased", amount: 500, work_package_id: "wp2" },
        // not a spend status — never counted
        { id: "p3", status: "requested", amount: 9999, work_package_id: "wp1" },
      ],
      storedPrIds: new Set(),
      issues: [{ id: "i1", total_cost: 200, work_package_id: "wp1" }],
      reversedIssueIds: new Set(),
      returns: [{ total_cost: 50, work_package_id: "wp1" }],
      laborRows: [labor("wp1", 600), labor("wp1", 600, "half"), labor("wp2", 400)],
      laborBudgetByWp: new Map([["wp1", 5000]]),
    });

    expect(rows).toHaveLength(2);
    const wp1 = rows[0]!;
    expect(wp1.wpId).toBe("wp1");
    expect(wp1.material.purchases).toBe(1000);
    expect(wp1.material.storeIssues).toBe(200);
    expect(wp1.material.storeReturns).toBe(50);
    expect(wp1.material.net).toBe(1150);
    expect(wp1.labour).toBe(900); // 600 + 300
    expect(wp1.laborBudget).toBe(5000);
    expect(wp1.total).toBe(2050);

    const wp2 = rows[1]!;
    expect(wp2.material.net).toBe(500);
    expect(wp2.labour).toBe(400);
    expect(wp2.laborBudget).toBeNull();
  });

  it("excludes store-routed PRs, reversed issues, and superseded labor", () => {
    const superseded = labor("wp1", 500);
    const superseder = { ...labor("wp1", 700), superseded_by: superseded.id };
    const rows = buildWpCostRows({
      wps: [wps[0]!],
      prs: [{ id: "p1", status: "delivered", amount: 800, work_package_id: "wp1" }],
      storedPrIds: new Set(["p1"]), // counted at เบิก instead
      issues: [
        { id: "i1", total_cost: 300, work_package_id: "wp1" },
        { id: "i2", total_cost: 400, work_package_id: "wp1" }, // reversed
      ],
      reversedIssueIds: new Set(["i2"]),
      returns: [],
      laborRows: [superseded, superseder],
      laborBudgetByWp: new Map(),
    });
    const wp1 = rows[0]!;
    expect(wp1.material.purchases).toBe(0);
    expect(wp1.material.storeIssues).toBe(300);
    expect(wp1.material.net).toBe(300);
    expect(wp1.labour).toBe(700); // only the superseding row
  });

  it("drops a stale row when a correction moves the day to ANOTHER WP (cross-WP supersede)", () => {
    // correct_labor_log can re-snapshot work_package_id: the superseding row B
    // lives in wp2 while pointing at wp1's row A. A per-WP anti-join would leave
    // A alive in wp1 (nothing in wp1's group points at it) → double count.
    const a = labor("wp1", 500);
    const b = { ...labor("wp2", 500), superseded_by: a.id };
    const rows = buildWpCostRows({
      wps,
      prs: [],
      storedPrIds: new Set(),
      issues: [],
      reversedIssueIds: new Set(),
      returns: [],
      laborRows: [a, b],
      laborBudgetByWp: new Map(),
    });
    expect(rows.find((r) => r.wpId === "wp1")!.labour).toBe(0);
    expect(rows.find((r) => r.wpId === "wp2")!.labour).toBe(500);
  });

  it("does not count a store-routed null-amount PR as awaiting-price", () => {
    const rows = buildWpCostRows({
      wps: [wps[0]!],
      prs: [{ id: "p1", status: "delivered", amount: null, work_package_id: "wp1" }],
      storedPrIds: new Set(["p1"]),
      issues: [],
      reversedIssueIds: new Set(),
      returns: [],
      laborRows: [],
      laborBudgetByWp: new Map(),
    });
    expect(rows[0]!.material.awaitingPriceCount).toBe(0);
  });

  it("rounds float noise out of material net (money SSOT)", () => {
    const rows = buildWpCostRows({
      wps: [wps[0]!],
      prs: [],
      storedPrIds: new Set(),
      issues: [
        { id: "i1", total_cost: 0.1, work_package_id: "wp1" },
        { id: "i2", total_cost: 0.2, work_package_id: "wp1" },
      ],
      reversedIssueIds: new Set(),
      returns: [],
      laborRows: [],
      laborBudgetByWp: new Map(),
    });
    expect(rows[0]!.material.storeIssues).toBe(0.3);
    expect(rows[0]!.material.net).toBe(0.3);
    expect(rows[0]!.total).toBe(0.3);
  });

  it("discloses awaiting-price count (null-amount spend-status PRs), never silently 0", () => {
    const rows = buildWpCostRows({
      wps: [wps[0]!],
      prs: [
        { id: "p1", status: "site_purchased", amount: null, work_package_id: "wp1" },
        { id: "p2", status: "requested", amount: null, work_package_id: "wp1" }, // not spend
        { id: "p3", status: "delivered", amount: 100, work_package_id: "wp1" },
      ],
      storedPrIds: new Set(),
      issues: [],
      reversedIssueIds: new Set(),
      returns: [],
      laborRows: [],
      laborBudgetByWp: new Map(),
    });
    expect(rows[0]!.material.awaitingPriceCount).toBe(1);
    expect(rows[0]!.material.net).toBe(100);
  });

  it("keeps atoms of unknown WPs out and sorts rows by code", () => {
    const rows = buildWpCostRows({
      wps: [wps[1]!, wps[0]!], // unsorted input
      prs: [{ id: "p1", status: "delivered", amount: 111, work_package_id: "ghost" }],
      storedPrIds: new Set(),
      issues: [],
      reversedIssueIds: new Set(),
      returns: [],
      laborRows: [],
      laborBudgetByWp: new Map(),
    });
    expect(rows.map((r) => r.code)).toEqual(["A01", "A02"]);
    expect(rows.every((r) => r.material.net === 0)).toBe(true);
  });
});

describe("attributeRentalCost", () => {
  const base = {
    batches: [
      { id: "b1", status: "active" as const },
      { id: "b2", status: "active" as const },
      { id: "b3", status: "cancelled" as const },
    ],
    allocations: [
      { batchId: "b1", projectId: "prj" },
      { batchId: "b2", projectId: "prj" },
      { batchId: "b2", projectId: "other" },
      { batchId: "b3", projectId: "prj" },
    ],
  };

  it("attributes single-project batch settlements; multi-project stays disclosed, unsplit", () => {
    const out = attributeRentalCost({
      ...base,
      settlements: [
        { id: "s1", agreementId: "b1", net: 3000, supersededBy: null },
        { id: "s2", agreementId: "b2", net: 5000, supersededBy: null },
      ],
      projectId: "prj",
    });
    expect(out.attributed).toBe(3000);
    expect(out.multiProjectNet).toBe(5000);
  });

  it("excludes superseded settlements, cancelled batches, and other-project batches", () => {
    const out = attributeRentalCost({
      batches: [...base.batches, { id: "b4", status: "active" as const }],
      allocations: [...base.allocations, { batchId: "b4", projectId: "other" }],
      settlements: [
        { id: "s1", agreementId: "b1", net: 1000, supersededBy: null },
        { id: "s2", agreementId: "b1", net: 1800, supersededBy: null },
        { id: "s3", agreementId: "b3", net: 7000, supersededBy: null }, // cancelled batch
        { id: "s4", agreementId: "b4", net: 400, supersededBy: null }, // other project
      ],
      projectId: "prj",
    });
    // s2 supersedes s1 via the anti-join (pointer on the correcting row)
    const withChain = attributeRentalCost({
      ...base,
      settlements: [
        { id: "s1", agreementId: "b1", net: 1000, supersededBy: null },
        { id: "s2", agreementId: "b1", net: 1800, supersededBy: "s1" },
      ],
      projectId: "prj",
    });
    expect(out.attributed).toBe(2800); // both live s1+s2 (no chain in `out`)
    expect(out.multiProjectNet).toBe(0);
    expect(withChain.attributed).toBe(1800);
  });

  it("skips a settlement whose batch has no allocation rows (out of every project's scope)", () => {
    const out = attributeRentalCost({
      batches: [{ id: "b9", status: "active" as const }],
      allocations: [],
      settlements: [{ id: "s1", agreementId: "b9", net: 999, supersededBy: null }],
      projectId: "prj",
    });
    expect(out.attributed).toBe(0);
    expect(out.multiProjectNet).toBe(0);
  });
});

describe("storeRoutedReworkTotal", () => {
  const receipts = [
    { id: "r1", purchaseRequestId: "pA", totalCost: 900 }, // rework, not reversed
    { id: "r2", purchaseRequestId: "pB", totalCost: 1500 }, // rework, fully reversed
    { id: "r3", purchaseRequestId: "pC", totalCost: 700 }, // NOT rework
    { id: "r4", purchaseRequestId: null, totalCost: 300 }, // no PR link
    { id: "r5", purchaseRequestId: "pD", totalCost: 2000 }, // rework, partially reversed
  ];
  const reworkPrIds = new Set(["pA", "pB", "pD"]);

  it("sums only rework receipts and nets receipt-level reversals to match the pool", () => {
    // A reversed rework receipt leaves its positive stock_receipts row but its
    // value has already left stock_on_hand (reverse_stock_receipt), so the
    // carve-out must net the reversal or it over-states rework.
    const reversalNet = new Map([
      ["r2", -1500], // full reversal → nets to 0
      ["r5", -800], // partial → 1200 remains
    ]);
    expect(storeRoutedReworkTotal(receipts, reworkPrIds, reversalNet)).toBe(2100); // 900 + 0 + 1200
  });

  it("with no reversals sums the plain rework receipt costs", () => {
    expect(storeRoutedReworkTotal(receipts, reworkPrIds, new Map())).toBe(4400); // 900 + 1500 + 2000
  });

  it("clamps an over-reversed receipt at 0 (never negative)", () => {
    expect(
      storeRoutedReworkTotal(
        [{ id: "r1", purchaseRequestId: "pA", totalCost: 900 }],
        new Set(["pA"]),
        new Map([["r1", -1000]]),
      ),
    ).toBe(0);
  });
});

describe("reworkMaterialExposure", () => {
  it("sums the store-routed rework receipts and direct WP rework purchases", () => {
    // Spec 325 Phase 2: cause routed by reason_code IN (rework,breakage). The
    // store-routed atom is the RECEIPT cost (the pool holds the receipt figure,
    // not the PR amount); the direct atom is the WP-bound purchase amount.
    expect(
      reworkMaterialExposure({
        storeRoutedReworkReceipts: 4331.79,
        directWpReworkPurchases: 0,
        materialTotal: 1_950_138.86,
      }),
    ).toBe(4331.79);
    expect(
      reworkMaterialExposure({
        storeRoutedReworkReceipts: 100.005,
        directWpReworkPurchases: 50,
        materialTotal: 1000,
      }),
    ).toBe(150.01);
  });

  it("caps at material total so planned can never go negative (valuation edge)", () => {
    expect(
      reworkMaterialExposure({
        storeRoutedReworkReceipts: 1200,
        directWpReworkPurchases: 0,
        materialTotal: 1000,
      }),
    ).toBe(1000);
  });
});

describe("projectCostFamilies", () => {
  it("rolls material (WP-bound + store pool) vs execution (labour + equipment)", () => {
    const fam = projectCostFamilies({
      materialWpNet: 1150.005,
      storePool: 300,
      labourTotal: 900,
      equipmentAttributed: 3000,
    });
    expect(fam.material.wpBound).toBe(1150.01);
    expect(fam.material.storePool).toBe(300);
    expect(fam.material.total).toBe(1450.01);
    // No rework → planned == gross, rework line = 0.
    expect(fam.material.planned).toBe(1450.01);
    expect(fam.rework).toBe(0);
    expect(fam.execution.labour).toBe(900);
    expect(fam.execution.equipment).toBe(3000);
    expect(fam.execution.total).toBe(3900);
    expect(fam.grand).toBe(5350.01);
  });

  it("carves rework OUT of material as planned, leaving grand + invariant intact", () => {
    const fam = projectCostFamilies({
      materialWpNet: 1000,
      storePool: 950,
      labourTotal: 900,
      equipmentAttributed: 100,
      reworkMaterial: 300, // ⊆ material total (1950), reclassified out
    });
    expect(fam.material.total).toBe(1950); // GROSS unchanged
    expect(fam.material.planned).toBe(1650); // gross − rework
    expect(fam.rework).toBe(300);
    expect(fam.execution.total).toBe(1000);
    // Grand is the SAME as if rework were 0 (reclassification, not addition).
    expect(fam.grand).toBe(2950); // gross material 1950 + execution 1000
    // The view's three visible numbers reconcile to grand — no double-count.
    expect(fam.material.planned + fam.execution.total + fam.rework).toBe(fam.grand);
  });

  it("caps rework at material total (never a negative planned)", () => {
    const fam = projectCostFamilies({
      materialWpNet: 500,
      storePool: 0,
      labourTotal: 0,
      equipmentAttributed: 0,
      reworkMaterial: 900, // exceeds material — capped
    });
    expect(fam.material.planned).toBe(0);
    expect(fam.rework).toBe(500);
    expect(fam.grand).toBe(500);
  });
});
