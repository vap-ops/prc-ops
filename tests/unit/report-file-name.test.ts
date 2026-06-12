// Unit tests for buildReportFileName (spec 60) — the filename used for
// the signed-URL download disposition AND the share-sheet File name.

import { describe, it, expect } from "vitest";

import { buildReportFileName } from "@/lib/reports/file-name";

describe("buildReportFileName", () => {
  it("builds {code}-report-{YYYYMMDD}.pdf from the created timestamp", () => {
    expect(buildReportFileName("PRC-2026-001", "2026-06-12T17:13:00Z")).toBe(
      "PRC-2026-001-report-20260613.pdf",
    );
  });

  it("pins the date to Asia/Bangkok (UTC+7 day flip)", () => {
    // 23:30 UTC on the 12th is already the 13th in Bangkok.
    expect(buildReportFileName("P1", "2026-06-12T23:30:00Z")).toBe("P1-report-20260613.pdf");
    // 16:59 UTC on the 12th is still the 12th in Bangkok (23:59).
    expect(buildReportFileName("P1", "2026-06-12T16:59:00Z")).toBe("P1-report-20260612.pdf");
  });

  it("degrades to a dateless name on an invalid timestamp", () => {
    expect(buildReportFileName("P1", "not-a-date")).toBe("P1-report.pdf");
  });
});
