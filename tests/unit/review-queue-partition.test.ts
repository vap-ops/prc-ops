// Writing failing test first.
//
// Spec 371 U1 — /review showed every pending_approval WP in one flat list and
// the badge counted the same set: live, 70 rows of which only 52 were the PM's
// move. The other 18 were needs_revision bounces the site admin has not cured
// yet — not actionable, indistinguishable at a glance, and interleaved by queue
// age so scrolling never separated them.
//
// partitionReviewQueue is that split as one pure function: the page renders from
// it and the (future U2) count reads the same predicate, so the zones and the
// number cannot drift.

import { describe, expect, it } from "vitest";
import {
  partitionReviewQueue,
  daysSince,
  type ReviewQueueDecision,
} from "@/lib/approvals/review-queue";

const PM = "pm000000-0000-4000-8000-00000000pm01";
const D1 = "d1d1d1d1-0000-4000-8000-000000000001";
const D2 = "d2d2d2d2-0000-4000-8000-000000000002";

type Row = { id: string; updated_at: string };

const row = (id: string, updated_at: string): Row => ({ id, updated_at });

const bounce = (id: string, decided_at: string): ReviewQueueDecision => ({
  id,
  decision: "needs_revision",
  decided_at,
  decided_by: PM,
  revision_reason: null,
});

describe("partitionReviewQueue", () => {
  it("keeps a never-reviewed WP in the actionable zone", () => {
    const rows = [row("wp1", "2026-07-22T03:00:00+00:00")];
    const result = partitionReviewQueue({
      rows,
      decisionFor: () => null,
      isAnswered: () => false,
    });

    expect(result.firstReview.map((r) => r.id)).toEqual(["wp1"]);
    expect(result.readyAgain).toEqual([]);
    expect(result.awaitingSite).toEqual([]);
    expect(result.actionableCount).toBe(1);
  });

  it("moves an UNANSWERED bounce out of the actionable zone entirely", () => {
    const rows = [row("wp1", "2026-07-20T03:00:00+00:00")];
    const result = partitionReviewQueue({
      rows,
      decisionFor: () => bounce(D1, "2026-07-20T03:00:00+00:00"),
      isAnswered: () => false,
    });

    expect(result.firstReview).toEqual([]);
    expect(result.readyAgain).toEqual([]);
    expect(result.awaitingSite.map((a) => a.row.id)).toEqual(["wp1"]);
    // The whole point of the unit: this row is NOT in the PM's number.
    expect(result.actionableCount).toBe(0);
  });

  it("puts an ANSWERED bounce back in the actionable zone, ahead of first reviews", () => {
    const rows = [row("wp1", "2026-07-22T03:00:00+00:00"), row("wp2", "2026-07-21T03:00:00+00:00")];
    const result = partitionReviewQueue({
      rows,
      decisionFor: (id) => (id === "wp2" ? bounce(D1, "2026-07-21T03:00:00+00:00") : null),
      isAnswered: (decisionId) => decisionId === D1,
    });

    expect(result.readyAgain.map((r) => r.id)).toEqual(["wp2"]);
    expect(result.firstReview.map((r) => r.id)).toEqual(["wp1"]);
    expect(result.actionableCount).toBe(2);
  });

  it("carries the bounce date and reason on an awaiting row, so the chase chips can render", () => {
    const rows = [row("wp1", "2026-07-20T03:00:00+00:00")];
    const result = partitionReviewQueue({
      rows,
      decisionFor: () => ({
        id: D1,
        decision: "needs_revision",
        decided_at: "2026-07-19T03:00:00+00:00",
        decided_by: PM,
        revision_reason: "mismatch",
      }),
      isAnswered: () => false,
    });

    expect(result.awaitingSite[0]?.bouncedAt).toBe("2026-07-19T03:00:00+00:00");
    expect(result.awaitingSite[0]?.reason).toBe("mismatch");
  });

  it("orders the awaiting zone longest-stuck first — the chase order, not the queue order", () => {
    const rows = [
      row("recent", "2026-07-25T03:00:00+00:00"),
      row("stuck", "2026-07-24T03:00:00+00:00"),
    ];
    const result = partitionReviewQueue({
      rows,
      decisionFor: (id) =>
        id === "stuck"
          ? bounce(D1, "2026-07-18T03:00:00+00:00")
          : bounce(D2, "2026-07-24T03:00:00+00:00"),
      isAnswered: () => false,
    });

    expect(result.awaitingSite.map((a) => a.row.id)).toEqual(["stuck", "recent"]);
  });

  it("preserves the caller's row order inside each actionable group (spec 15 oldest-first survives)", () => {
    const rows = [
      row("old", "2026-07-18T03:00:00+00:00"),
      row("mid", "2026-07-20T03:00:00+00:00"),
      row("new", "2026-07-22T03:00:00+00:00"),
    ];
    const result = partitionReviewQueue({ rows, decisionFor: () => null, isAnswered: () => false });

    expect(result.firstReview.map((r) => r.id)).toEqual(["old", "mid", "new"]);
  });

  it("treats a decision that is not needs_revision as a first review, never as awaiting", () => {
    // approved closes the WP and rejected leaves pending_approval (spec 337 F3), so
    // neither should reach this queue — but if one ever does it must stay visible and
    // actionable, not vanish into a collapsed zone nobody opens.
    const rows = [row("wp1", "2026-07-20T03:00:00+00:00")];
    const result = partitionReviewQueue({
      rows,
      decisionFor: () => ({
        id: D1,
        decision: "rejected",
        decided_at: "2026-07-19T03:00:00+00:00",
        decided_by: PM,
        revision_reason: null,
      }),
      isAnswered: () => false,
    });

    expect(result.firstReview.map((r) => r.id)).toEqual(["wp1"]);
    expect(result.awaitingSite).toEqual([]);
    expect(result.actionableCount).toBe(1);
  });

  it("names the oldest actionable WP for the start-here CTA, preferring a ready-again row", () => {
    const rows = [
      row("first", "2026-07-18T03:00:00+00:00"),
      row("again", "2026-07-24T03:00:00+00:00"),
    ];
    const result = partitionReviewQueue({
      rows,
      decisionFor: (id) => (id === "again" ? bounce(D1, "2026-07-24T03:00:00+00:00") : null),
      isAnswered: (decisionId) => decisionId === D1,
    });

    expect(result.startHere?.id).toBe("again");
  });

  it("has no start-here target when nothing is actionable", () => {
    const rows = [row("wp1", "2026-07-20T03:00:00+00:00")];
    const result = partitionReviewQueue({
      rows,
      decisionFor: () => bounce(D1, "2026-07-20T03:00:00+00:00"),
      isAnswered: () => false,
    });

    expect(result.startHere).toBeNull();
    expect(result.oldestActionableAt).toBeNull();
  });

  it("reports the oldest actionable wait, ignoring the awaiting rows", () => {
    const rows = [
      row("stuckLongest", "2026-07-10T03:00:00+00:00"),
      row("oldestReal", "2026-07-20T03:00:00+00:00"),
    ];
    const result = partitionReviewQueue({
      rows,
      decisionFor: (id) => (id === "stuckLongest" ? bounce(D1, "2026-07-10T03:00:00+00:00") : null),
      isAnswered: () => false,
    });

    expect(result.oldestActionableAt).toBe("2026-07-20T03:00:00+00:00");
  });
});

describe("daysSince", () => {
  it("counts whole days elapsed", () => {
    const now = Date.parse("2026-07-28T06:00:00+00:00");
    expect(daysSince("2026-07-22T03:00:00+00:00", now)).toBe(6);
  });

  it("is 0 on the same day and never negative for a future stamp", () => {
    const now = Date.parse("2026-07-28T06:00:00+00:00");
    expect(daysSince("2026-07-28T01:00:00+00:00", now)).toBe(0);
    expect(daysSince("2026-07-29T01:00:00+00:00", now)).toBe(0);
  });

  it("returns null for an unparseable stamp rather than NaN days", () => {
    expect(daysSince("not-a-date", Date.parse("2026-07-28T06:00:00+00:00"))).toBeNull();
  });
});
