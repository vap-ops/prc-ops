// @vitest-environment node
// Spec 394 — operator ruling 2026-08-04: a `defect` photo is NEVER selectable
// for a client report. A defect photo is evidence of BROKEN work; the client
// report is the finished-work document, and the two must not mix.
//
// Withholding the button alone would be affordance-deep only, so this pins all
// three layers: the SSOT, the write path, and the read path that builds the PDF.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REPORT_SELECTABLE_PHASES, isReportSelectablePhase } from "@/lib/reports/selected-photos";

describe("REPORT_SELECTABLE_PHASES (operator ruling)", () => {
  it("excludes defect and admits every other phase", () => {
    // The complete photo_phase domain — a NEW enum value must land here
    // deliberately rather than defaulting into a client's report.
    expect([...REPORT_SELECTABLE_PHASES].sort()).toEqual(
      ["after", "after_fix", "before", "during"].sort(),
    );
    expect(isReportSelectablePhase("defect")).toBe(false);
    expect(isReportSelectablePhase("after")).toBe(true);
    expect(isReportSelectablePhase("after_fix")).toBe(true);
  });
});

describe("the PDF resolver cannot emit a defect photo (read path)", () => {
  const SRC = readFileSync(
    new URL("../../src/lib/reports/run-report-job.ts", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

  it("resolves paths from the selectable phases only, never a hardcoded list with defect", () => {
    expect(SRC).toContain("REPORT_SELECTABLE_PHASES");
    // the previous hardcoded tuple included "defect" — it must be gone, so a
    // row that predates the ruling still cannot print
    expect(SRC).not.toContain('"after_fix", "defect"');
  });
});

describe("the review page withholds the toggle on defect galleries (affordance)", () => {
  // ⚠️ Block comments are stripped FIRST. The fix's own JSX comment explains
  // why reportSelection is absent — and mentions it by name, which would make
  // this assertion fail on a correct file (the guard-satisfied-by-its-own-
  // documentation trap, in reverse).
  const PAGE = readFileSync(
    new URL("../../src/app/review/work-packages/[workPackageId]/page.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

  it("passes reportSelection to fewer galleries than starring — the defect one is skipped", () => {
    const starring = PAGE.split("starring={starring}").length - 1;
    const selection = PAGE.split("reportSelection={reportSelection}").length - 1;
    expect(starring).toBeGreaterThan(0);
    // exactly one gallery (the prior-round defect one) loses it
    expect(selection).toBe(starring - 1);
  });

  it("the defect-round gallery block carries no reportSelection", () => {
    // Anchor on the RENDERED block, not the `defectRounds` declaration far
    // above it — a slice from the declaration spans other galleries that DO
    // carry the prop, and the assertion would be about the wrong code.
    const start = PAGE.indexOf("key={`defect-${round}`}");
    const end = PAGE.indexOf("showAfterFixHistory", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(PAGE.slice(start, end)).not.toContain("reportSelection");
  });
});
