// Writing failing test first.
//
// Spec 340 U2 — the number has to reach the TILE, because the tile is what gets
// screenshotted. `selectCurrentPhotosByPhase` computing a stable `seq` is worth
// nothing if the page drops it on the way to the grid, and nothing else in the
// suite would notice: the numbering tests pass on the pure function alone.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

const WP_DETAIL = "src/app/projects/[projectId]/work-packages/[workPackageId]";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("photo number reaches the UI — spec 340 U2", () => {
  it("the WP detail page passes each photo's seq into the tile data", () => {
    expect(read(`${WP_DETAIL}/page.tsx`)).toContain("seq: p.seq,");
  });

  it("both photo grids render it", () => {
    // The zone strip on the WP detail and the grid inside the capture sheet are
    // separate components fed from the same page data — a badge added to one and
    // forgotten in the other is the likely miss.
    expect(read(`${WP_DETAIL}/phase-uploader.tsx`)).toContain("#{p.seq}");
    expect(read(`${WP_DETAIL}/capture-sheet.tsx`)).toContain("#{photo.seq}");
  });

  it("carries seq on both tile prop types, so a missing number cannot typecheck", () => {
    expect(read(`${WP_DETAIL}/phase-uploader.tsx`)).toMatch(/seq: number/);
    expect(read(`${WP_DETAIL}/capture-sheet.tsx`)).toMatch(/seq: number/);
  });
});
