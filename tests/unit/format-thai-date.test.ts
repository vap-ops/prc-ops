// Pins for the date-only Thai formatter (spec 16 §2): Buddhist era,
// Asia/Bangkok, no time-of-day (formatThaiDateTime would render a
// phantom 00:00 for date columns). Invalid input degrades to the raw
// string, matching formatThaiDateTime's recorded failure mode.

import { describe, expect, it } from "vitest";
import { formatThaiDate } from "@/lib/i18n/labels";

describe("formatThaiDate", () => {
  it("renders a date column value in Thai Buddhist era without a time", () => {
    // 2026-06-13 → BE 2569.
    const out = formatThaiDate("2026-06-13");
    expect(out).toContain("2569");
    expect(out).toContain("มิ.ย.");
    expect(out).toContain("13");
    expect(out).not.toMatch(/\d{2}:\d{2}/);
  });

  it("is pinned to Asia/Bangkok (a UTC instant late in the day stays the same date)", () => {
    // 2026-06-13T20:00:00Z is already 2026-06-14 03:00 in Bangkok.
    const out = formatThaiDate("2026-06-13T20:00:00Z");
    expect(out).toContain("14");
  });

  it("degrades to the raw string on unparseable input", () => {
    expect(formatThaiDate("not-a-date")).toBe("not-a-date");
  });
});
