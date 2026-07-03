// Spec 256 U1 — pure calendar grid/nav helpers for the real calendar views.
// Sunday-first weeks (Thai wall-calendar convention), Buddhist-era labels,
// UTC-ms date math (same conventions as gantt-scale).

import { describe, expect, it } from "vitest";
import {
  monthGrid,
  weekOf,
  addDaysIso,
  addMonthsIso,
  THAI_WEEKDAYS,
} from "@/lib/work-packages/calendar-grid";

describe("monthGrid", () => {
  it("July 2026: Sunday-first, 5 weeks, BE label", () => {
    const g = monthGrid("2026-07-15");
    // 2026-07-01 is a Wednesday → first week starts Sunday 2026-06-28
    expect(g.label).toBe("ก.ค. 2569");
    expect(g.weeks.length).toBe(5);
    expect(g.weeks[0]?.[0]?.iso).toBe("2026-06-28");
    expect(g.weeks[0]?.[0]?.inMonth).toBe(false);
    expect(g.weeks[0]?.[3]?.iso).toBe("2026-07-01");
    expect(g.weeks[0]?.[3]?.inMonth).toBe(true);
    expect(g.weeks[4]?.[6]?.iso).toBe("2026-08-01");
    // weekend flags: col 0 = Sunday, col 6 = Saturday
    expect(g.weeks[1]?.[0]?.isWeekend).toBe(true);
    expect(g.weeks[1]?.[3]?.isWeekend).toBe(false);
    expect(g.weeks[1]?.[6]?.isWeekend).toBe(true);
  });

  it("Feb 2028 (leap year) covers Feb 29", () => {
    const g = monthGrid("2028-02-10");
    const all = g.weeks.flat().map((c) => c.iso);
    expect(all).toContain("2028-02-29");
    expect(g.label).toBe("ก.พ. 2571");
  });

  it("day numbers match the cell dates", () => {
    const g = monthGrid("2026-07-15");
    const first = g.weeks[0]?.[3];
    expect(first?.day).toBe(1);
  });
});

describe("weekOf", () => {
  it("returns the Sunday-first 7-day week containing the anchor", () => {
    // 2026-07-03 is a Friday → week runs Sun 2026-06-28 .. Sat 2026-07-04
    expect(weekOf("2026-07-03")).toEqual([
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
  });

  it("a Sunday anchor starts its own week", () => {
    expect(weekOf("2026-06-28")[0]).toBe("2026-06-28");
  });
});

describe("nav helpers", () => {
  it("addDaysIso crosses month boundaries", () => {
    expect(addDaysIso("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysIso("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("addMonthsIso moves the anchor month and clamps the day", () => {
    expect(addMonthsIso("2026-07-15", 1)).toBe("2026-08-15");
    expect(addMonthsIso("2026-07-15", -1)).toBe("2026-06-15");
    // clamp: Jul 31 + 1 month → Aug 31 exists; Aug 31 + 1 → Sep 30
    expect(addMonthsIso("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("THAI_WEEKDAYS", () => {
  it("is Sunday-first อา..ส", () => {
    expect(THAI_WEEKDAYS[0]).toBe("อา");
    expect(THAI_WEEKDAYS[6]).toBe("ส");
    expect(THAI_WEEKDAYS.length).toBe(7);
  });
});
