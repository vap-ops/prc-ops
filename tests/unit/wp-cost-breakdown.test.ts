import { describe, expect, it } from "vitest";
import {
  attributeRentalCost,
  buildWpCostRows,
  projectCostFamilies,
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
    expect(fam.execution.labour).toBe(900);
    expect(fam.execution.equipment).toBe(3000);
    expect(fam.execution.total).toBe(3900);
    expect(fam.grand).toBe(5350.01);
  });
});
