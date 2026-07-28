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
  daysWaiting,
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

  // Iterate the WHOLE non-bounce domain, not one sample value: testing only
  // "rejected" left an `approved` row free to be dropped with the suite green.
  it.each(["approved", "rejected"])(
    "treats a %s decision as a first review, never as awaiting",
    (decision) => {
      // approved closes the WP and rejected leaves pending_approval (spec 337 F3), so
      // neither should reach this queue — but if one ever does it must stay visible and
      // actionable, not vanish into a collapsed zone nobody opens.
      const rows = [row("wp1", "2026-07-20T03:00:00+00:00")];
      const result = partitionReviewQueue({
        rows,
        decisionFor: () => ({
          id: D1,
          decision,
          decided_at: "2026-07-19T03:00:00+00:00",
          decided_by: PM,
          revision_reason: null,
        }),
        isAnswered: () => false,
      });

      expect(result.firstReview.map((r) => r.id)).toEqual(["wp1"]);
      expect(result.awaitingSite).toEqual([]);
      expect(result.actionableCount).toBe(1);
    },
  );

  it("is total: every row lands in exactly one zone", () => {
    const rows = [
      row("a", "2026-07-18T03:00:00+00:00"),
      row("b", "2026-07-19T03:00:00+00:00"),
      row("c", "2026-07-20T03:00:00+00:00"),
      row("d", "2026-07-21T03:00:00+00:00"),
      row("e", "2026-07-22T03:00:00+00:00"),
    ];
    const result = partitionReviewQueue({
      rows,
      decisionFor: (id) =>
        id === "b" || id === "c"
          ? bounce(D1, "2026-07-19T03:00:00+00:00")
          : id === "d"
            ? bounce(D2, "2026-07-21T03:00:00+00:00")
            : null,
      isAnswered: (decisionId) => decisionId === D2,
    });

    const landed = [
      ...result.readyAgain.map((r) => r.id),
      ...result.firstReview.map((r) => r.id),
      ...result.awaitingSite.map((a) => a.row.id),
    ].sort();
    expect(landed).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.actionableCount + result.awaitingSite.length).toBe(rows.length);
  });

  it("points the start-here CTA at the genuinely oldest actionable WP, in EITHER group", () => {
    // A cured bounce keeps its original queue-entry updated_at, so it is not
    // automatically the oldest — the CTA says เก่าสุด, so it must mean it.
    const rows = [
      row("first", "2026-07-18T03:00:00+00:00"),
      row("again", "2026-07-24T03:00:00+00:00"),
    ];
    const result = partitionReviewQueue({
      rows,
      decisionFor: (id) => (id === "again" ? bounce(D1, "2026-07-24T03:00:00+00:00") : null),
      isAnswered: (decisionId) => decisionId === D1,
    });

    expect(result.readyAgain.map((r) => r.id)).toEqual(["again"]);
    expect(result.startHere?.id).toBe("first");
    expect(result.oldestActionableAt).toBe("2026-07-18T03:00:00+00:00");
  });

  it("still picks a ready-again row when IT is the oldest", () => {
    const rows = [
      row("again", "2026-07-18T03:00:00+00:00"),
      row("first", "2026-07-24T03:00:00+00:00"),
    ];
    const result = partitionReviewQueue({
      rows,
      decisionFor: (id) => (id === "again" ? bounce(D1, "2026-07-20T03:00:00+00:00") : null),
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

describe("daysWaiting", () => {
  it("counts Bangkok CALENDAR days, matching the เข้าคิวเมื่อ stamp beside it", () => {
    expect(daysWaiting("2026-07-22T03:00:00+00:00", "2026-07-28")).toBe(6);
  });

  it("counts the late-evening row as a full day, where an elapsed-ms floor said 0", () => {
    // 23:30 Bangkok on 27 ก.ค. = 16:30Z. Viewed on 28 ก.ค. the row renders
    // "เข้าคิวเมื่อ 27 ก.ค. 23:30", so "รอมาแล้ว 0 วัน" would contradict its own row.
    expect(daysWaiting("2026-07-27T16:30:00+00:00", "2026-07-28")).toBe(1);
  });

  it("puts a stamp after 17:00Z on the NEXT Bangkok day", () => {
    // 18:00Z on 27 ก.ค. is already 01:00 on 28 ก.ค. in Bangkok (UTC+7).
    expect(daysWaiting("2026-07-27T18:00:00+00:00", "2026-07-28")).toBe(0);
  });

  it("is 0 on the same day and never negative for a future stamp", () => {
    expect(daysWaiting("2026-07-28T01:00:00+00:00", "2026-07-28")).toBe(0);
    expect(daysWaiting("2026-07-29T01:00:00+00:00", "2026-07-28")).toBe(0);
  });

  it("parses PostgREST's 6-digit fractional seconds", () => {
    expect(daysWaiting("2026-07-20T13:20:22.776778+00:00", "2026-07-28")).toBe(8);
  });

  it("returns null for an unparseable stamp rather than NaN days", () => {
    expect(daysWaiting("not-a-date", "2026-07-28")).toBeNull();
    expect(daysWaiting("2026-07-22T03:00:00+00:00", "not-a-date")).toBeNull();
  });
});
