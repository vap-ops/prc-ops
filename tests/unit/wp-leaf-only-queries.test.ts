// Spec 270 U5 — static pins: surfaces that enumerate work packages with an
// INLINE query (no shared loader to unit-test) must exclude งาน grouping rows
// at the query (`.eq("is_group", false)` chained onto the work_packages read).
// Same static-scan pattern as ui-class-contracts.test.tsx — the pin fails the
// build if a future edit drops the filter. Loader-backed surfaces (schedule,
// client portal, project roster) pin this in their own loader tests instead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

// Each entry: the file + how many of its work_packages reads must carry the
// leaf-only filter (sa worklist = 1; dashboard progress read = 1; report job
// WP enumeration = 1).
const PINNED: Array<{ file: string; minFiltered: number }> = [
  { file: "src/app/sa/page.tsx", minFiltered: 1 },
  { file: "src/app/dashboard/page.tsx", minFiltered: 1 },
  { file: "src/lib/reports/run-report-job.ts", minFiltered: 1 },
];

function countLeafFilteredWpReads(source: string): number {
  // A qualifying read chains .from("work_packages") … .eq("is_group", false)
  // within the same statement (non-greedy, no intervening semicolon). Line
  // comments are stripped first so prose punctuation can't defeat the pin.
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  // No dotall flag needed (tsconfig target predates es2018): [^;] spans newlines.
  const re = /from\("work_packages"\)[^;]*?\.eq\("is_group",\s*false\)/g;
  return (code.match(re) ?? []).length;
}

describe("leaf-only WP enumeration (spec 270 U5)", () => {
  for (const { file, minFiltered } of PINNED) {
    it(`${file} filters งาน rows out of its work_packages read`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(countLeafFilteredWpReads(source)).toBeGreaterThanOrEqual(minFiltered);
    });
  }
});
