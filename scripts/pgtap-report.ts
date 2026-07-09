// Verdict logic for the pgTAP runner (scripts/run-pgtap.ts). Pure + side-effect
// free so it is unit-tested in tests/unit/pgtap-report.test.ts without touching
// the shared remote DB.
//
// The runner hits the ONE shared Supabase project and carries a small, pinned
// set of pre-existing red files — the "known-red allowlist" in
// supabase/tests/known-red.json. A CI run passes iff EXACTLY the allowlisted
// files fail, each within its pinned failing-assertion budget: any other red
// fails the check, an allowlisted file that exceeds its budget fails the check
// (a NEW regression landing inside a quarantined file is NOT masked), and an
// allowlisted file that starts passing is surfaced so the list does not rot.
// See ADR 0081.

import { readFileSync } from "node:fs";

export interface FileResult {
  /** Basename as produced by readdirSync, e.g. "200-store.test.sql". */
  file: string;
  /** Count of failing assertions in this file (0 = green). */
  failures: number;
}

export interface Verdict {
  /** True iff no non-allowlisted file failed and no allowlisted file exceeded budget. */
  ok: boolean;
  /** Allowlisted AND failing within its pinned budget — tolerated. */
  expectedFailures: string[];
  /** Not allowlisted, OR allowlisted but with MORE failures than pinned — these fail the check. */
  unexpectedFailures: string[];
  /** Allowlisted BUT now green — candidate to remove from the allowlist. */
  unexpectedPasses: string[];
}

/** file basename -> max tolerated failing assertions for that file. */
export type KnownRed = ReadonlyMap<string, number>;

export function partitionResults(results: readonly FileResult[], knownRed: KnownRed): Verdict {
  const expectedFailures: string[] = [];
  const unexpectedFailures: string[] = [];
  const unexpectedPasses: string[] = [];
  for (const r of results) {
    const budget = knownRed.get(r.file);
    if (r.failures > 0) {
      // Tolerated only if allowlisted AND at or under its pinned budget; a file
      // failing MORE than pinned (or not listed at all) is a real red.
      if (budget !== undefined && r.failures <= budget) {
        expectedFailures.push(r.file);
      } else {
        unexpectedFailures.push(r.file);
      }
    } else if (budget !== undefined) {
      unexpectedPasses.push(r.file);
    }
  }
  return {
    ok: unexpectedFailures.length === 0,
    expectedFailures,
    unexpectedFailures,
    unexpectedPasses,
  };
}

interface KnownRedManifest {
  files?: Array<{ file?: unknown; maxFailures?: unknown }>;
}

/**
 * Load the allowlist: file basename -> max tolerated failing assertions.
 * Fail-closed: a missing/unparseable manifest, or an entry missing a valid
 * non-negative integer `maxFailures`, yields no tolerance for that file (its
 * reds become unexpected → the check fails loudly), never a silent
 * "tolerate everything".
 */
export function loadKnownRed(filePath: string): Map<string, number> {
  const out = new Map<string, number>();
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return out;
  }
  let parsed: KnownRedManifest;
  try {
    parsed = JSON.parse(raw) as KnownRedManifest;
  } catch {
    return out;
  }
  for (const entry of parsed.files ?? []) {
    if (
      entry &&
      typeof entry.file === "string" &&
      entry.file.length > 0 &&
      typeof entry.maxFailures === "number" &&
      Number.isInteger(entry.maxFailures) &&
      entry.maxFailures >= 0
    ) {
      out.set(entry.file, entry.maxFailures);
    }
  }
  return out;
}
