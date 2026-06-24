// Spec 192 U1 — the membership safety net. A project's visibility is gated on
// membership (can_see_project, ADR 0056), so removing the LAST member orphans the
// project (invisible to everyone but super_admin). Pure decision: block the last
// removal; flag a self-removal (when others remain) for a confirm.

import { describe, it, expect } from "vitest";
import { evaluateMemberRemoval } from "@/lib/projects/member-removal";

describe("evaluateMemberRemoval", () => {
  it("blocks removing the last member (project must keep ≥1)", () => {
    expect(evaluateMemberRemoval({ totalMembers: 1, removingSelf: false })).toEqual({
      blocked: true,
      reason: "LAST_MEMBER",
      needsConfirm: false,
    });
    // even removing yourself as the sole member is blocked
    expect(evaluateMemberRemoval({ totalMembers: 1, removingSelf: true })).toEqual({
      blocked: true,
      reason: "LAST_MEMBER",
      needsConfirm: false,
    });
  });

  it("flags a self-removal for confirmation when others remain", () => {
    expect(evaluateMemberRemoval({ totalMembers: 3, removingSelf: true })).toEqual({
      blocked: false,
      needsConfirm: true,
    });
  });

  it("removing someone else (others remain) is unblocked and needs no confirm", () => {
    expect(evaluateMemberRemoval({ totalMembers: 2, removingSelf: false })).toEqual({
      blocked: false,
      needsConfirm: false,
    });
  });
});
