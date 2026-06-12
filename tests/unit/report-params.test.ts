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
});
