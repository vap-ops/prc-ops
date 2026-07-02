// Writing failing test first.
//
// Class-contract guards for two bug classes closed in the 2026-07-02 feedback
// pass — pinned here once, repo-wide, instead of per-surface whack-a-mole:
//
// 1. CHIP STRIPS (feedback bc6df601/703d7e91 → #235, and the same latent gap in
//    catalog-list closed by #237): a RadioChip inside an overflow-x-auto strip
//    that lacks `shrink-0 whitespace-nowrap` shrinks and wraps its label — the
//    strip stacks vertically. The guard moves INTO the component: RadioChip's
//    base class now carries both, so no call site can forget them again.
//
// 2. ABSOLUTE VERTICAL CENTERING (feedback 703d7e91 → #236): the idiom is TWO
//    classes — `top-1/2` positions the TOP edge at the midline and
//    `-translate-y-1/2` pulls the element back up. Sites that copy only the
//    first render the element hanging below its container (the misplaced
//    ค้นหา button). A static scan fails the build on any className string in
//    src/ that uses top-1/2 without the translate.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { RadioChip } from "@/components/features/common/radio-chip";

describe("RadioChip strip contract (#235 bug class)", () => {
  it("never shrinks nor wraps its label, even with no className from the call site", () => {
    render(<RadioChip name="g" label="ทั้งหมด (5)" checked={false} onSelect={vi.fn()} />);
    const chip = screen.getByRole("radio").closest("label")!;
    expect(chip.className).toContain("shrink-0");
    expect(chip.className).toContain("whitespace-nowrap");
  });
});

// ---------------------------------------------------------------------------
// Static scan: top-1/2 must always travel with -translate-y-1/2.
// ---------------------------------------------------------------------------

// Every quoted or template string literal in the file content.
const STRING_LITERALS = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

/** String literals that position with top-1/2 but skip the -translate-y-1/2
 *  pullback — each is an element whose top edge sits on the container midline. */
export function topHalfViolations(content: string): string[] {
  const out: string[] = [];
  for (const [lit] of content.matchAll(STRING_LITERALS)) {
    if (lit.includes("top-1/2") && !lit.includes("-translate-y-1/2")) out.push(lit);
  }
  return out;
}

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

describe("absolute-centering contract (#236 bug class)", () => {
  it("the checker flags top-1/2 without the translate, and only that", () => {
    expect(topHalfViolations('className="absolute top-1/2 right-1.5 h-8"')).toHaveLength(1);
    expect(topHalfViolations('className="absolute top-1/2 -translate-y-1/2"')).toHaveLength(0);
    expect(topHalfViolations("className={`x ${y} top-1/2 -translate-y-1/2`}")).toHaveLength(0);
    expect(topHalfViolations('className="top-1"')).toHaveLength(0);
  });

  it("no className in src/ uses top-1/2 without -translate-y-1/2", () => {
    const srcRoot = path.resolve(__dirname, "../../src");
    const offenders = tsxFiles(srcRoot).flatMap((f) => {
      const hits = topHalfViolations(fs.readFileSync(f, "utf8"));
      return hits.map((h) => `${path.relative(srcRoot, f)}: ${h}`);
    });
    expect(offenders, "add -translate-y-1/2 next to top-1/2 (see #236)").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Static scan: overflow-x-auto scroll rows must lock the gesture to the
// horizontal axis (feedback 14263ad8 — "pills move vertically" on /projects).
//
// A bare `overflow-x-auto` container has NO `touch-action`, so the browser is
// free to resolve a slightly-diagonal swipe as page scroll instead of row
// scroll — the row (and everything in it) visibly jumps vertically mid-swipe
// on touch devices. `touch-action: pan-x pinch-zoom` locks a pan gesture
// starting on that element to the horizontal axis only, so the vertical
// component of the touch never reaches the page. `pinch-zoom` MUST travel
// with `pan-x`: the keyword alone would also disable two-finger zoom over the
// strip (a WCAG 1.4.10 reflow regression for low-vision users) — the pair
// keeps zoom while still killing the vertical jump.
// ---------------------------------------------------------------------------

/** String literals that scroll horizontally but never lock the touch gesture
 *  to that axis (or lock it without preserving pinch-zoom) — each is a row
 *  that can bleed a horizontal swipe into a vertical page-scroll jump. */
export function scrollRowTouchActionViolations(content: string): string[] {
  const out: string[] = [];
  for (const [lit] of content.matchAll(STRING_LITERALS)) {
    if (lit.includes("overflow-x-auto") && !lit.includes("touch-action:pan-x_pinch-zoom"))
      out.push(lit);
  }
  return out;
}

describe("horizontal-scroll touch-action contract (14263ad8 bug class)", () => {
  it("the checker flags overflow-x-auto without touch-action:pan-x_pinch-zoom, and only that", () => {
    expect(scrollRowTouchActionViolations('className="flex overflow-x-auto gap-2"')).toHaveLength(
      1,
    );
    // pan-x alone is ALSO a violation — it silently disables pinch-zoom.
    expect(
      scrollRowTouchActionViolations('className="flex overflow-x-auto gap-2 [touch-action:pan-x]"'),
    ).toHaveLength(1);
    expect(
      scrollRowTouchActionViolations(
        'className="flex overflow-x-auto gap-2 [touch-action:pan-x_pinch-zoom]"',
      ),
    ).toHaveLength(0);
    expect(scrollRowTouchActionViolations('className="flex gap-2"')).toHaveLength(0);
  });

  it("no className in src/ uses overflow-x-auto without [touch-action:pan-x_pinch-zoom]", () => {
    const srcRoot = path.resolve(__dirname, "../../src");
    const offenders = tsxFiles(srcRoot).flatMap((f) => {
      const hits = scrollRowTouchActionViolations(fs.readFileSync(f, "utf8"));
      return hits.map((h) => `${path.relative(srcRoot, f)}: ${h}`);
    });
    expect(
      offenders,
      "add [touch-action:pan-x_pinch-zoom] next to overflow-x-auto (see feedback 14263ad8)",
    ).toEqual([]);
  });
});
