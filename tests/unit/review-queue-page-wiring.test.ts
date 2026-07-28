// Writing failing test first.
//
// Spec 371 U1 — the page-side half of the focus split. `/review` is a Server
// Component vitest cannot render, so the behaviour is pinned two ways: the RULE
// is unit-tested in review-queue-partition.test.ts, and the WIRING is pinned here
// by source scan. Comments are stripped FIRST, so prose describing a symbol can
// never satisfy the assertion about using it.
//
// The one thing that must never regress: the number shown to the PM is the
// ACTIONABLE count, not the row count. That was the operator's whole report —
// 70 shown, 52 actually theirs.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PAGE = read("src/app/review/page.tsx");

const occurrences = (src: string, needle: string) => src.split(needle).length - 1;

describe("/review renders the focus split", () => {
  // >=2 = the import PLUS a real call. A bare toContain is satisfied by the
  // import line alone — the fake-coverage trap this repo keeps re-learning.
  it("partitions the queue instead of listing it flat", () => {
    expect(occurrences(PAGE, "partitionReviewQueue")).toBeGreaterThanOrEqual(2);
  });

  it("shows the ACTIONABLE count as the headline number, not the row count", () => {
    expect(occurrences(PAGE, "queue.actionableCount")).toBeGreaterThanOrEqual(2);
    // The retired flat-list helpers must not come back with it.
    expect(PAGE).not.toContain("reviewQueueRank");
    expect(PAGE).not.toContain("reviewQueueLabel");
  });

  // Every pin below counts occurrences, NOT toContain, and counts against the ACTUAL
  // number of uses rather than a blanket 2. Both refinements are mutation-proved:
  // a bare toContain is satisfied by the import line alone, and a blanket >=2 is
  // satisfied by the import plus ONE surviving use when the symbol is used twice.
  it("renders BOTH zone-A subgroups — neither section can be deleted silently", () => {
    // The ready-again section was the hole: no assertion named it, so the whole
    // block could go while its rows stayed inside actionableCount (fresh-eyes catch).
    expect(occurrences(PAGE, "queue.readyAgain")).toBeGreaterThanOrEqual(3);
    expect(occurrences(PAGE, "REVIEW_READY_AGAIN_LABEL")).toBeGreaterThanOrEqual(3);
    expect(occurrences(PAGE, "queue.firstReview")).toBeGreaterThanOrEqual(3);
  });

  it("renders both zones from the label SSOT, never inline strings", () => {
    expect(occurrences(PAGE, "REVIEW_ACTIONABLE_ZONE_LABEL")).toBeGreaterThanOrEqual(2);
    expect(occurrences(PAGE, "REVIEW_AWAITING_SITE_ZONE_LABEL")).toBeGreaterThanOrEqual(2);
    expect(occurrences(PAGE, "REVIEW_FIRST_PASS_LABEL")).toBeGreaterThanOrEqual(2);
    // Bare, not quote-wrapped: a revert to inline JSX text is still caught.
    expect(PAGE).not.toContain("ตรวจได้ตอนนี้");
    expect(PAGE).not.toContain("รอหน้างานถ่ายรูปใหม่");
    expect(PAGE).not.toContain("รอตรวจครั้งแรก");
  });

  it("keeps the awaiting-site zone reachable but collapsed, and says it is excluded", () => {
    expect(PAGE).toContain("<details");
    // 3 uses: the length guard, the summary count, the <ul> map. At >=2 the whole
    // <ul> could go, leaving a disclosure announcing 18 rows and containing none.
    expect(occurrences(PAGE, "queue.awaitingSite")).toBeGreaterThanOrEqual(3);
    expect(occurrences(PAGE, "REVIEW_AWAITING_SITE_NOTE")).toBeGreaterThanOrEqual(2);
    // Opens itself when zone A is empty, so an all-bounced queue is not one thin bar.
    expect(PAGE).toContain("open={queue.actionableCount === 0}");
    // The repo's disclosure idiom (cold-restart-help): the chevron must turn.
    expect(PAGE).toContain("group-open:rotate-180");
  });

  it("offers the start-here CTA at the oldest actionable WP", () => {
    expect(occurrences(PAGE, "REVIEW_START_HERE_CTA")).toBeGreaterThanOrEqual(2);
    expect(occurrences(PAGE, "queue.startHere")).toBeGreaterThanOrEqual(2);
  });

  it("ages both zones from their OWN clock — queue entry vs the bounce", () => {
    // 3 uses: import, the hero subtitle, the per-row chip. At >=2 the row chip
    // could be deleted and the pin would still pass.
    expect(occurrences(PAGE, "waitingDaysChip")).toBeGreaterThanOrEqual(3);
    // The chase chip counts from approvals.decided_at (bouncedAt), which is the
    // number worth chasing; counting from updated_at would understate it.
    expect(occurrences(PAGE, "reviewStuckChip")).toBeGreaterThanOrEqual(2);
    expect(occurrences(PAGE, "bouncedAt")).toBeGreaterThanOrEqual(2);
    // Bangkok calendar days (src/lib/dates.ts doctrine), not an elapsed-ms floor.
    expect(occurrences(PAGE, "daysWaiting")).toBeGreaterThanOrEqual(4);
    expect(PAGE).toContain("bangkokTodayIso");
    expect(PAGE).not.toContain("Date.now");
  });

  it("does not caption a DECIDED work package as never reviewed", () => {
    // approved/rejected should never be in this queue, but if one is it keeps its
    // real decision pill instead of silently inheriting the รอตรวจครั้งแรก heading.
    expect(PAGE).toContain("APPROVAL_DECISION_LABEL");
    expect(occurrences(PAGE, "approvalDecisionPillClasses")).toBeGreaterThanOrEqual(3);
  });
});
