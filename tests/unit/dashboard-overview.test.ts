// Spec 100 — dashboard operational rollup (money-free; all roles).

import { describe, expect, it } from "vitest";
import { rollupProgress } from "@/lib/dashboard/overview";

describe("rollupProgress", () => {
  it("empty → all zeros", () => {
    expect(rollupProgress([])).toEqual({
      total: 0,
      complete: 0,
      pctComplete: 0,
      needsAttention: 0,
    });
  });

  it("counts complete + attention and rounds pctComplete", () => {
    const r = rollupProgress([
      { status: "complete" },
      { status: "complete" },
      { status: "in_progress" },
      { status: "on_hold" },
      { status: "pending_approval" },
      { status: "not_started" },
    ]);
    expect(r.total).toBe(6);
    expect(r.complete).toBe(2);
    expect(r.pctComplete).toBe(33); // 2/6 = 33.3 → 33
    expect(r.needsAttention).toBe(2); // on_hold + pending_approval
  });

  it("all complete → 100", () => {
    expect(rollupProgress([{ status: "complete" }, { status: "complete" }]).pctComplete).toBe(100);
  });

  // Operator (spec 218): a defect-reopened WP (rework) needs a human — it must
  // count in งานต้องดูแล alongside on_hold + pending_approval.
  it("counts 'rework' as needs-attention", () => {
    const r = rollupProgress([
      { status: "rework" },
      { status: "on_hold" },
      { status: "pending_approval" },
      { status: "in_progress" },
      { status: "complete" },
    ]);
    expect(r.needsAttention).toBe(3); // rework + on_hold + pending_approval
  });
});
