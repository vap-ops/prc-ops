// Spec 65 §A — shared Bangkok-calendar date primitives. bangkokTodayIso
// previously existed three times (labor/dates, validate-purchase-request,
// purchase-request-form); ISO_DATE_REGEX three times. This pins the single
// home plus the labor/dates compat re-export.
import { describe, expect, it } from "vitest";

import { ISO_DATE_REGEX, bangkokTodayIso } from "@/lib/dates";
import { bangkokTodayIso as fromLaborDates } from "@/lib/labor/dates";

describe("bangkokTodayIso", () => {
  it("returns an ISO calendar date in Asia/Bangkok", () => {
    const value = bangkokTodayIso();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
    }).format(new Date());
    expect(value).toBe(expected);
  });

  it("labor/dates re-export is the same function (compat)", () => {
    expect(fromLaborDates).toBe(bangkokTodayIso);
  });
});

describe("ISO_DATE_REGEX", () => {
  it("matches YYYY-MM-DD shapes only", () => {
    expect(ISO_DATE_REGEX.test("2026-06-13")).toBe(true);
    expect(ISO_DATE_REGEX.test("2026-6-13")).toBe(false);
    expect(ISO_DATE_REGEX.test("13-06-2026")).toBe(false);
    expect(ISO_DATE_REGEX.test("2026-06-13T00:00:00Z")).toBe(false);
    expect(ISO_DATE_REGEX.test("")).toBe(false);
  });

  it("source is the historic shape (drift pin)", () => {
    expect(ISO_DATE_REGEX.source).toBe("^\\d{4}-\\d{2}-\\d{2}$");
  });
});
