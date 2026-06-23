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
  return { code: "WP-01", project_id: "p-1", ...partial };
}

describe("summarizePendingApprovals", () => {
  it("returns count 0 and no oldest for an empty queue", () => {
    expect(summarizePendingApprovals([], PROJECTS)).toEqual({ count: 0, oldest: null });
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
