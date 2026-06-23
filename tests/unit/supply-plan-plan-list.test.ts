import { describe, it, expect } from "vitest";
import { buildPlanList, type SupplyPlanRow } from "@/lib/supply-plan/plan-list";

// Spec 189 U2 — buildPlanList turns a project's plans (ordered by creation) into
// the list view models: auto-label by order (#1, #2…), line count, selected flag.
describe("buildPlanList", () => {
  const plans: SupplyPlanRow[] = [
    { id: "p1", status: "draft", createdAt: "2026-06-01T00:00:00Z" },
    { id: "p2", status: "approved", createdAt: "2026-06-10T00:00:00Z" },
  ];

  it("labels plans by creation order (#1, #2)", () => {
    expect(buildPlanList(plans, {}, null).map((p) => p.label)).toEqual(["แผน #1", "แผน #2"]);
  });

  it("maps line counts, defaulting a missing plan to 0", () => {
    const out = buildPlanList(plans, { p1: 3 }, null);
    expect(out.find((p) => p.id === "p1")?.lineCount).toBe(3);
    expect(out.find((p) => p.id === "p2")?.lineCount).toBe(0);
  });

  it("marks the selected plan and only that one", () => {
    const out = buildPlanList(plans, {}, "p2");
    expect(out.find((p) => p.id === "p2")?.selected).toBe(true);
    expect(out.find((p) => p.id === "p1")?.selected).toBe(false);
  });

  it("selects none when selectedId is not in the list", () => {
    expect(buildPlanList(plans, {}, "nope").every((p) => !p.selected)).toBe(true);
  });

  it("carries status and createdAt through unchanged", () => {
    expect(buildPlanList(plans, {}, null)[0]).toMatchObject({
      status: "draft",
      createdAt: "2026-06-01T00:00:00Z",
    });
  });
});
