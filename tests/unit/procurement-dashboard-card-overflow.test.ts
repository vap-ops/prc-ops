// Regression guard (reported 2026-07-31, "procurement manager sees overflowing
// texts in home page"). Measured live on /procurement at 375px AND 360px as
// procurement_manager: the busiest project card (TFM โพธิ์ทอง ลพบุรี — the only
// one with real activity) rendered its name span at **width 0** while its four
// shrink-0 badges (ขอซื้อ 13 · ของเข้าวันนี้ 5 · เสี่ยงช้า 5 · ไม่มีเอกสาร 243)
// took the whole row, and the last badge still ran to right=394 on a 375px
// viewport — clipped by MAIN's overflow-x-clip. So the ONE card that matters
// showed no project name and a cut-off count.
//
// Cause: a single non-wrapping flex row mixing `min-w-0 flex-1 truncate` (the
// name, which yields all its width) with `shrink-0` badges (which yield none).
// The badges' hypothetical sizes sum past the card, so the name collapses to
// zero first and the overflow spills anyway. Fix: let the row WRAP and give the
// name a min-width floor, so the badges move to a second line instead of eating
// the name. The badges keep `shrink-0` — wrapping, not shrinking, is the escape
// (a shrinking badge wraps its own label mid-pill, the spec-230 defect guarded
// by procurement-grid-category-overflow.test.tsx).
//
// dashboard-body.tsx is an async Server Component vitest cannot render, so this
// is a comment-stripped source pin with exact occurrence counts (the house
// idiom — see doc-chase-surfaces.test.ts).

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const dash = strip(readFileSync("src/app/procurement/dashboard-body.tsx", "utf8"));

describe("procurement dashboard project card — no name-eating overflow", () => {
  it("the card row wraps its badges instead of squeezing the name", () => {
    // Exactly one wrapping card row (the project card <button>). The alert
    // strip and the door chip rows already wrap in their own components.
    expect(count(dash, "flex min-h-11 w-full flex-wrap items-center")).toBe(1);
  });

  it("the project name keeps a min-width floor so it can never render at 0px", () => {
    expect(count(dash, "min-w-[8rem]")).toBe(1);
    // …and still truncates: one long name must clip, never push the badges out.
    expect(count(dash, "min-w-[8rem] flex-1 truncate")).toBe(1);
  });

  it("badges stay shrink-0 — the row wraps, a badge never shrinks its label", () => {
    // ขอซื้อ, ของเข้าวันนี้, เสี่ยงช้า, ไม่มีเอกสาร.
    expect(count(dash, "shrink-0")).toBeGreaterThanOrEqual(4);
  });

  it("the badges get a tight vertical gap so a wrapped card stays compact", () => {
    expect(count(dash, "gap-x-3 gap-y-1")).toBe(1);
  });
});
