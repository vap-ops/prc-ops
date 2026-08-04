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
import { PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";

describe("REPORT_SELECTABLE_PHASES (operator ruling)", () => {
  it("excludes defect and admits every other phase", () => {
    expect([...REPORT_SELECTABLE_PHASES].sort()).toEqual(
      ["after", "after_fix", "before", "during"].sort(),
    );
    expect(isReportSelectablePhase("defect")).toBe(false);
    expect(isReportSelectablePhase("after")).toBe(true);
    expect(isReportSelectablePhase("after_fix")).toBe(true);
  });

  // ⚠️ The doc comment says a new enum value "must land here deliberately" —
  // prose cannot enforce that. THIS does: the selectable set plus the one
  // deliberate exclusion must cover the WHOLE photo_phase domain, so adding a
  // value to the enum reds here until someone decides which side it belongs on.
  // Without it, a new phase would be silently unselectable AND refused with a
  // message naming จุดบกพร่อง as the reason.
  it("partitions the COMPLETE photo_phase domain — no phase is unclassified", () => {
    const DELIBERATELY_EXCLUDED = ["defect"];
    const wholeDomain = Object.keys(PHOTO_PHASE_LABEL).sort();
    expect([...REPORT_SELECTABLE_PHASES, ...DELIBERATELY_EXCLUDED].sort()).toEqual(wholeDomain);
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
    // Pin the USE, not the import line — `toContain` alone is satisfied by the
    // import and survives deleting the loop.
    expect(SRC).toContain("for (const phase of REPORT_SELECTABLE_PHASES)");
    // And pin the literal BARE, not in one particular tuple formatting: the
    // earlier `'"after_fix", "defect"'` pin passed on a reorder or a prettier
    // reflow. Comments are stripped above, so the surviving explanatory comment
    // mentioning defect does not satisfy this.
    expect(SRC).not.toContain('"defect"');
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

  // ⚠️ ABSOLUTE counts, not `selection === starring - 1`. That relative form
  // reds for an unrelated reason the first time a gallery legitimately carries
  // one prop and not the other, and stays GREEN if someone re-adds the prop to
  // the defect block while dropping `starring` elsewhere — it constrains the
  // difference, not either fact.
  it("three galleries offer starring; exactly two offer the report toggle", () => {
    expect(PAGE.split("starring={starring}").length - 1).toBe(3);
    expect(PAGE.split("reportSelection={reportSelection}").length - 1).toBe(2);
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
