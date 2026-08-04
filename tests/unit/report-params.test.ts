// Unit tests for ReportParams parsing (spec 61). Old rows carry '{}';
// readers must fall back per-field and never throw.

import { describe, it, expect } from "vitest";

import { DEFAULT_REPORT_PARAMS, parseReportParams } from "@/lib/reports/params";

describe("DEFAULT_REPORT_PARAMS", () => {
  it("pins the legacy report shape: complete WPs, after photos", () => {
    expect(DEFAULT_REPORT_PARAMS).toEqual({ scope: "complete", photos: "after" });
  });
});

describe("parseReportParams", () => {
  it("empty object (every pre-61 row) → defaults", () => {
    expect(parseReportParams({})).toEqual(DEFAULT_REPORT_PARAMS);
  });

  it("fully valid params pass through", () => {
    expect(parseReportParams({ scope: "all", photos: "none" })).toEqual({
      scope: "all",
      photos: "none",
    });
    expect(parseReportParams({ scope: "complete", photos: "all_phases" })).toEqual({
      scope: "complete",
      photos: "all_phases",
    });
  });

  it("partial params fall back per-field", () => {
    expect(parseReportParams({ scope: "all" })).toEqual({ scope: "all", photos: "after" });
    expect(parseReportParams({ photos: "none" })).toEqual({ scope: "complete", photos: "none" });
  });

  it("junk values fall back per-field, never throw", () => {
    expect(parseReportParams({ scope: "everything", photos: 42 })).toEqual(DEFAULT_REPORT_PARAMS);
    expect(parseReportParams(null)).toEqual(DEFAULT_REPORT_PARAMS);
    expect(parseReportParams(undefined)).toEqual(DEFAULT_REPORT_PARAMS);
    expect(parseReportParams("scope=all")).toEqual(DEFAULT_REPORT_PARAMS);
    expect(parseReportParams([])).toEqual(DEFAULT_REPORT_PARAMS);
  });

  // Spec 394 U3 — the 4th mode. The existing three are untouched by
  // construction: this only widens the accepted set.
  it("round-trips the spec-394 'selected' mode", () => {
    expect(parseReportParams({ scope: "all", photos: "selected" })).toEqual({
      scope: "all",
      photos: "selected",
    });
  });

  it("still rejects an unknown mode after 'selected' was added", () => {
    expect(parseReportParams({ photos: "chosen" })).toEqual(DEFAULT_REPORT_PARAMS);
  });

  // Spec 394 D7 — the cover note rides the SAME jsonb, so it needs no schema.
  // Absent is absent: the key must not appear as undefined/empty, because the
  // PDF prints nothing at all rather than an empty heading.
  it("carries a cover note when present, and omits the key entirely when not", () => {
    expect(
      parseReportParams({ scope: "complete", photos: "selected", coverNote: "เรียนลูกค้า" }),
    ).toEqual({
      scope: "complete",
      photos: "selected",
      coverNote: "เรียนลูกค้า",
    });
    expect(parseReportParams({ scope: "complete", photos: "after" })).not.toHaveProperty(
      "coverNote",
    );
  });

  it("drops a blank or non-string cover note rather than storing an empty one", () => {
    expect(parseReportParams({ coverNote: "   " })).not.toHaveProperty("coverNote");
    expect(parseReportParams({ coverNote: 42 })).not.toHaveProperty("coverNote");
    expect(parseReportParams({ coverNote: "  ok  " })).toMatchObject({ coverNote: "ok" });
  });
});
