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

// Comments are stripped before deciding WHICH files open the lightbox: several
// carry a comment explaining the next/dynamic chunk. Stripping here can only
// over-include (a file naming the label in a trailing comment still gets
// required to warm up), which is the safe direction.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// The two pins below are LINE-based, not substring-based, and deliberately do
// not reuse stripComments. A first review of this guard found that a trailing
// comment satisfied all of its substring assertions — `import { … } from
// "../helpers/lightbox-overlay-warmup"; // beforeAll(warmLightboxOverlay)`
// passed with the real call deleted, because the line-comment regex above only
// strips comments that START a line. Stripping from the first `//` instead is
// not an option: these files hold `https://example.test/...` URLs, which that
// would truncate. Requiring the code to be the FIRST thing on its own line is
// immune to both.
function hasCodeLineStartingWith(src: string, prefix: string): boolean {
  return src.split(/\r?\n/).some((line) => line.trim().startsWith(prefix));
}

function hasImportOf(src: string, module: string): boolean {
  return src
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith("import") && line.includes(module));
}

// `.test.tsx` AND `.spec.tsx` — vitest.config.ts's include glob is
// `tests/unit/**/*.{test,spec}.{ts,tsx}`, so a `.spec.tsx` opener would
// otherwise sit outside this guard (none exist today; this closes it early).
// The `.tsx`-only filter is what keeps THIS file (a `.test.ts` holding the
// trigger label as a constant) from matching itself.
const openers = readdirSync(UNIT_DIR)
  .filter((f) => f.endsWith(".test.tsx") || f.endsWith(".spec.tsx"))
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
    const src = readFileSync(join(UNIT_DIR, file), "utf8");
    // Imported on a real import line...
    expect(hasImportOf(src, HELPER_MODULE)).toBe(true);
    // ...and actually registered as the first thing on its own line, so the
    // cold import lands in a beforeAll hook (10s hookTimeout) instead of inside
    // a 1000ms assertion window. A commented-out call does not count.
    expect(hasCodeLineStartingWith(src, REGISTRATION)).toBe(true);
  });
});
