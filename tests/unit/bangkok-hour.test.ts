// Spec 277 P0 — bangkokHour(): the current Asia/Bangkok hour (0–23), used by the
// SA home to give the "ปิดวัน" tile a gentle end-of-day pulse after ~16:00 without
// ever reordering the column. Pure (takes an injectable Date) so it's testable.

import { describe, it, expect } from "vitest";
import { bangkokHour } from "@/lib/dates";

describe("bangkokHour", () => {
  it("converts a UTC instant to the Asia/Bangkok (UTC+7) hour", () => {
    // 09:00Z = 16:00 in Bangkok.
    expect(bangkokHour(new Date("2026-07-07T09:00:00Z"))).toBe(16);
  });

  it("is 15 just before the 16:00 boundary", () => {
    // 08:59Z = 15:59 in Bangkok.
    expect(bangkokHour(new Date("2026-07-07T08:59:00Z"))).toBe(15);
  });

  it("wraps midnight to 0, never 24", () => {
    // 17:00Z = 00:00 next day in Bangkok.
    expect(bangkokHour(new Date("2026-07-07T17:00:00Z"))).toBe(0);
  });
});
