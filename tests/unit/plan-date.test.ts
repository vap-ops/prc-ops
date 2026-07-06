import { describe, it, expect } from "vitest";

// Spec 273 U5 — the /sa แผนพรุ่งนี้ builder becomes date-navigable so a SA can EDIT
// today's (or any future) board, not only tomorrow's. resolvePlanDate maps the
// optional ?date= param to the board date: default พรุ่งนี้, floor at today, and
// reject anything malformed / calendar-invalid / in the past.

import { resolvePlanDate } from "@/app/sa/plan/plan-date";

const TODAY = "2026-07-07";
const TOMORROW = "2026-07-08";

describe("resolvePlanDate", () => {
  it("defaults to พรุ่งนี้ when no date is given", () => {
    expect(resolvePlanDate(undefined, TODAY)).toBe(TOMORROW);
    expect(resolvePlanDate("", TODAY)).toBe(TOMORROW);
  });

  it("accepts today (the floor)", () => {
    expect(resolvePlanDate(TODAY, TODAY)).toBe(TODAY);
  });

  it("accepts a future date", () => {
    expect(resolvePlanDate("2026-07-20", TODAY)).toBe("2026-07-20");
  });

  it("rejects a past date, falling back to พรุ่งนี้", () => {
    expect(resolvePlanDate("2026-07-06", TODAY)).toBe(TOMORROW);
    expect(resolvePlanDate("2025-01-01", TODAY)).toBe(TOMORROW);
  });

  it("rejects a malformed or calendar-invalid date", () => {
    expect(resolvePlanDate("not-a-date", TODAY)).toBe(TOMORROW);
    expect(resolvePlanDate("2026-13-99", TODAY)).toBe(TOMORROW);
    expect(resolvePlanDate("2026-02-30", TODAY)).toBe(TOMORROW);
    expect(resolvePlanDate("2026-7-7", TODAY)).toBe(TOMORROW);
  });
});
