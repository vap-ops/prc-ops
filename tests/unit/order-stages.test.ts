import { describe, expect, it } from "vitest";
import { ORDER_STAGES, orderStageStates } from "@/lib/purchasing/order-stages";

// Spec 111 — the shared lifecycle stage-state logic (extracted from the spec-22
// tracker). Mirrors the tracker test at the data level. Pure, TDD-first.

describe("orderStageStates", () => {
  it("exposes the five lifecycle stages in order", () => {
    expect(ORDER_STAGES).toEqual(["requested", "approved", "purchased", "on_route", "delivered"]);
  });

  it("requested: stage 0 done + current, the rest pending", () => {
    const s = orderStageStates("requested");
    expect(s.map((x) => x.state)).toEqual(["done", "pending", "pending", "pending", "pending"]);
    expect(s.map((x) => x.isCurrent)).toEqual([true, false, false, false, false]);
    expect(s[0]!.reached).toBe(true);
    expect(s[1]!.reached).toBe(false);
  });

  it("on_route: stages 0-3 done (3 current), delivered pending", () => {
    const s = orderStageStates("on_route");
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "done", "pending"]);
    expect(s.findIndex((x) => x.isCurrent)).toBe(3);
  });

  it("delivered: all done, last is current", () => {
    const s = orderStageStates("delivered");
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(s[4]!.isCurrent).toBe(true);
  });

  it("rejected: done, rejected (current), then cancelled", () => {
    const s = orderStageStates("rejected");
    expect(s.map((x) => x.state)).toEqual([
      "done",
      "rejected",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(s[1]!.isCurrent).toBe(true);
    expect(s[1]!.reached).toBe(true); // rejected terminal counts as reached
  });

  it("cancelled: approve done, the rest muted cancelled (no red)", () => {
    const s = orderStageStates("cancelled");
    expect(s.map((x) => x.state)).toEqual(["done", "done", "cancelled", "cancelled", "cancelled"]);
    expect(s.some((x) => x.state === "rejected")).toBe(false);
  });

  it("site_purchased: ranked terminal (all done)", () => {
    const s = orderStageStates("site_purchased");
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "done", "done"]);
  });
});
