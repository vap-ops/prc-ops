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

  it("the WP-detail zone strip renders it", () => {
    // The capture-sheet grid is pinned by RENDERING it (capture-sheet.test.tsx,
    // "photo number badge") — the honest way. The zone strip lives inside
    // PhotoCaptureZone, whose render pulls the whole capture engine, so it keeps
    // a source pin; it is the weaker assertion of the two and is only defensible
    // because the sheet's real render already proves the badge markup works.
    expect(read(`${WP_DETAIL}/phase-uploader.tsx`)).toContain("#{p.seq}");
  });
});
