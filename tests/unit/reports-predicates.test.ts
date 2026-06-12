// Pure predicates behind the PM report UI: the duplicate-guard predicate
// (can a PM generate a new report when these reports already exist for
// the project?) and the status display mapping. Same shape as
// approvals-helpers — pure / typed, individually testable.
//
// The duplicate guard is the same rule the generateReport server action
// applies (no new report while one is requested/processing for the same
// project). Centralising it here means the action and any future surface
// share one implementation.

import { describe, it, expect } from "vitest";

import {
  REPORT_IN_FLIGHT_STATUSES,
  REPORT_STATUS_LABEL,
  canGenerateReport,
  isReportInFlight,
  type ReportStatus,
} from "@/lib/reports/predicates";

describe("REPORT_IN_FLIGHT_STATUSES", () => {
  it("contains exactly requested and processing", () => {
    expect([...REPORT_IN_FLIGHT_STATUSES]).toEqual(["requested", "processing"]);
  });
});

describe("isReportInFlight", () => {
  it("returns true for requested and processing", () => {
    expect(isReportInFlight("requested")).toBe(true);
    expect(isReportInFlight("processing")).toBe(true);
  });

  it("returns false for terminal states", () => {
    expect(isReportInFlight("complete")).toBe(false);
    expect(isReportInFlight("failed")).toBe(false);
  });
});

describe("canGenerateReport", () => {
  it("allows generation when there are no existing reports", () => {
    expect(canGenerateReport([])).toBe(true);
  });

  it("allows generation when every existing report is terminal", () => {
    const statuses: ReportStatus[] = ["complete", "failed", "complete"];
    expect(canGenerateReport(statuses)).toBe(true);
  });

  it("refuses when any existing report is requested", () => {
    expect(canGenerateReport(["requested"])).toBe(false);
    expect(canGenerateReport(["complete", "requested", "failed"])).toBe(false);
  });

  it("refuses when any existing report is processing", () => {
    expect(canGenerateReport(["processing"])).toBe(false);
    expect(canGenerateReport(["complete", "processing"])).toBe(false);
  });

  it("refuses when both requested and processing reports exist", () => {
    expect(canGenerateReport(["requested", "processing"])).toBe(false);
  });
});

describe("REPORT_STATUS_LABEL", () => {
  it("provides a human label for every report_status enum value", () => {
    expect(REPORT_STATUS_LABEL.requested).toBeTruthy();
    expect(REPORT_STATUS_LABEL.processing).toBeTruthy();
    expect(REPORT_STATUS_LABEL.complete).toBeTruthy();
    expect(REPORT_STATUS_LABEL.failed).toBeTruthy();
  });

  it("distinguishes every status from every other status", () => {
    const labels = new Set(Object.values(REPORT_STATUS_LABEL));
    expect(labels.size).toBe(4);
  });
});
