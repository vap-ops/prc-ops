import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The seam neither the loop tests nor the component tests can reach: WHICH
// caller asks for a continuous sweep. The muster sheet must (it scans a whole
// lineup in one camera-open); the equipment scan must not (it unmounts the
// camera on the first decode). Getting this backwards is invisible — both
// render an identical viewfinder.
//
// Comments are stripped BEFORE matching: the prose around both call sites
// explains the choice and would otherwise satisfy the assertion about the
// choice, which is the repo's recurring fake-coverage class.

const root = join(__dirname, "..", "..");

function sourceWithoutComments(rel: string): string {
  return readFileSync(join(root, rel), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("MusterCamera continuous wiring", () => {
  it("the muster add sheet sweeps continuously", () => {
    const src = sourceWithoutComments("src/components/features/muster/muster-add-sheet.tsx");

    expect(occurrences(src, "<MusterCamera")).toBe(1);
    expect(occurrences(src, "continuous")).toBe(1);
    expect(src).toContain("<MusterCamera onDetected={onScanDetected} continuous />");
    // Bare, not quote-wrapped: a revert to the default would drop the prop
    // entirely, and `continuous={false}` would be the opposite of this unit.
    expect(src).not.toContain("continuous={false}");
  });

  it("the equipment scan stays one-shot, and says so in code rather than by omission", () => {
    const src = sourceWithoutComments(
      "src/components/features/equipment/equipment-scan-client.tsx",
    );

    expect(occurrences(src, "<MusterCamera")).toBe(1);
    expect(occurrences(src, "continuous={false}")).toBe(1);
    expect(src).toContain("<MusterCamera onDetected={onDecoded} continuous={false} />");
  });

  it("the camera defaults to one-shot, so a new caller cannot sweep by accident", () => {
    const src = sourceWithoutComments("src/components/features/muster/muster-camera.tsx");

    expect(src).toContain("continuous = false");
    expect(occurrences(src, "continuousRef.current")).toBe(2);
  });
});
