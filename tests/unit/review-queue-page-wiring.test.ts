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

  it("renders both zones from the label SSOT, never inline strings", () => {
    expect(PAGE).toContain("REVIEW_ACTIONABLE_ZONE_LABEL");
    expect(PAGE).toContain("REVIEW_AWAITING_SITE_ZONE_LABEL");
    expect(PAGE).toContain("REVIEW_FIRST_PASS_LABEL");
    // Bare, not quote-wrapped: a revert to inline JSX text is still caught.
    expect(PAGE).not.toContain("ตรวจได้ตอนนี้");
    expect(PAGE).not.toContain("รอหน้างานถ่ายรูปใหม่");
    expect(PAGE).not.toContain("รอตรวจครั้งแรก");
  });

  it("keeps the awaiting-site zone reachable but collapsed, and says it is excluded", () => {
    expect(PAGE).toContain("<details");
    expect(occurrences(PAGE, "queue.awaitingSite")).toBeGreaterThanOrEqual(2);
    expect(PAGE).toContain("REVIEW_AWAITING_SITE_NOTE");
  });

  it("offers the start-here CTA at the oldest actionable WP", () => {
    expect(PAGE).toContain("REVIEW_START_HERE_CTA");
    expect(occurrences(PAGE, "queue.startHere")).toBeGreaterThanOrEqual(2);
  });

  it("ages both zones from their OWN clock — queue entry vs the bounce", () => {
    expect(PAGE).toContain("reviewWaitingChip");
    // The chase chip counts from approvals.decided_at (bouncedAt), which is the
    // number worth chasing; counting from updated_at would understate it.
    expect(PAGE).toContain("reviewBouncedChip");
    expect(PAGE).toContain("bouncedAt");
  });
});
