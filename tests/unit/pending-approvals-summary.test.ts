// Spec 183 U1 — the pure summary behind the ภาพรวม รอตรวจ hero card.
// Given the pending work-package rows (any order) + a project lookup, it
// produces { count, oldest } for the card. Oldest = min updated_at (queue
// entry, spec 15 C) with code as the deterministic tiebreak — mirrors the
// /review queue ordering so the count never disagrees with the list.

import { describe, it, expect } from "vitest";
import { summarizePendingApprovals, type PendingWp } from "@/lib/approvals/pending-summary";

const PROJECTS = new Map([
  ["p-1", { code: "PRJ-014", name: "อาคาร B" }],
  ["p-2", { code: "PRJ-020", name: "ถนนสายหลัก" }],
]);

function wp(partial: Partial<PendingWp> & Pick<PendingWp, "id" | "updated_at">): PendingWp {
  // Pre-371 cases predate zones; they are all actionable first reviews.
  return { code: "WP-01", project_id: "p-1", zone: "first_review", ...partial };
}

describe("summarizePendingApprovals", () => {
  it("returns count 0 and no oldest for an empty queue", () => {
    expect(summarizePendingApprovals([], PROJECTS)).toEqual({
      count: 0,
      awaitingSite: 0,
      oldest: null,
    });
  });

  it("counts the rows and reports the single row as oldest", () => {
    const rows = [wp({ id: "a", code: "WP-07", updated_at: "2026-06-20T08:00:00Z" })];
    const result = summarizePendingApprovals(rows, PROJECTS);
    expect(result.count).toBe(1);
    expect(result.oldest).toEqual({
      workPackageId: "a",
      wpCode: "WP-07",
      projectCode: "PRJ-014",
      projectName: "อาคาร B",
      waitingSince: "2026-06-20T08:00:00Z",
    });
  });

  it("picks the minimum updated_at as oldest, regardless of input order", () => {
    const rows = [
      wp({ id: "newer", code: "WP-09", updated_at: "2026-06-22T10:00:00Z" }),
      wp({ id: "older", code: "WP-03", project_id: "p-2", updated_at: "2026-06-19T09:00:00Z" }),
      wp({ id: "mid", code: "WP-05", updated_at: "2026-06-21T11:00:00Z" }),
    ];
    const result = summarizePendingApprovals(rows, PROJECTS);
    expect(result.count).toBe(3);
    expect(result.oldest?.workPackageId).toBe("older");
    expect(result.oldest?.projectCode).toBe("PRJ-020");
  });

  it("breaks an updated_at tie by ascending code (deterministic, like /review)", () => {
    const rows = [
      wp({ id: "b", code: "WP-08", updated_at: "2026-06-20T08:00:00Z" }),
      wp({ id: "a", code: "WP-02", updated_at: "2026-06-20T08:00:00Z" }),
    ];
    const result = summarizePendingApprovals(rows, PROJECTS);
    expect(result.oldest?.workPackageId).toBe("a");
    expect(result.oldest?.wpCode).toBe("WP-02");
  });

  it("tolerates a missing project in the lookup (nulls, not a throw)", () => {
    const rows = [
      wp({ id: "a", code: "WP-07", project_id: "ghost", updated_at: "2026-06-20T08:00:00Z" }),
    ];
    const result = summarizePendingApprovals(rows, PROJECTS);
    expect(result.oldest?.projectCode).toBeNull();
    expect(result.oldest?.projectName).toBeNull();
    expect(result.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Spec 371 U2 — the hero counted every pending_approval row, so it reported a
// blended 70 when only 52 were the PM's move. Operator 2026-07-28: "Amount 70
// items is misleading, how about separating them?" — so the summary now carries
// the two populations SEPARATELY rather than one number that hides the split.
// Zones come from the work_package_review_queue view (the SSOT), never re-derived.
describe("summarizePendingApprovals — zone split (spec 371 U2)", () => {
  const zoned = (
    id: string,
    zone: "first_review" | "ready_again" | "awaiting_site",
    updated_at: string,
  ): PendingWp => ({ id, code: `WP-${id}`, project_id: "p-1", updated_at, zone });

  it("counts ONLY the actionable zones, and reports awaiting separately", () => {
    const rows = [
      zoned("a", "first_review", "2026-06-20T08:00:00Z"),
      zoned("b", "ready_again", "2026-06-21T08:00:00Z"),
      zoned("c", "awaiting_site", "2026-06-19T08:00:00Z"),
      zoned("d", "awaiting_site", "2026-06-18T08:00:00Z"),
    ];
    const result = summarizePendingApprovals(rows, PROJECTS);
    expect(result.count).toBe(2);
    expect(result.awaitingSite).toBe(2);
  });

  it("never lets an awaiting row become the OLDEST — that WP is not the PM's to open", () => {
    const rows = [
      zoned("stuck", "awaiting_site", "2026-06-01T08:00:00Z"),
      zoned("real", "first_review", "2026-06-20T08:00:00Z"),
    ];
    const result = summarizePendingApprovals(rows, PROJECTS);
    expect(result.oldest?.workPackageId).toBe("real");
  });

  it("reports a queue that is entirely awaiting as zero actionable, not as empty", () => {
    const rows = [zoned("x", "awaiting_site", "2026-06-01T08:00:00Z")];
    const result = summarizePendingApprovals(rows, PROJECTS);
    expect(result.count).toBe(0);
    expect(result.oldest).toBeNull();
    expect(result.awaitingSite).toBe(1);
  });
});
