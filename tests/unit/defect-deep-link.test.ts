// Writing failing test first.
//
// Spec 337 U5 — the defect deep link. The project WP list offers a door on a
// เสร็จแล้ว row; the WP detail reads the param back and opens the existing
// ReportDefectControl sheet. Producer and consumer share ONE module so the
// query key can never drift apart (a mismatch would render a door that opens
// nothing, and no type would catch it).

import { describe, expect, it } from "vitest";
import { defectHref, shouldOpenDefectSheet } from "@/lib/work-packages/defect-deep-link";

describe("defectHref", () => {
  it("appends the defect param to the work-package href", () => {
    expect(defectHref("proj-1", "wp-1")).toBe("/projects/proj-1/work-packages/wp-1?defect=1");
  });

  it("produces a href the page's own parser accepts", () => {
    // The round-trip is the point of the module: whatever the door emits, the
    // detail page must read as "open the sheet".
    const url = new URL(defectHref("proj-1", "wp-1"), "https://example.test");
    expect(shouldOpenDefectSheet(url.searchParams.get("defect") ?? undefined)).toBe(true);
  });
});

describe("shouldOpenDefectSheet", () => {
  it("opens only for the exact declared value", () => {
    expect(shouldOpenDefectSheet("1")).toBe(true);
  });

  it("stays closed for a missing, empty, or unrecognised param", () => {
    // Spec 337 U5: an unrecognised param is ignored SILENTLY — the page renders
    // normally, it never errors.
    expect(shouldOpenDefectSheet(undefined)).toBe(false);
    expect(shouldOpenDefectSheet("")).toBe(false);
    expect(shouldOpenDefectSheet("0")).toBe(false);
    expect(shouldOpenDefectSheet("true")).toBe(false);
    expect(shouldOpenDefectSheet("11")).toBe(false);
  });
});
