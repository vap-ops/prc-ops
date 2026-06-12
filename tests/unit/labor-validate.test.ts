// Spec 46 P1 — pure validation for labor entry + corrections. Dates
// are ISO date strings; "today" is injected (Asia/Bangkok resolution
// happens at the call site, C7).

import { describe, it, expect } from "vitest";
import { validateLaborEntry, validateCorrection } from "@/lib/labor/validate";

const TODAY = "2026-06-12";

describe("validateLaborEntry", () => {
  it("accepts today's entry with workers selected", () => {
    expect(
      validateLaborEntry(
        { workDate: TODAY, workerIds: ["w1", "w2"] },
        { today: TODAY, role: "site_admin" },
      ),
    ).toBeNull();
  });

  it("rejects a future date", () => {
    expect(
      validateLaborEntry(
        { workDate: "2026-06-13", workerIds: ["w1"] },
        { today: TODAY, role: "site_admin" },
      ),
    ).toMatch(/อนาคต/);
  });

  it("rejects an empty worker selection", () => {
    expect(
      validateLaborEntry({ workDate: TODAY, workerIds: [] }, { today: TODAY, role: "site_admin" }),
    ).toMatch(/เลือก/);
  });

  it("rejects >14-day backdating for site_admin", () => {
    expect(
      validateLaborEntry(
        { workDate: "2026-05-28", workerIds: ["w1"] },
        { today: TODAY, role: "site_admin" },
      ),
    ).toMatch(/14/);
  });

  it("allows >14-day backdating for project_manager and super_admin", () => {
    for (const role of ["project_manager", "super_admin"] as const) {
      expect(
        validateLaborEntry({ workDate: "2026-05-01", workerIds: ["w1"] }, { today: TODAY, role }),
      ).toBeNull();
    }
  });

  it("rejects a malformed date string", () => {
    expect(
      validateLaborEntry(
        { workDate: "12/06/2026", workerIds: ["w1"] },
        { today: TODAY, role: "site_admin" },
      ),
    ).not.toBeNull();
  });
});

describe("validateCorrection", () => {
  it("accepts a reason with a new fraction", () => {
    expect(
      validateCorrection({ reason: "ลงผิดวัน", fraction: "half", tombstone: false }),
    ).toBeNull();
  });

  it("accepts a removal without a fraction", () => {
    expect(validateCorrection({ reason: "คนละงาน", fraction: null, tombstone: true })).toBeNull();
  });

  it("rejects a blank reason", () => {
    expect(
      validateCorrection({ reason: "   ", fraction: "full", tombstone: false }),
    ).not.toBeNull();
  });

  it("rejects a reason over 300 characters", () => {
    expect(
      validateCorrection({ reason: "ก".repeat(301), fraction: "full", tombstone: false }),
    ).not.toBeNull();
  });

  it("rejects a non-tombstone correction without a fraction", () => {
    expect(
      validateCorrection({ reason: "เหตุผล", fraction: null, tombstone: false }),
    ).not.toBeNull();
  });
});
