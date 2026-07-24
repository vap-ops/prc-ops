// Pure helpers behind the PM approval UI: the latest-decision-per-WP
// reducer + the validation / transition predicates the server action
// and the form share.

import { describe, it, expect } from "vitest";

import {
  selectLatestDecisionByWorkPackage,
  type ApprovalRow,
} from "@/lib/approvals/latest-decision";
import { commentRequiredFor, isCommentValid, APPROVAL_DECISIONS } from "@/lib/approvals/predicates";

function row(partial: Partial<ApprovalRow> & Pick<ApprovalRow, "id" | "decided_at">): ApprovalRow {
  return {
    work_package_id: "wp-1",
    decision: "approved",
    comment: null,
    decided_by: "user-1",
    ...partial,
  };
}

describe("selectLatestDecisionByWorkPackage", () => {
  it("returns an empty map for empty input", () => {
    expect(selectLatestDecisionByWorkPackage([]).size).toBe(0);
  });

  it("keeps the single decision when only one row exists for a WP", () => {
    const r = row({ id: "a", work_package_id: "wp-1", decided_at: "2026-05-24T10:00:00Z" });
    const result = selectLatestDecisionByWorkPackage([r]);
    expect(result.get("wp-1")).toEqual(r);
  });

  it("returns the row with the maximum decided_at per WP", () => {
    const earlier = row({
      id: "a",
      work_package_id: "wp-1",
      decided_at: "2026-05-24T10:00:00Z",
      decision: "needs_revision",
      comment: "blurry",
    });
    const later = row({
      id: "b",
      work_package_id: "wp-1",
      decided_at: "2026-05-24T11:00:00Z",
      decision: "approved",
    });
    const result = selectLatestDecisionByWorkPackage([earlier, later]);
    expect(result.get("wp-1")).toEqual(later);
  });

  it("handles input in arbitrary order (reducer is order-independent)", () => {
    const earlier = row({
      id: "a",
      work_package_id: "wp-1",
      decided_at: "2026-05-24T10:00:00Z",
      decision: "needs_revision",
      comment: "blurry",
    });
    const later = row({
      id: "b",
      work_package_id: "wp-1",
      decided_at: "2026-05-24T11:00:00Z",
      decision: "approved",
    });
    const result = selectLatestDecisionByWorkPackage([later, earlier]);
    expect(result.get("wp-1")).toEqual(later);
  });

  it("keeps each WP's latest independently", () => {
    const rows: ApprovalRow[] = [
      row({ id: "1", work_package_id: "wp-A", decided_at: "2026-05-24T09:00:00Z" }),
      row({
        id: "2",
        work_package_id: "wp-A",
        decided_at: "2026-05-24T11:00:00Z",
        decision: "needs_revision",
        comment: "x",
      }),
      row({
        id: "3",
        work_package_id: "wp-B",
        decided_at: "2026-05-24T10:00:00Z",
        decision: "rejected",
        comment: "y",
      }),
    ];
    const result = selectLatestDecisionByWorkPackage(rows);
    expect(result.get("wp-A")?.id).toBe("2");
    expect(result.get("wp-B")?.id).toBe("3");
    expect(result.size).toBe(2);
  });
});

describe("commentRequiredFor", () => {
  it("spec 355: requires a comment for rejected only; not for approved or needs_revision", () => {
    expect(commentRequiredFor("approved")).toBe(false);
    expect(commentRequiredFor("rejected")).toBe(true);
    // needs_revision now carries a structured reason instead — comment is optional.
    expect(commentRequiredFor("needs_revision")).toBe(false);
  });
});

describe("isCommentValid", () => {
  it("accepts any comment (including null/empty/whitespace) for approved", () => {
    expect(isCommentValid("approved", null)).toBe(true);
    expect(isCommentValid("approved", "")).toBe(true);
    expect(isCommentValid("approved", "   ")).toBe(true);
    expect(isCommentValid("approved", "looks good")).toBe(true);
  });

  it("rejects null/empty/whitespace comments for rejected", () => {
    expect(isCommentValid("rejected", null)).toBe(false);
    expect(isCommentValid("rejected", "")).toBe(false);
    expect(isCommentValid("rejected", "   ")).toBe(false);
    expect(isCommentValid("rejected", "\t\n  ")).toBe(false);
  });

  it("spec 355: accepts any comment (incl. null/empty) for needs_revision — it is optional now", () => {
    expect(isCommentValid("needs_revision", null)).toBe(true);
    expect(isCommentValid("needs_revision", "")).toBe(true);
    expect(isCommentValid("needs_revision", "  ")).toBe(true);
  });

  it("accepts real text for rejected and needs_revision", () => {
    expect(isCommentValid("rejected", "no good")).toBe(true);
    expect(isCommentValid("needs_revision", "please retake the After photo")).toBe(true);
  });
});

// Spec 337 U1 — the shouldTransitionToComplete block that sat here is gone with
// the predicate: decide_work_package owns the flip and returns the resulting
// status, so the rule is asserted in pgTAP `337-approval-rpcs` (approved →
// complete, rejected → rework + round++, needs_revision → no flip) against the
// real DB rather than re-derived in JS.

describe("APPROVAL_DECISIONS", () => {
  it("contains exactly the three enum values in a known order", () => {
    expect([...APPROVAL_DECISIONS]).toEqual(["approved", "needs_revision", "rejected"]);
  });
});
