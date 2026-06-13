// Spec 68 — bangkokDateOf buckets an ISO timestamp to its Asia/Bangkok
// (UTC+7) calendar date. The variance strip compares photo-activity days
// (server/client capture timestamps) against labor work_dates, and labor
// work_dates are already Bangkok calendar dates (spec 46 C7) — so the
// photo side MUST bucket in the same timezone or the diff is noise.

import { describe, it, expect } from "vitest";
import { bangkokDateOf } from "@/lib/dates";

describe("bangkokDateOf", () => {
  it("keeps the same date for a midday-UTC stamp", () => {
    expect(bangkokDateOf("2026-06-10T05:00:00Z")).toBe("2026-06-10");
  });

  it("rolls to the next day once UTC passes 17:00 (Bangkok midnight)", () => {
    // 17:00Z + 7h = 00:00 the next Bangkok day.
    expect(bangkokDateOf("2026-06-10T17:00:00Z")).toBe("2026-06-11");
  });

  it("stays on the day at 16:59Z (23:59 Bangkok)", () => {
    expect(bangkokDateOf("2026-06-10T16:59:00Z")).toBe("2026-06-10");
  });

  it("handles an evening-UTC stamp that is already tomorrow in Bangkok", () => {
    expect(bangkokDateOf("2026-06-10T18:30:00Z")).toBe("2026-06-11");
  });
});
