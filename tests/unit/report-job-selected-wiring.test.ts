// @vitest-environment node
// (reads its own source via import.meta.url — jsdom's URL is not a file URL)
//
// Spec 394 U3 — the `เฉพาะที่เลือก` branch of run-report-job.
//
// run-report-job is I/O end to end (Supabase + Storage) and has no existing
// harness, so the DECISION was extracted into buildSelectedPhotoOrder (unit
// tested next door) and the WIRING is pinned here at the source. A source pin
// proves a symbol is wired, never that it is correct — which is exactly the
// split: correctness lives in the pure builder's tests.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  new URL("../../src/lib/reports/run-report-job.ts", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
  .join("\n");

describe("run-report-job selected-photos wiring (spec 394 U3)", () => {
  it("reads the selection table and orders it through the pure builder", () => {
    expect(SRC).toContain('.from("report_selected_photos")');
    // import + call
    expect(SRC.split("buildSelectedPhotoOrder").length - 1).toBe(2);
  });

  it("only queries the selection table in the 'selected' mode", () => {
    // The other three modes must not pay for a query they never read — and
    // more importantly, a selection must not leak into a phase-rule report.
    const guard = SRC.indexOf('params.photos === "selected"');
    const query = SRC.indexOf('.from("report_selected_photos")');
    expect(guard).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(guard);
  });

  it("emits ONE unlabelled group per work package, not one per phase", () => {
    // Phase grouping would re-separate the before/after pair D6 exists to put
    // side by side, so this branch builds a single `label: null` group.
    // Slice EXACTLY the selected arm — from the in-loop guard to the `else if`
    // that starts the phase-rule arm. A slice to end-of-file would run into the
    // phase branch and its PHOTO_PHASE_LABEL, and the assertion would be about
    // the wrong code.
    const start = SRC.indexOf(
      'if (params.photos === "selected") {',
      SRC.indexOf("for (const wp of"),
    );
    const end = SRC.indexOf('} else if (params.photos !== "none")', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = SRC.slice(start, end);
    expect(branch).toContain("label: null");
    expect(branch.indexOf("PHOTO_PHASE_LABEL")).toBe(-1);
  });

  it("passes the cover note through to the builder", () => {
    expect(SRC).toContain("coverNote");
    const note = SRC.indexOf("params.coverNote");
    const build = SRC.indexOf("buildReportPdf({");
    expect(note).toBeGreaterThan(build);
  });

  // ⚠️ The first version of this asserted `includeEmptyWorkPackages: params.photos
  // === "none"` — a line that PREDATES this unit and survives deleting the whole
  // selected branch. It read like coverage and was worth nothing (review catch).
  // What actually needs pinning is the §7 rule the branch introduced.
  it("FAILS a selected report that resolves to no photos, rather than emitting an empty PDF", () => {
    const guard = SRC.indexOf('params.photos === "selected" && sections.every');
    const build = SRC.indexOf("buildReportPdf({");
    expect(guard).toBeGreaterThan(-1);
    // the throw must precede the build, or the empty PDF is already made
    expect(guard).toBeLessThan(build);
    const arm = SRC.slice(guard, build);
    expect(arm).toContain("throw new Error");
  });
});
