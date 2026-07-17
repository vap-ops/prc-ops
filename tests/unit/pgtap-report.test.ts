import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadKnownRed, partitionResults, type FileResult } from "../../scripts/pgtap-report";

// The pgTAP runner hits the ONE shared remote DB and carries a small, pinned set
// of pre-existing red files with a per-file failing-assertion budget (the
// "known-red allowlist"). These tests lock the verdict logic that decides whether
// a CI run passes: exactly the allowlisted files may fail, each within its budget;
// anything else — including MORE failures than pinned inside a listed file — fails
// the check.

describe("partitionResults", () => {
  it("passes when everything is green and the allowlist is empty", () => {
    const results: FileResult[] = [
      { file: "a.test.sql", failures: 0 },
      { file: "b.test.sql", failures: 0 },
    ];
    const v = partitionResults(results, new Map());
    expect(v.ok).toBe(true);
    expect(v.unexpectedFailures).toEqual([]);
    expect(v.expectedFailures).toEqual([]);
    expect(v.unexpectedPasses).toEqual([]);
  });

  it("fails on a red file that is NOT allowlisted", () => {
    const results: FileResult[] = [
      { file: "a.test.sql", failures: 0 },
      { file: "x.test.sql", failures: 1 },
    ];
    const v = partitionResults(results, new Map());
    expect(v.ok).toBe(false);
    expect(v.unexpectedFailures).toEqual(["x.test.sql"]);
  });

  it("tolerates a red file that IS allowlisted and within its budget", () => {
    const results: FileResult[] = [
      { file: "200-x.test.sql", failures: 3 },
      { file: "b.test.sql", failures: 0 },
    ];
    const v = partitionResults(results, new Map([["200-x.test.sql", 3]]));
    expect(v.ok).toBe(true);
    expect(v.expectedFailures).toEqual(["200-x.test.sql"]);
    expect(v.unexpectedFailures).toEqual([]);
  });

  it("FAILS an allowlisted file that exceeds its pinned budget (new regression not masked)", () => {
    const results: FileResult[] = [{ file: "200-x.test.sql", failures: 4 }];
    const v = partitionResults(results, new Map([["200-x.test.sql", 3]]));
    expect(v.ok).toBe(false);
    expect(v.unexpectedFailures).toEqual(["200-x.test.sql"]);
    expect(v.expectedFailures).toEqual([]);
  });

  it("treats an errored file (Infinity failures) as unexpected even if allowlisted", () => {
    const results: FileResult[] = [{ file: "200-x.test.sql", failures: Number.POSITIVE_INFINITY }];
    const v = partitionResults(results, new Map([["200-x.test.sql", 3]]));
    expect(v.ok).toBe(false);
    expect(v.unexpectedFailures).toEqual(["200-x.test.sql"]);
  });

  it("tolerates but flags an allowlisted file that now PASSES (de-quarantine nudge)", () => {
    const results: FileResult[] = [{ file: "200-x.test.sql", failures: 0 }];
    const v = partitionResults(results, new Map([["200-x.test.sql", 3]]));
    expect(v.ok).toBe(true);
    expect(v.unexpectedPasses).toEqual(["200-x.test.sql"]);
  });

  it("fails when a NON-allowlisted file fails even if an allowlisted one also fails", () => {
    const results: FileResult[] = [
      { file: "200-known.test.sql", failures: 3 },
      { file: "999-new.test.sql", failures: 1 },
      { file: "ok.test.sql", failures: 0 },
    ];
    const v = partitionResults(results, new Map([["200-known.test.sql", 3]]));
    expect(v.ok).toBe(false);
    expect(v.unexpectedFailures).toEqual(["999-new.test.sql"]);
    expect(v.expectedFailures).toEqual(["200-known.test.sql"]);
  });
});

describe("loadKnownRed", () => {
  it("parses a manifest into a Map of filename -> maxFailures, ignoring metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "known-red-"));
    const path = join(dir, "known-red.json");
    writeFileSync(
      path,
      JSON.stringify({
        files: [
          { file: "200-store.test.sql", maxFailures: 3, reason: "x", since: "2026-06" },
          { file: "221-feedback.test.sql", maxFailures: 1, reason: "y", since: "2026-06" },
        ],
      }),
    );
    const map = loadKnownRed(path);
    expect(map).toBeInstanceOf(Map);
    expect(map.get("200-store.test.sql")).toBe(3);
    expect(map.get("221-feedback.test.sql")).toBe(1);
    expect(map.size).toBe(2);
  });

  it("skips entries missing a valid non-negative integer maxFailures (fail-closed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "known-red-bad-"));
    const path = join(dir, "known-red.json");
    writeFileSync(
      path,
      JSON.stringify({
        files: [
          { file: "good.test.sql", maxFailures: 2 },
          { file: "no-budget.test.sql" },
          { file: "negative.test.sql", maxFailures: -1 },
          { file: "float.test.sql", maxFailures: 1.5 },
        ],
      }),
    );
    const map = loadKnownRed(path);
    expect(map.size).toBe(1);
    expect(map.get("good.test.sql")).toBe(2);
  });

  it("returns an empty map when the manifest is absent (fail-closed: nothing tolerated)", () => {
    const map = loadKnownRed(join(tmpdir(), "does-not-exist-known-red.json"));
    expect(map.size).toBe(0);
  });
});

// Guard the SHIPPED allowlist: a typo'd entry would silently fail to tolerate the
// real red (so CI would fail) or quarantine a file that does not exist. Every
// allowlisted name must correspond to a real test file, and the two current
// pre-existing reds must be present with their pinned budgets.
describe("shipped known-red manifest", () => {
  const MANIFEST = "supabase/tests/known-red.json";
  const TESTS_DIR = "supabase/tests/database";

  it("lists only files that actually exist under supabase/tests/database", () => {
    const listed = loadKnownRed(MANIFEST);
    expect(listed.size).toBeGreaterThan(0);
    const onDisk = new Set(readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.sql")));
    for (const file of listed.keys()) {
      expect(onDisk.has(file), `${file} is allowlisted but not on disk`).toBe(true);
    }
  });

  it("pins the current pre-existing red with its budget", () => {
    const listed = loadKnownRed(MANIFEST);
    // Spec 324 U7: 200-store un-pinned — its 1500↔on-hand drift was explained
    // (capitalized PO charges) and the tie is now modeled + green. Only the
    // 221-catalog seed-count drift remains.
    expect(listed.get("200-store-inventory-reconciliation.test.sql")).toBeUndefined();
    expect(listed.get("221-catalog-categories.test.sql")).toBe(1);
    expect(listed.size).toBe(1);
  });
});
