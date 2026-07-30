// Test-infra guard: every test file that OPENS the photo lightbox must
// pre-warm its next/dynamic overlay chunk.
//
// Why this is worth a guard (2026-07-30): the overlay is fetched through
// next/dynamic, so the first open inside a vitest process pays a cold module
// transform. `findBy*` polls under RTL's asyncUtilTimeout — 1000ms, and NOT
// affected by --testTimeout — while that cold import measured 463-1375ms across
// six concurrent vitest processes on the Windows box. When it loses the race the
// failure reads `Unable to find role="dialog"` with the next/dynamic loading
// fallback still on screen, which looks like a component bug and is not one.
// CI (Linux) never reproduced it, so nothing here would ever go red on a
// regression — hence a static guard rather than trusting the suite.
//
// This file is deliberately `.test.ts`, not `.test.tsx`: it holds the trigger
// label as a constant, and the scan below only reads `.test.tsx` files, so it
// cannot match itself. Keep the extension if you edit it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const UNIT_DIR = join(process.cwd(), "tests", "unit");
/** ZoomablePhoto's trigger button — its presence means the file touches the
 *  lightbox, and every such file here also opens it. */
const TRIGGER_LABEL = "ดูรูปขยาย";
const HELPER_MODULE = "helpers/lightbox-overlay-warmup";
const REGISTRATION = "beforeAll(warmLightboxOverlay)";

// Comments are stripped before scanning: several of these files carry a comment
// explaining the next/dynamic chunk, and a comment that merely NAMED the helper
// would otherwise satisfy the requirement without wiring anything up.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const openers = readdirSync(UNIT_DIR)
  .filter((f) => f.endsWith(".test.tsx"))
  .filter((f) => stripComments(readFileSync(join(UNIT_DIR, f), "utf8")).includes(TRIGGER_LABEL))
  .sort();

describe("lightbox overlay warm-up (test-infra guard)", () => {
  it("finds every test file that drives the lightbox trigger", () => {
    // Guards the guard: if this scan silently matched nothing, the per-file
    // assertions below would vacuously pass.
    expect(openers).toEqual([
      "capture-sheet.test.tsx",
      "phase-uploader-delete.test.tsx",
      "photo-lightbox.test.tsx",
      "photo-markup.test.tsx",
      "photo-rotate.test.tsx",
      "schedule-views.test.tsx",
    ]);
  });

  it.each(openers)("%s pre-warms the overlay chunk before any open", (file) => {
    const src = stripComments(readFileSync(join(UNIT_DIR, file), "utf8"));
    // Imported...
    expect(src).toContain(HELPER_MODULE);
    // ...and actually registered, so the cold import lands in a beforeAll hook
    // (10s hookTimeout) instead of inside a 1000ms assertion window.
    expect(src).toContain(REGISTRATION);
    // Import plus registration — a lone import line must not satisfy this.
    expect(occurrences(src, "warmLightboxOverlay")).toBeGreaterThanOrEqual(2);
  });
});
