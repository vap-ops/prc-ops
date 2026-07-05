// Spec 270 U4 — pure งาน-level money summary over the child งานย่อย set.
// Mirrors the dashboard wpLevel formula scoped to one group's leaves:
// materials (spend-status PRs, minus store-routed) + เบิก (non-reversed
// issues) − WP→store returns (the spec-209 double-count trap). Labor rides
// as its own figure. Pure — no I/O.

import { describe, expect, it } from "vitest";
import { groupSpendSummary } from "@/lib/work-packages/group-detail";

describe("groupSpendSummary", () => {
  it("sums materials + issues − returns, labor separate, total = both", () => {
    const s = groupSpendSummary({
      prs: [
        { id: "pr1", status: "delivered", amount: 1000 },
        { id: "pr2", status: "requested", amount: 500 }, // not spend
        { id: "pr3", status: "purchased", amount: null }, // unpriced
      ],
      storedPrIds: new Set<string>(),
      issues: [{ total_cost: 300 }, { total_cost: null }],
      returns: [{ total_cost: 120 }],
      laborTotal: 900,
    });
    expect(s.materials).toBe(1000);
    expect(s.storeIssues).toBe(300);
    expect(s.storeReturns).toBe(120);
    expect(s.materialNet).toBe(1180); // 1000 + 300 − 120
    expect(s.laborTotal).toBe(900);
    expect(s.total).toBe(2080);
  });

  it("excludes store-routed PRs (counted at เบิก instead)", () => {
    const s = groupSpendSummary({
      prs: [{ id: "pr1", status: "delivered", amount: 700 }],
      storedPrIds: new Set(["pr1"]),
      issues: [{ total_cost: 700 }],
      returns: [],
      laborTotal: 0,
    });
    expect(s.materials).toBe(0);
    expect(s.materialNet).toBe(700);
  });

  it("kills float noise in the sums (round2 — 0.1 + 0.2 is exactly 0.3)", () => {
    const s = groupSpendSummary({
      prs: [{ id: "a", status: "delivered", amount: 0.1 }],
      storedPrIds: new Set<string>(),
      issues: [{ total_cost: 0.2 }],
      returns: [],
      laborTotal: 0,
    });
    expect(s.materialNet).toBe(0.3); // not 0.30000000000000004
    expect(s.total).toBe(0.3);
  });

  it("all-empty group nets zero everywhere", () => {
    const s = groupSpendSummary({
      prs: [],
      storedPrIds: new Set<string>(),
      issues: [],
      returns: [],
      laborTotal: 0,
    });
    expect(s).toEqual({
      materials: 0,
      storeIssues: 0,
      storeReturns: 0,
      materialNet: 0,
      laborTotal: 0,
      total: 0,
    });
  });
});
