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
