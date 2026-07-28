// Writing failing test first.
//
// Operator directive 2026-07-28 — "hide rework and only show it if there is a rework
// rejection". The PM's review-detail page is a Server Component vitest cannot render,
// so this follows the house split: the RULE is unit-tested in rework-round.test.ts
// (afterFixSectionLabel), and the WIRING is pinned here by source scan. Comments are
// stripped FIRST, so prose naming a symbol can never satisfy an assertion about using
// it.
//
// The thing that must not regress: the heading over a round-0 group must not call
// those photos หลังแก้ไข. 21 WPs / 151 photos are in exactly that state, and none of
// them was ever sent back for rework.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PAGE = read("src/app/review/work-packages/[workPackageId]/page.tsx");

const occurrences = (src: string, needle: string) => src.split(needle).length - 1;

describe("review detail names an after_fix group by its round", () => {
  // Exactly 2 = the import PLUS the single call site. A bare toContain is satisfied
  // by the import line alone; a >=2 floor would survive deleting one of two real
  // uses. There is one use here, so pin the real number.
  it("derives the heading from the round instead of hardcoding the phase label", () => {
    expect(occurrences(PAGE, "afterFixSectionLabel")).toBe(2);
  });

  it("no longer heads the after_fix galleries with the bare phase label", () => {
    expect(PAGE).not.toContain("PHOTO_PHASE_LABEL.after_fix");
  });

  it("still labels the DEFECT galleries with their own phase label", () => {
    // Guards against a careless sweep that swaps every PHOTO_PHASE_LABEL use: the
    // defect heading is a different axis and must survive untouched.
    expect(PAGE).toContain("PHOTO_PHASE_LABEL.defect");
  });

  it("keeps the round tag composing through afterFixRoundHeading", () => {
    // The section label answers WHICH NAME; afterFixRoundHeading still answers
    // "รอบ N" + the source suffix. Losing the composition would drop the round from
    // a real multi-round WP's headings.
    expect(occurrences(PAGE, "afterFixRoundHeading")).toBeGreaterThanOrEqual(2);
  });
});

// The SA's WP detail is a Server Component too, and it renders the same rule in TWO
// places the first pass missed: the READ-ONLY viewer's after_fix galleries, and the
// removal trace's zone name. The read-only branch was missed because a super_admin
// probe renders the CAPTURE branch instead — the surface a real read-only viewer
// sees was never exercised.
const WP_PAGE = read("src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx");

describe("SA WP detail names photo groups by round", () => {
  it("heads the read-only after_fix galleries from the round", () => {
    expect(occurrences(WP_PAGE, "afterFixSectionLabel")).toBe(2);
  });

  it("names the removal trace's zone through the shared rule", () => {
    expect(occurrences(WP_PAGE, "photoSectionLabel")).toBe(2);
    // The retired hardcoded form must not come back beside it.
    expect(WP_PAGE).not.toContain("PHOTO_PHASE_LABEL[phase as keyof typeof PHOTO_PHASE_LABEL]");
  });

  it("no longer heads an after_fix gallery with the bare phase label", () => {
    expect(WP_PAGE).not.toContain("PHOTO_PHASE_LABEL.after_fix");
  });

  it("still labels the DEFECT galleries with their own phase label", () => {
    expect(WP_PAGE).toContain("PHOTO_PHASE_LABEL.defect");
  });
});
