// Spec 92 Unit B — critical-path (CPM) pure function. Pins the float math:
// a single chain is entirely critical; the longer of two parallel branches is
// critical while the shorter carries float; no edges / cycles → empty.

import { describe, it, expect } from "vitest";
import { criticalWorkPackageIds } from "@/lib/work-packages/critical-path";

describe("criticalWorkPackageIds", () => {
  it("no dependencies → nothing critical", () => {
    const items = [{ id: "a", plannedStart: "2026-07-01", plannedEnd: "2026-07-10" }];
    expect(criticalWorkPackageIds(items, []).size).toBe(0);
  });

  it("a single dependency chain is entirely critical", () => {
    const items = [
      { id: "a", plannedStart: "2026-07-01", plannedEnd: "2026-07-05" },
      { id: "b", plannedStart: "2026-07-05", plannedEnd: "2026-07-12" },
      { id: "c", plannedStart: "2026-07-12", plannedEnd: "2026-07-15" },
    ];
    const edges = [
      { predecessorId: "a", successorId: "b" },
      { predecessorId: "b", successorId: "c" },
    ];
    const crit = criticalWorkPackageIds(items, edges);
    expect([...crit].sort()).toEqual(["a", "b", "c"]);
  });

  it("the longer parallel branch is critical; the shorter carries float", () => {
    // a → b(long) → d ; a → c(short) → d
    const items = [
      { id: "a", plannedStart: "2026-07-01", plannedEnd: "2026-07-03" },
      { id: "b", plannedStart: "2026-07-03", plannedEnd: "2026-07-20" },
      { id: "c", plannedStart: "2026-07-03", plannedEnd: "2026-07-05" },
      { id: "d", plannedStart: "2026-07-20", plannedEnd: "2026-07-22" },
    ];
    const edges = [
      { predecessorId: "a", successorId: "b" },
      { predecessorId: "a", successorId: "c" },
      { predecessorId: "b", successorId: "d" },
      { predecessorId: "c", successorId: "d" },
    ];
    const crit = criticalWorkPackageIds(items, edges);
    expect(crit.has("a")).toBe(true);
    expect(crit.has("b")).toBe(true);
    expect(crit.has("d")).toBe(true);
    expect(crit.has("c")).toBe(false); // float on the short branch
  });

  it("a cycle yields an empty set (defensive — the add RPC also rejects cycles)", () => {
    const items = [
      { id: "a", plannedStart: "2026-07-01", plannedEnd: "2026-07-05" },
      { id: "b", plannedStart: "2026-07-05", plannedEnd: "2026-07-10" },
    ];
    const edges = [
      { predecessorId: "a", successorId: "b" },
      { predecessorId: "b", successorId: "a" },
    ];
    expect(criticalWorkPackageIds(items, edges).size).toBe(0);
  });

  it("WPs with no planned dates don't get flagged (zero duration)", () => {
    const items = [
      { id: "a", plannedStart: null, plannedEnd: null },
      { id: "b", plannedStart: null, plannedEnd: null },
    ];
    const edges = [{ predecessorId: "a", successorId: "b" }];
    expect(criticalWorkPackageIds(items, edges).size).toBe(0);
  });
});
